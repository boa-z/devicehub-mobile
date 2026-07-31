import AVFoundation
import ExpoModulesCore

public final class DeviceHubMediaModule: Module {
  public func definition() -> ModuleDefinition {
    Name("DeviceHubMedia")

    Function("pushVideoFrame") { (view: DeviceHubVideoView, data: Data, timestampNs: Double, keyframe: Bool) in
      view.enqueue(annexB: data, timestampNs: timestampNs, keyframe: keyframe)
    }.runOnQueue(.main)

    Function("pushAudioPcm") { (data: Data, sampleRate: Int, channels: Int) in
      DeviceHubAudioPlayer.shared.enqueue(pcm16: data, sampleRate: sampleRate, channels: channels)
    }.runOnQueue(.main)

    Function("reset") {
      DeviceHubAudioPlayer.shared.reset()
    }.runOnQueue(.main)

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

  private let engine = AVAudioEngine()
  private let player = AVAudioPlayerNode()
  private var format: AVAudioFormat?
  private var started = false
  private var scheduledSeconds = 0.0

  private init() {
    engine.attach(player)
  }

  func enqueue(pcm16: Data, sampleRate: Int, channels: Int) {
    guard sampleRate > 0, (1...2).contains(channels), !pcm16.isEmpty else { return }
    let channelCount = AVAudioChannelCount(channels)
    let nextFormat = AVAudioFormat(
      commonFormat: .pcmFormatFloat32,
      sampleRate: Double(sampleRate),
      channels: channelCount,
      interleaved: false
    )
    guard let nextFormat else { return }
    if format?.sampleRate != nextFormat.sampleRate || format?.channelCount != nextFormat.channelCount {
      player.stop()
      engine.disconnectNodeOutput(player)
      engine.connect(player, to: engine.mainMixerNode, format: nextFormat)
      format = nextFormat
    } else if format == nil {
      engine.connect(player, to: engine.mainMixerNode, format: nextFormat)
      format = nextFormat
    }
    guard let format else { return }
    let frames = pcm16.count / (MemoryLayout<Int16>.size * channels)
    guard frames > 0, let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(frames)) else { return }
    buffer.frameLength = AVAudioFrameCount(frames)
    pcm16.withUnsafeBytes { rawBuffer in
      guard let baseAddress = rawBuffer.baseAddress else { return }
      let samples = baseAddress.assumingMemoryBound(to: Int16.self)
      for frame in 0..<frames {
        for channel in 0..<channels {
          let sample = samples[frame * channels + channel]
          buffer.floatChannelData?[channel][frame] = sample < 0
            ? Float(sample) / 32768.0
            : Float(sample) / 32767.0
        }
      }
    }
    if !started {
      do {
        try AVAudioSession.sharedInstance().setCategory(.playback, mode: .default)
        try AVAudioSession.sharedInstance().setActive(true)
        try engine.start()
        started = true
      } catch {
        return
      }
    }
    let duration = Double(frames) / Double(sampleRate)
    if scheduledSeconds > 0.25 {
      player.stop()
      scheduledSeconds = 0
    }
    scheduledSeconds += duration
    player.scheduleBuffer(buffer) { [weak self] in
      DispatchQueue.main.async {
        self?.scheduledSeconds = max(0, (self?.scheduledSeconds ?? 0) - duration)
      }
    }
    if !player.isPlaying { player.play() }
  }

  func reset() {
    player.stop()
    engine.stop()
    started = false
    format = nil
    scheduledSeconds = 0
  }
}
