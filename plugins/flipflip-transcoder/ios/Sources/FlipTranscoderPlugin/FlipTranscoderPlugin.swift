import Capacitor
import AVFoundation
import CoreMedia
import ImageIO
import UniformTypeIdentifiers

/**
 * FlipTranscoder — native media optimizer for FlipFlip.
 *
 * Converts heavy camera images/videos (HDR, >1080p, oversized or high bitrate)
 * to basic SDR 1080p copies at import time so the slideshow decodes lightweight
 * files on mobile. Paths are relative to Directory.Data (the app sandbox
 * Documents folder).
 */
@objc(FlipTranscoder)
public class FlipTranscoderPlugin: CAPPlugin, CAPBridgedPlugin {
  public let identifier = "FlipTranscoder"
  public let jsName = "FlipTranscoder"
  public let pluginMethods: [CAPPluginMethod] = [
    CAPPluginMethod(name: "probe", returnType: CAPPluginReturnPromise),
    CAPPluginMethod(name: "convert", returnType: CAPPluginReturnPromise),
  ]

  private let defaultMaxDimension = 1920
  private let maxBytes = 8 * 1024 * 1024
  // Videos over this size or estimated bitrate get re-encoded even when they
  // are already <=1080p and SDR — decoding them stays cheap in the WebView.
  private let videoMaxBytes = 100 * 1024 * 1024
  private let videoMaxBitrate = 20_000_000

  private let imageExts = ["jpg", "jpeg", "png", "gif", "webp", "tiff", "bmp", "heic", "heif"]
  private let videoExts = ["mp4", "mov", "m4v", "webm"]

  private func documentsDir() -> URL {
    FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
  }

  private func absURL(_ rel: String) -> URL {
    documentsDir().appendingPathComponent(rel)
  }

  @objc func probe(_ call: CAPPluginCall) {
    guard let rel = call.getString("path"), !rel.isEmpty else {
      call.reject("path is required")
      return
    }
    let url = absURL(rel)
    let ext = url.pathExtension.lowercased()

    if imageExts.contains(ext) {
      let size = (try? FileManager.default.attributesOfItem(atPath: url.path)[.size] as? NSNumber)?.intValue ?? 0
      var convert = size > maxBytes || ext == "heic" || ext == "heif"
      var width = 0, height = 0
      if let dims = imageDimensions(url) {
        width = dims.width
        height = dims.height
        convert = convert || dims.width > defaultMaxDimension || dims.height > defaultMaxDimension
      }
      call.resolve(["kind": "image", "width": width, "height": height, "convert": convert])
      return
    }

    if videoExts.contains(ext) {
      let asset = AVURLAsset(url: url)
      let track = asset.tracks(withMediaType: .video).first
      if let track = track {
        let size = track.naturalSize.applying(track.preferredTransform)
        let w = abs(Int(size.width)), h = abs(Int(size.height))
        let convert = isHDRVideo(track) || max(w, h) > defaultMaxDimension || isHeavyVideo(url, track, duration: asset.duration)
        call.resolve(["kind": "video", "width": w, "height": h, "convert": convert])
      } else {
        let fileSize = fileSizeBytes(url)
        call.resolve(["kind": "video", "width": 0, "height": 0, "convert": fileSize > videoMaxBytes])
      }
      return
    }

    call.resolve(["kind": "other", "width": 0, "height": 0, "convert": false])
  }

  @objc func convert(_ call: CAPPluginCall) {
    guard let rel = call.getString("path"), !rel.isEmpty else {
      call.reject("path is required")
      return
    }
    let maxDim = call.getInt("maxDimension") ?? defaultMaxDimension
    let keepOriginal = call.getBool("keepOriginal") ?? false

    DispatchQueue.global(qos: .userInitiated).async {
      self.convertInternal(rel: rel, maxDim: maxDim, keepOriginal: keepOriginal) { result in
        DispatchQueue.main.async {
          switch result {
          case .success(let pair):
            call.resolve(["outputPath": pair.0, "converted": pair.1])
          case .failure(let error):
            call.resolve(["outputPath": rel, "converted": false, "error": String(describing: error)])
          }
        }
      }
    }
  }

  private func convertInternal(rel: String, maxDim: Int, keepOriginal: Bool, completion: @escaping (Result<(String, Bool), Error>) -> Void) {
    let url = absURL(rel)
    let ext = url.pathExtension.lowercased()

    if imageExts.contains(ext) {
      completion(.success(convertImage(url: url, rel: rel, maxDim: maxDim, keepOriginal: keepOriginal)))
      return
    }
    if videoExts.contains(ext) {
      convertVideo(url: url, rel: rel, maxDim: maxDim, keepOriginal: keepOriginal) { result in
        completion(.success(result))
      }
      return
    }
    completion(.success((rel, false)))
  }

