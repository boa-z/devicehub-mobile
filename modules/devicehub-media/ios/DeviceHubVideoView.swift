import AVFoundation
import ExpoModulesCore

final class DeviceHubVideoView: ExpoView {
  let displayLayer = AVSampleBufferDisplayLayer()
  var contentModeName = "fit" {
    didSet { updateGravity() }
  }

  private var formatDescription: CMVideoFormatDescription?
  private var vps: Data?
  private var sps: Data?
  private var pps: Data?

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    layer.addSublayer(displayLayer)
    displayLayer.videoGravity = .resizeAspect
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    displayLayer.frame = bounds
  }

  func enqueue(annexB: Data, timestampNs: Double, keyframe: Bool) {
    let nalUnits = Self.nalUnits(in: annexB)
    guard !nalUnits.isEmpty else { return }
    var parameterSetsChanged = false
    for nal in nalUnits {
      guard let first = nal.first else { continue }
      switch (first >> 1) & 0x3F {
      case 32:
        parameterSetsChanged = parameterSetsChanged || vps != nal
        vps = nal
      case 33:
        parameterSetsChanged = parameterSetsChanged || sps != nal
        sps = nal
      case 34:
        parameterSetsChanged = parameterSetsChanged || pps != nal
        pps = nal
      default: break
      }
    }
    if parameterSetsChanged { formatDescription = nil }
    if formatDescription == nil, let vps, let sps, let pps {
      var description: CMVideoFormatDescription?
      var status = OSStatus(-1)
      vps.withUnsafeBytes { vpsBytes in
        sps.withUnsafeBytes { spsBytes in
          pps.withUnsafeBytes { ppsBytes in
            guard let vpsBase = vpsBytes.bindMemory(to: UInt8.self).baseAddress,
                  let spsBase = spsBytes.bindMemory(to: UInt8.self).baseAddress,
                  let ppsBase = ppsBytes.bindMemory(to: UInt8.self).baseAddress else { return }
            var pointers = [vpsBase, spsBase, ppsBase]
            var sizes = [vps.count, sps.count, pps.count]
            status = pointers.withUnsafeMutableBufferPointer { pointerBuffer in
              sizes.withUnsafeMutableBufferPointer { sizeBuffer in
                CMVideoFormatDescriptionCreateFromHEVCParameterSets(
                  allocator: kCFAllocatorDefault,
                  parameterSetCount: 3,
                  parameterSetPointers: pointerBuffer.baseAddress!,
                  parameterSetSizes: sizeBuffer.baseAddress!,
                  nalUnitHeaderLength: 4,
                  formatDescriptionOut: &description
                )
              }
            }
          }
        }
      }
      if status == noErr { formatDescription = description }
    }
    guard let formatDescription else { return }
    var lengthPrefixed = Data()
    for nal in nalUnits {
      let type = (nal.first! >> 1) & 0x3F
      if type == 32 || type == 33 || type == 34 || type == 35 { continue }
      var length = UInt32(nal.count).bigEndian
      withUnsafeBytes(of: &length) { lengthPrefixed.append(contentsOf: $0) }
      lengthPrefixed.append(nal)
    }
    guard !lengthPrefixed.isEmpty else { return }
    var blockBuffer: CMBlockBuffer?
    let blockStatus = lengthPrefixed.withUnsafeBytes { bytes in
      CMBlockBufferCreateWithMemoryBlock(
        allocator: kCFAllocatorDefault,
        memoryBlock: nil,
        blockLength: lengthPrefixed.count,
        blockAllocator: kCFAllocatorDefault,
        customBlockSource: nil,
        offsetToData: 0,
        dataLength: lengthPrefixed.count,
        flags: 0,
        blockBufferOut: &blockBuffer
      )
      guard let blockBuffer, let baseAddress = bytes.baseAddress else { return kCMBlockBufferNoErr }
      return CMBlockBufferReplaceDataBytes(with: baseAddress, blockBuffer: blockBuffer, offsetIntoDestination: 0, dataLength: lengthPrefixed.count)
    }
    guard blockStatus == kCMBlockBufferNoErr, let blockBuffer else { return }
    var timing = CMSampleTimingInfo(
      duration: CMTime.invalid,
      presentationTimeStamp: CMTime(value: CMTimeValue(max(0, timestampNs)), timescale: 1_000_000_000),
      decodeTimeStamp: .invalid
    )
    var sampleBuffer: CMSampleBuffer?
    let sampleStatus = CMSampleBufferCreateReady(
      allocator: kCFAllocatorDefault,
      dataBuffer: blockBuffer,
      formatDescription: formatDescription,
      sampleCount: 1,
      sampleTimingEntryCount: 1,
      sampleTimingArray: &timing,
      sampleSizeEntryCount: 1,
      sampleSizeArray: [lengthPrefixed.count],
      sampleBufferOut: &sampleBuffer
    )
    guard sampleStatus == noErr, let sampleBuffer else { return }
    if keyframe && displayLayer.status == .failed {
      displayLayer.flushAndRemoveImage()
    }
    guard displayLayer.isReadyForMoreMediaData else { return }
    displayLayer.enqueue(sampleBuffer)
  }

  private func updateGravity() {
    displayLayer.videoGravity = contentModeName == "fill" ? .resizeAspectFill : .resizeAspect
  }

  private static func nalUnits(in data: Data) -> [Data] {
    let bytes = [UInt8](data)
    var starts: [(offset: Int, length: Int)] = []
    var index = 0
    while index + 3 < bytes.count {
      if bytes[index] == 0 && bytes[index + 1] == 0 && bytes[index + 2] == 1 {
        starts.append((index, 3)); index += 3; continue
      }
      if index + 4 < bytes.count && bytes[index] == 0 && bytes[index + 1] == 0 && bytes[index + 2] == 0 && bytes[index + 3] == 1 {
        starts.append((index, 4)); index += 4; continue
      }
      index += 1
    }
    return starts.enumerated().compactMap { position, start in
      let payloadStart = start.offset + start.length
      let payloadEnd = position + 1 < starts.count ? starts[position + 1].offset : bytes.count
      guard payloadEnd > payloadStart else { return nil }
      return Data(bytes[payloadStart..<payloadEnd])
    }
  }
}
