import AVFoundation
import ExpoModulesCore

public final class DeviceHubMediaModule: Module {
  public func definition() -> ModuleDefinition {
    Name("DeviceHubMedia")

    // Media packets arrive at video rate. Keep the bridge callback short and
    // let the view/audio sinks own their bounded serial queues.
    Function("pushVideoFrame") {
      (view: DeviceHubVideoView, data: Data, timestampNs: Double, keyframe: Bool, width: Int, height: Int) in
      view.enqueue(annexB: data, timestampNs: timestampNs, keyframe: keyframe, width: width, height: height)
    }

    Function("pushAudioPcm") { (data: Data, sampleRate: Int, channels: Int) in
      DeviceHubAudioPlayer.shared.enqueue(pcm16: data, sampleRate: sampleRate, channels: channels)
    }

    Function("reset") {
      DeviceHubAudioPlayer.shared.reset()
    }

    Function("resetVideo") { (view: DeviceHubVideoView) in
      view.reset()
    }

    View(DeviceHubVideoView.self) {
      Prop("contentMode") { (view: DeviceHubVideoView, contentMode: String) in
        view.contentModeName = contentMode
      }
      Events("onVideoStatus")
    }
  }
}

private final class DeviceHubAudioPlayer {
  static let shared = DeviceHubAudioPlayer()

  private let queue = DispatchQueue(label: "com.boa.devicehub.media.audio", qos: .userInitiated)
  private let engine = AVAudioEngine()
  private let player = AVAudioPlayerNode()
  private var format: AVAudioFormat?
  private var started = false
  private var scheduledSeconds = 0.0

  private init() {
    engine.attach(player)
  }

  func enqueue(pcm16: Data, sampleRate: Int, channels: Int) {
    queue.async { [weak self] in
      self?.enqueueOnQueue(pcm16: pcm16, sampleRate: sampleRate, channels: channels)
    }
  }

  private func enqueueOnQueue(pcm16: Data, sampleRate: Int, channels: Int) {
    guard sampleRate > 0, (1...2).contains(channels), !pcm16.isEmpty else { return }
    let channelCount = AVAudioChannelCount(channels)
    guard let nextFormat = AVAudioFormat(
      commonFormat: .pcmFormatFloat32,
      sampleRate: Double(sampleRate),
      channels: channelCount,
      interleaved: false
    ) else { return }

    if format?.sampleRate != nextFormat.sampleRate || format?.channelCount != nextFormat.channelCount {
      player.stop()
      engine.disconnectNodeOutput(player)
      engine.connect(player, to: engine.mainMixerNode, format: nextFormat)
      format = nextFormat
      scheduledSeconds = 0
    } else if format == nil {
      engine.connect(player, to: engine.mainMixerNode, format: nextFormat)
      format = nextFormat
    }
    guard let format else { return }

    let bytesPerFrame = MemoryLayout<Int16>.size * channels
    let frames = pcm16.count / bytesPerFrame
    guard frames > 0, let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(frames)) else { return }
    buffer.frameLength = AVAudioFrameCount(frames)
    pcm16.withUnsafeBytes { rawBuffer in
      let bytes = rawBuffer.bindMemory(to: UInt8.self)
      guard !bytes.isEmpty, let channelData = buffer.floatChannelData else { return }
      for frame in 0..<frames {
        for channel in 0..<channels {
          let offset = (frame * channels + channel) * 2
          let bits = UInt16(bytes[offset]) | (UInt16(bytes[offset + 1]) << 8)
          let sample = Int16(bitPattern: bits)
          channelData[channel][frame] = sample < 0
            ? Float(sample) / 32768.0
            : Float(sample) / 32767.0
        }
      }
    }

    if !started {
      do {
        let audioSession = AVAudioSession.sharedInstance()
        try audioSession.setCategory(.playback, mode: .default)
        try audioSession.setActive(true)
        try engine.start()
        started = true
      } catch {
        return
      }
    }

    let duration = Double(frames) / Double(sampleRate)
    // Keep latency bounded. Dropping queued audio is preferable to playing
    // stale sound seconds after the corresponding video frame.
    if scheduledSeconds > 0.25 {
      player.stop()
      scheduledSeconds = 0
    }
    scheduledSeconds += duration
    player.scheduleBuffer(buffer) { [weak self] in
      self?.queue.async {
        guard let self else { return }
        self.scheduledSeconds = max(0, self.scheduledSeconds - duration)
      }
    }
    if !player.isPlaying { player.play() }
  }

  func reset() {
    queue.async { [weak self] in
      guard let self else { return }
      self.player.stop()
      self.player.reset()
      self.engine.stop()
      self.started = false
      self.format = nil
      self.scheduledSeconds = 0
    }
  }
}