  // MARK: - Images

  private func imageDimensions(_ url: URL) -> (width: Int, height: Int)? {
    guard let src = CGImageSourceCreateWithURL(url as CFURL, nil) else { return nil }
    guard let props = CGImageSourceCopyPropertiesAtIndex(src, 0, nil) as? [CFString: Any] else { return nil }
    let w = props[kCGImagePropertyPixelWidth] as? Int ?? 0
    let h = props[kCGImagePropertyPixelHeight] as? Int ?? 0
    return (w, h)
  }

  /// Bounds a single image conversion with a hard deadline so a wedged
  /// ImageIO/IOSurface decode can never hang the JS import bridge. The original
  /// file is kept untouched when the deadline passes or the decode fails.
  private func convertImage(url: URL, rel: String, maxDim: Int, keepOriginal: Bool) -> (String, Bool) {
    var result: (String, Bool) = (rel, false)
    let semaphore = DispatchSemaphore(value: 0)
    DispatchQueue.global(qos: .userInitiated).async { [weak self] in
      defer { semaphore.signal() }
      autoreleasepool {
        result = self?.convertImageSync(url: url, rel: rel, maxDim: maxDim, keepOriginal: keepOriginal) ?? (rel, false)
      }
    }
    _ = semaphore.wait(timeout: .now() + 30)
    return result
  }

  private func convertImageSync(url: URL, rel: String, maxDim: Int, keepOriginal: Bool) -> (String, Bool) {
    autoreleasepool {
      guard let src = CGImageSourceCreateWithURL(url as CFURL, nil) else { return (rel, false) }
      guard let dims = imageDimensions(url) else { return (rel, false) }
      let size = (try? FileManager.default.attributesOfItem(atPath: url.path)[.size] as? NSNumber)?.intValue ?? 0
      let needsConvert = dims.width > maxDim || dims.height > maxDim || url.pathExtension.lowercased() == "heic" || url.pathExtension.lowercased() == "heif" || size > maxBytes
      if !needsConvert { return (rel, false) }

      // Decode a downsampled thumbnail WITHOUT forcing an IOSurface-backed
      // allocation. kCGImageSourceShouldCacheImmediately: true makes ImageIO
      // commit a full IOSurface up front for large photos — on memory-limited
      // devices/simulators that surfaced as "IOSurface creation failed e00002c2"
      // and wedged the import. Lazy CPU decode returns the same downscaled RGB
      // result and also downscales HDR → SDR automatically for most formats.
      guard let thumb = CGImageSourceCreateThumbnailAtIndex(src, 0, [
        kCGImageSourceCreateThumbnailFromImageAlways: true,
        kCGImageSourceThumbnailMaxPixelSize: maxDim,
        kCGImageSourceCreateThumbnailWithTransform: true,
        kCGImageSourceShouldCacheImmediately: false,
        kCGImageSourceShouldCache: true
      ] as CFDictionary) else { return (rel, false) }

      // Flatten to an opaque RGB surface before JPEG encode. The thumbnail can
      // carry a premultiplied-alpha channel (PNG/HEIC with alpha), which doubles
      // decode memory and triggers ImageIO's "opaque image ignored alpha" path —
      // drawing into an alpha-less RGB context drops the alpha entirely.
      let w = thumb.width, h = thumb.height
      guard let ctx = CGContext(
        data: nil,
        width: w,
        height: h,
        bitsPerComponent: 8,
        bytesPerRow: w * 4,
        space: CGColorSpaceCreateDeviceRGB(),
        bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue
      ) else { return (rel, false) }
      ctx.draw(thumb, in: CGRect(x: 0, y: 0, width: w, height: h))
      guard let opaque = ctx.makeImage() else { return (rel, false) }

      let outRel = dirOf(rel) + fileStem(url) + "__sdr1080.jpg"
      let outURL = absURL(outRel)
      guard let dest = CGImageDestinationCreateWithURL(outURL as CFURL, UTType.jpeg.identifier as CFString, 1, nil) else { return (rel, false) }
      CGImageDestinationAddImage(dest, opaque, [kCGImageDestinationLossyCompressionQuality: 0.85] as CFDictionary)
      if !CGImageDestinationFinalize(dest) { return (rel, false) }

      if !keepOriginal {
        try? FileManager.default.removeItem(at: url)
      }
      return (outRel, true)
    }
  }

  // MARK: - Videos

