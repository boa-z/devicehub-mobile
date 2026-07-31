package expo.modules.devicehubmedia

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import android.media.MediaCodec
import android.media.MediaFormat
import android.view.Surface
import android.view.SurfaceHolder
import android.view.SurfaceView
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.views.ExpoView
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger

/** Surface-backed HEVC sink with a bounded decoder queue. */
class DeviceHubVideoView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  private val surfaceView = SurfaceView(context)
  private val executor = Executors.newSingleThreadExecutor { runnable ->
    Thread(runnable, "devicehub-video-decoder").apply { isDaemon = true }
  }
  private val pending = AtomicInteger(0)
  private val maxPending = 3
  private var surface: Surface? = null
  private var codec: MediaCodec? = null
  private var codecWidth = 0
  private var codecHeight = 0

  init {
    addView(surfaceView, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
    surfaceView.holder.addCallback(object : SurfaceHolder.Callback {
      override fun surfaceCreated(holder: SurfaceHolder) {
        surface = holder.surface
      }

      override fun surfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) {
        surface = holder.surface
      }

      override fun surfaceDestroyed(holder: SurfaceHolder) {
        surface = null
        executor.execute { releaseCodec() }
      }
    })
  }

  fun enqueue(data: ByteArray, timestampNs: Double, keyframe: Boolean, width: Int, height: Int) {
    if (width <= 0 || height <= 0) return
    while (true) {
      val current = pending.get()
      if (current >= maxPending && !keyframe) return
      if (pending.compareAndSet(current, current + 1)) break
    }
    // Expo may reuse the bridge buffer after this function returns.
    val packet = data.copyOf()
    executor.execute {
      try {
        val target = surface ?: return@execute
        ensureCodec(target, width, height)
        val decoder = codec ?: return@execute
        val inputIndex = decoder.dequeueInputBuffer(0)
        if (inputIndex < 0) return@execute
        val input = decoder.getInputBuffer(inputIndex) ?: return@execute
        input.clear()
        if (packet.size > input.remaining()) return@execute
        input.put(packet)
        val flags = if (keyframe) MediaCodec.BUFFER_FLAG_KEY_FRAME else 0
        decoder.queueInputBuffer(inputIndex, 0, packet.size, (timestampNs / 1_000).toLong(), flags)
        drain(decoder)
      } catch (_: IllegalStateException) {
        releaseCodec()
      } finally {
        pending.decrementAndGet()
      }
    }
  }

  fun reset() {
    pending.set(0)
    executor.execute { releaseCodec() }
  }

  private fun ensureCodec(target: Surface, width: Int, height: Int) {
    if (codec != null && codecWidth == width && codecHeight == height && surface === target) return
    releaseCodec()
    val format = MediaFormat.createVideoFormat(MediaFormat.MIMETYPE_VIDEO_HEVC, width, height)
    format.setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, maxOf(width * height / 2, 256 * 1024))
    codec = MediaCodec.createDecoderByType(MediaFormat.MIMETYPE_VIDEO_HEVC).also { decoder ->
      decoder.configure(format, target, null, 0)
      decoder.start()
    }
    codecWidth = width
    codecHeight = height
  }

  private fun drain(decoder: MediaCodec) {
    val info = MediaCodec.BufferInfo()
    while (true) {
      when (val outputIndex = decoder.dequeueOutputBuffer(info, 0)) {
        MediaCodec.INFO_TRY_AGAIN_LATER -> return
        MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> Unit
        else -> if (outputIndex >= 0) decoder.releaseOutputBuffer(outputIndex, true)
      }
    }
  }

  private fun releaseCodec() {
    codec?.runCatching { stop() }
    codec?.runCatching { release() }
    codec = null
    codecWidth = 0
    codecHeight = 0
  }
}

private class DeviceHubAudioPlayer {
  private val executor = Executors.newSingleThreadExecutor { runnable ->
    Thread(runnable, "devicehub-audio-player").apply { isDaemon = true }
  }
  private val pending = AtomicInteger(0)
  private var track: AudioTrack? = null
  private var sampleRate = 0
  private var channels = 0

  fun enqueue(data: ByteArray, nextSampleRate: Int, nextChannels: Int) {
    if (data.isEmpty() || nextSampleRate !in 8_000..192_000 || nextChannels !in 1..2) return
    if (pending.incrementAndGet() > 8) {
      pending.decrementAndGet()
      return
    }
    val packet = data.copyOf()
    executor.execute {
      try {
        ensureTrack(nextSampleRate, nextChannels, packet.size)
        track?.write(packet, 0, packet.size, AudioTrack.WRITE_BLOCKING)
      } finally {
        pending.decrementAndGet()
      }
    }
  }

  fun reset() {
    pending.set(0)
    executor.execute { releaseTrack() }
  }

  private fun ensureTrack(nextSampleRate: Int, nextChannels: Int, packetSize: Int) {
    if (track != null && sampleRate == nextSampleRate && channels == nextChannels) return
    releaseTrack()
    val channelMask = if (nextChannels == 1) AudioFormat.CHANNEL_OUT_MONO else AudioFormat.CHANNEL_OUT_STEREO
    val minBuffer = AudioTrack.getMinBufferSize(nextSampleRate, channelMask, AudioFormat.ENCODING_PCM_16BIT)
    val bufferSize = maxOf(minBuffer, packetSize * 4)
    track = AudioTrack.Builder()
      .setAudioAttributes(
        AudioAttributes.Builder()
          .setUsage(AudioAttributes.USAGE_MEDIA)
          .setContentType(AudioAttributes.CONTENT_TYPE_MOVIE)
          .build()
      )
      .setAudioFormat(
        AudioFormat.Builder()
          .setSampleRate(nextSampleRate)
          .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
          .setChannelMask(channelMask)
          .build()
      )
      .setBufferSizeInBytes(bufferSize)
      .setTransferMode(AudioTrack.MODE_STREAM)
      .build()
    sampleRate = nextSampleRate
    channels = nextChannels
    track?.play()
  }

  private fun releaseTrack() {
    track?.runCatching { stop() }
    track?.release()
    track = null
    sampleRate = 0
    channels = 0
  }
}

class DeviceHubMediaModule : Module() {
  private val audioPlayer = DeviceHubAudioPlayer()

  override fun definition() = ModuleDefinition {
    Name("DeviceHubMedia")

    Function("pushVideoFrame") { view: DeviceHubVideoView, data: ByteArray, timestampNs: Double, keyframe: Boolean, width: Int, height: Int ->
      view.enqueue(data, timestampNs, keyframe, width, height)
    }
    Function("pushAudioPcm") { data: ByteArray, sampleRate: Int, channels: Int ->
      audioPlayer.enqueue(data, sampleRate, channels)
    }
    Function("reset") { audioPlayer.reset() }
    Function("resetVideo") { view: DeviceHubVideoView -> view.reset() }

    View(DeviceHubVideoView::class) {
      Prop("contentMode") { _: DeviceHubVideoView, _: String -> }
    }
  }
}