  private func fileSizeBytes(_ url: URL) -> Int {
    (try? FileManager.default.attributesOfItem(atPath: url.path)[.size] as? NSNumber)?.intValue ?? 0
  }

  private func isHeavyVideo(_ url: URL, _ track: AVAssetTrack, duration: CMTime) -> Bool {
    let size = fileSizeBytes(url)
    if size > videoMaxBytes { return true }
    var bitrate = Double(track.estimatedDataRate)
    if bitrate <= 0, duration.seconds > 0 {
      bitrate = Double(size) * 8 / duration.seconds
    }
    return bitrate > Double(videoMaxBitrate)
  }

  private func isHDRVideo(_ track: AVAssetTrack) -> Bool {
    guard let first = track.formatDescriptions.first else { return false }
    let desc = first as! CMFormatDescription
    let hdrTransfer: [String] = [
      (kCMFormatDescriptionTransferFunction_SMPTE_ST_2084_PQ as String),
      (kCMFormatDescriptionTransferFunction_ITU_R_2100_HLG as String),
    ]
    if let tf = CMFormatDescriptionGetExtension(desc, extensionKey: kCMFormatDescriptionExtension_TransferFunction) as? String {
      return hdrTransfer.contains(tf)
    }
    if let alt = CMFormatDescriptionGetExtension(desc, extensionKey: kCMFormatDescriptionExtension_AlternativeTransferCharacteristics) as? String {
      return hdrTransfer.contains(alt)
    }
    return false
  }

  private func convertVideo(url: URL, rel: String, maxDim: Int, keepOriginal: Bool, completion: @escaping ((String, Bool)) -> Void) {
    let asset = AVURLAsset(url: url)
    guard let track = asset.tracks(withMediaType: .video).first else {
      completion((rel, false))
      return
    }

    let size = track.naturalSize.applying(track.preferredTransform)
    let w = abs(Int(size.width.rounded())), h = abs(Int(size.height.rounded()))
    let longEdge = max(w, h)
    if longEdge <= maxDim && !isHDRVideo(track) && !isHeavyVideo(url, track, duration: asset.duration) {
      completion((rel, false))
      return
    }

    let scale = Double(maxDim) / Double(longEdge)
    var outW = max(2, Int((Double(w) * scale).rounded()))
    var outH = max(2, Int((Double(h) * scale).rounded()))
    if outW % 2 != 0 { outW += 1 }
    if outH % 2 != 0 { outH += 1 }

    let fps = track.nominalFrameRate
    let frameDuration = fps > 0 ? CMTime(value: 1, timescale: Int32(fps.rounded())) : CMTime(value: 1, timescale: 30)

    let composition = AVMutableVideoComposition()
    composition.renderSize = CGSize(width: outW, height: outH)
    composition.frameDuration = frameDuration
    composition.colorPrimaries = AVVideoColorPrimaries_ITU_R_709_2
    composition.colorTransferFunction = AVVideoTransferFunction_ITU_R_709_2
    composition.colorYCbCrMatrix = AVVideoYCbCrMatrix_ITU_R_709_2

    let instruction = AVMutableVideoCompositionInstruction()
    instruction.timeRange = CMTimeRange(start: .zero, duration: asset.duration)
    let layer = AVMutableVideoCompositionLayerInstruction(assetTrack: track)
    layer.setTransform(track.preferredTransform, at: .zero)
    instruction.layerInstructions = [layer]
    composition.instructions = [instruction]

    guard let exporter = AVAssetExportSession(asset: asset, presetName: AVAssetExportPresetHEVCHighestQuality) else {
      completion((rel, false))
      return
    }
    let outRel = dirOf(rel) + fileStem(url) + "__sdr1080.mp4"
    let outURL = absURL(outRel)
    try? FileManager.default.removeItem(at: outURL)

    exporter.outputURL = outURL
    exporter.outputFileType = AVFileType.mp4
    exporter.shouldOptimizeForNetworkUse = true
    exporter.videoComposition = composition

    exporter.exportAsynchronously {
      if exporter.status == .completed {
        if !keepOriginal {
          try? FileManager.default.removeItem(at: url)
        }
        completion((outRel, true))
      } else {
        try? FileManager.default.removeItem(at: outURL)
        completion((rel, false))
      }
    }
  }

  private func dirOf(_ rel: String) -> String {
    let comps = (rel as NSString).deletingLastPathComponent
    if comps.isEmpty { return "" }
    return comps.hasSuffix("/") ? comps : comps + "/"
  }

  private func fileStem(_ url: URL) -> String {
    url.deletingPathExtension().lastPathComponent
  }
}
