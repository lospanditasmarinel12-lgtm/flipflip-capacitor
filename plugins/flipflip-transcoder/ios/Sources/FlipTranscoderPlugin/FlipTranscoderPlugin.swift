import Capacitor
import AVFoundation
import CoreMedia
import ImageIO
import UniformTypeIdentifiers
import UIKit

/**
 * FlipTranscoder — native media optimizer for FlipFlip.
 *
 * Normalizes arbitrary user media into a predictable, bounded playback
 * contract for the Capacitor WebView. The goal is cheapest encoding that
 * produces a media asset safely inside the playback envelope — not the
 * smallest possible file.
 *
 * Decision flow:
 *   PROBE → ANALYZE → SELECT PROFILE → KEEP / LIGHT / AGGRESSIVE → TRANSCODE IF REQUIRED
 */
@objc(FlipTranscoder)
public class FlipTranscoderPlugin: CAPPlugin, CAPBridgedPlugin {
  public let identifier = "FlipTranscoder"
  public let jsName = "FlipTranscoder"
  public let pluginMethods: [CAPPluginMethod] = [
    CAPPluginMethod(name: "probe", returnType: CAPPluginReturnPromise),
    CAPPluginMethod(name: "convert", returnType: CAPPluginReturnPromise),
    CAPPluginMethod(name: "optimizeLibrary", returnType: CAPPluginReturnPromise),
    CAPPluginMethod(name: "cancel", returnType: CAPPluginReturnPromise),
  ]

  private var sweepCancelled = false

  /// Handles to the in-flight AVAssetReader/AVAssetWriter (if any) so cancel()
  /// can tear them down cleanly via the AVFoundation API instead of letting
  /// them die at a low level (which can trip an NSInternalInconsistencyException
  /// in AVAssetReaderOutput.copyNextSampleBuffer).
  private let sessionLock = NSLock()
  private var activeReader: AVAssetReader?
  private var activeWriter: AVAssetWriter?
  /// Set by cancel() (JS aborts background convert when the user keeps/skips a
  /// file). Image conversion consults it before deleting the original so a
  /// background settle can never destroy a file the user chose to keep.
  private var abortRequested = false

  private var isAbortRequested: Bool {
    sessionLock.lock()
    let value = abortRequested
    sessionLock.unlock()
    return value
  }

  /// Last per-file conversion failure reason, surfaced by the library sweep
  /// so a skipped file is distinguishable from a genuinely failed one.
  private let failureLock = NSLock()
  private var lastFailureReason: String?

  private func noteFailure(_ reason: String) {
    failureLock.lock()
    lastFailureReason = reason
    failureLock.unlock()
  }

  private func takeFailureReason() -> String? {
    failureLock.lock()
    let reason = lastFailureReason
    lastFailureReason = nil
    failureLock.unlock()
    return reason
  }

  // MARK: - Configurable profiles

  // --- Image profile ---
  /// Maximum decoded pixel count (~2.5 MP). The pixel budget is the primary
  /// image optimization criterion — not compressed file size.
  private let imageMaxPixels = 2_500_000
  /// Maximum single dimension after conversion.
  private let imageMaxDimension = 1920
  /// WebP quality (0-100). ~82 gives good visual quality at reasonable size.
  private let imageQuality = 82
  /// Secondary file-size cap (still useful for storage, not memory).
  private let imageMaxBytes = 8 * 1024 * 1024

  // --- Video profile (STANDARD) ---
  private let videoMaxDimension = 1920
  private let videoMaxFPS = 30
  private let videoTargetBitrate1080 = 3_750_000
  private let videoMaxBitrate = 20_000_000
  private let videoMaxBytes = 100 * 1024 * 1024
  private let videoIFrameInterval = 2

  /// Resolution-proportional video bitrate (bits/s). Chosen by the output's long
  /// edge, then floored by the source's own bitrate so converted output never
  /// bloats below-efficient clips. Inputs >1920 are downscaled first.
  private func videoTargetBitrate(forWidth w: Int, height h: Int, sourceBitrate: Double) -> Int {
    let longEdge = max(w, h)
    let tier: Int
    switch longEdge {
    case ..<641: tier = 1_750_000 // ≤640×640-ish
    case ..<1281: tier = 2_250_000 // ≤720×920 / 720×1280
    default: tier = videoTargetBitrate1080 // 1080p (dimension cap too)
    }
    return sourceBitrate > 0 ? min(tier, Int(sourceBitrate * 1.15)) : tier
  }

  // --- Audio profile (unchanged) ---
  private let audioMaxBytes = 24 * 1024 * 1024
  private let audioBitrate = 256_000
  private let audioSampleRate = 48000
  private let audioEncodeTimeout: TimeInterval = 6 * 60 * 60

  /// True only when ImageIO actually registers a WebP *encoder*. The public.webp
  /// UTType is declared on iOS 14+ even though CoreGraphics ships no WebP writer,
  /// so UTType presence is NOT a valid capability check — using it makes every
  /// image attempt a WebP encode that fails and then falls back to JPEG while
  /// spamming the console with "unsupported output file format 'public.webp'".
  private static let webpEncoderAvailable: Bool = {
    guard let typeIDs = CGImageDestinationCopyTypeIdentifiers() as? [String] else { return false }
    return typeIDs.contains("public.webp") || typeIDs.contains("org.webmproject.webp")
  }()

  // --- Extension sets ---
  private let imageExts = ["jpg", "jpeg", "png", "tiff", "bmp", "heic", "heif"]
  private let videoExts = ["mp4", "mov", "m4v", "webm"]
  private let audioExts = ["mp3", "m4a", "aac", "flac", "wav", "aiff", "aif", "ogg", "opus", "wma"]
  private let audioForceConvert = ["ogg", "opus", "wma"]

  // MARK: - Helpers

  private func documentsDir() -> URL {
    FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
  }

  private func absURL(_ rel: String) -> URL {
    documentsDir().appendingPathComponent(rel)
  }

  private func fileSizeBytes(_ url: URL) -> Int {
    (try? FileManager.default.attributesOfItem(atPath: url.path)[.size] as? NSNumber)?.intValue ?? 0
  }

  /// Demuxability check for MP4-family containers. A byte-scan of box headers
  /// is unreliable (moov's trailing chunk-offset tables can sit at EOF and
  /// QuickTime files append `meta`/`keys`/`ilst` trailers), so this asks
  /// AVFoundation instead: a container is playable only when it has a positive
  /// duration and at least one real media track. Orphaned partial writes
  /// contain only ftyp/mdat, have no duration, and would hang the WebView
  /// demuxer, so they are never published as playable media.
  private func isCompleteMp4(_ url: URL) -> Bool {
    guard fileSizeBytes(url) >= 1024 else { return false }
    let asset = AVURLAsset(url: url)
    guard asset.duration.isValid, asset.duration.seconds > 0 else { return false }
    if !asset.tracks(withMediaType: .video).isEmpty { return true }
    return !asset.tracks(withMediaType: .audio).isEmpty
  }

  private func dirOf(_ rel: String) -> String {
    let comps = (rel as NSString).deletingLastPathComponent
    if comps.isEmpty { return "" }
    return comps.hasSuffix("/") ? comps : comps + "/"
  }

  private func fileStem(_ url: URL) -> String {
    url.deletingPathExtension().lastPathComponent
  }

  // MARK: - Image metadata

  private struct ImageInfo {
    var width: Int = 0
    var height: Int = 0
    var pixelCount: Int = 0
    var estimatedDecodedBytes: Int = 0
    var format: String = ""
    var hasAlpha: Bool = false
    var colorSpace: String = ""
    var hdr: Bool = false
  }

  private func readImageInfo(_ url: URL) -> ImageInfo {
    var info = ImageInfo()
    guard let src = CGImageSourceCreateWithURL(url as CFURL, nil) else { return info }
    guard let props = CGImageSourceCopyPropertiesAtIndex(src, 0, nil) as? [CFString: Any] else { return info }
    let w = props[kCGImagePropertyPixelWidth] as? Int ?? 0
    let h = props[kCGImagePropertyPixelHeight] as? Int ?? 0
    info.width = w
    info.height = h
    info.pixelCount = w * h
    info.estimatedDecodedBytes = w * h * 4

    // Format
    let ext = url.pathExtension.lowercased()
    info.format = ext

    // Alpha
    if let alpha = props[kCGImagePropertyHasAlpha] as? Bool {
      info.hasAlpha = alpha
    }

    // Color space
    if let cs = props[kCGImagePropertyColorModel] as? String {
      info.colorSpace = cs
    }

    // HDR detection: check for P3 or BT.2020 wide gamut
    if let profileName = props[kCGImagePropertyProfileName] as? String {
      let upper = profileName.uppercased()
      if upper.contains("BT.2020") || upper.contains("P3") || upper.contains("DISPLAY P3") {
        info.hdr = true
      }
    }

    return info
  }

  // MARK: - Video metadata

  private struct VideoInfo {
    var width: Int = 0
    var height: Int = 0
    var pixelCount: Int = 0
    var estimatedDecodedBytes: Int = 0
    var fps: Float = 0
    var duration: Double = 0
    var bitrate: Double = 0
    var codec: String = ""
    var codecProfile: String = ""
    var pixelFormat: String = ""
    var bitDepth: Int = 8
    var hdr: Bool = false
    var audioCodec: String = ""
    var fileSize: Int = 0
    var pixelRate: Double = 0
  }

  private func readVideoInfo(_ url: URL) -> VideoInfo {
    var info = VideoInfo()
    info.fileSize = fileSizeBytes(url)
    let asset = AVURLAsset(url: url)
    info.duration = asset.duration.seconds.isFinite ? asset.duration.seconds : 0

    guard let track = asset.tracks(withMediaType: .video).first else { return info }

    let size = track.naturalSize.applying(track.preferredTransform)
    info.width = abs(Int(size.width.rounded()))
    info.height = abs(Int(size.height.rounded()))
    info.pixelCount = info.width * info.height
    info.estimatedDecodedBytes = info.width * info.height * 4

    info.fps = track.nominalFrameRate
    if info.fps <= 0 { info.fps = 30 }
    info.pixelRate = Double(info.width) * Double(info.height) * Double(info.fps)

    // Bitrate
    var bitrate = Double(track.estimatedDataRate)
    if bitrate <= 0, info.duration > 0 {
      bitrate = Double(info.fileSize) * 8 / info.duration
    }
    info.bitrate = bitrate

    // Codec + pixel format from the format description
    if let anyDesc = track.formatDescriptions.first {
      let desc = anyDesc as! CMFormatDescription
      // Actual codec from the media subtype fourcc ('avc1'/'hvc1'/'vp09')
      let codecFourCC = CMFormatDescriptionGetMediaSubType(desc)
      switch codecFourCC {
      case kCMVideoCodecType_H264: info.codec = "h264"
      case kCMVideoCodecType_HEVC: info.codec = "hevc"
      case kCMVideoCodecType_VP9: info.codec = "vp9"
      default: info.codec = "unknown(\(fourCCString(codecFourCC)))"
      }

      // HDR
      info.hdr = isHDRVideo(track)

      // Pixel format from the extensions dictionary
      if let extensions = CMFormatDescriptionGetExtensions(desc) as? [String: Any],
         let pfmt = extensions["PixelFormatType"] as? NSNumber {
        info.pixelFormat = pixelFormatName(pfmt.uint32Value)
      }
    }

    // Audio codec
    if let audioTrack = asset.tracks(withMediaType: .audio).first,
       let anyAdesc = audioTrack.formatDescriptions.first {
      let adesc = anyAdesc as! CMFormatDescription
      let ct = CMFormatDescriptionGetMediaSubType(adesc)
      switch ct {
      case kAudioFormatMPEG4AAC: info.audioCodec = "aac"
      case kAudioFormatLinearPCM: info.audioCodec = "pcm"
      default: info.audioCodec = "other(\(fourCCString(ct)))"
      }
    }

    return info
  }

  private func fourCCString(_ codec: FourCharCode) -> String {
    let bytes: [UInt8] = [
      UInt8(truncatingIfNeeded: (codec >> 24) & 0xFF),
      UInt8(truncatingIfNeeded: (codec >> 16) & 0xFF),
      UInt8(truncatingIfNeeded: (codec >> 8) & 0xFF),
      UInt8(truncatingIfNeeded: codec & 0xFF),
    ]
    return String(bytes: bytes, encoding: .ascii) ?? "???"
  }

  private func pixelFormatName(_ fmt: OSType) -> String {
    switch fmt {
    case kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange: return "420v"
    case kCVPixelFormatType_420YpCbCr8BiPlanarFullRange: return "420f"
    case kCVPixelFormatType_32BGRA: return "bgra"
    case kCVPixelFormatType_4444YpCbCrA8: return "4444"
    case kCVPixelFormatType_422YpCbCr8: return "422"
    default: return "unknown(\(fmt))"
    }
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
    // Fallback: BT.2020 color standard is a strong HDR signal
    if let cs = CMFormatDescriptionGetExtension(desc, extensionKey: kCMFormatDescriptionExtension_ColorPrimaries) as? String {
      if cs == (kCMFormatDescriptionColorPrimaries_ITU_R_2020 as String) { return true }
    }
    return false
  }

  // MARK: - Decision model

  private struct ProbeDecision {
    var profile: String = "keep"
    var resize: Bool = false
    var targetWidth: Int = 0
    var targetHeight: Int = 0
    var targetFPS: Int = 0
    var targetBitrate: Int = 0
    var toneMap: Bool = false
    var reencode: Bool = false
  }

  private func analyzeImage(_ info: ImageInfo, fileSize: Int) -> ProbeDecision {
    var d = ProbeDecision()

    let needsDimensionResize = info.width > imageMaxDimension || info.height > imageMaxDimension
    let needsPixelBudget = info.pixelCount > imageMaxPixels
    let needsSizeCap = fileSize > imageMaxBytes
    let needsFormat = info.format == "heic" || info.format == "heif"

    guard needsDimensionResize || needsPixelBudget || needsSizeCap || needsFormat else {
      d.profile = "keep"
      d.reencode = false
      return d
    }

    // Calculate target dimensions preserving aspect ratio
    if needsPixelBudget || needsDimensionResize {
      d.resize = true
      let scale: Double
      if info.pixelCount > imageMaxPixels {
        scale = sqrt(Double(imageMaxPixels) / Double(max(info.pixelCount, 1)))
      } else {
        scale = min(Double(imageMaxDimension) / Double(max(info.width, 1)),
                     Double(imageMaxDimension) / Double(max(info.height, 1)))
      }
      d.targetWidth = max(2, Int(Double(info.width) * scale))
      d.targetHeight = max(2, Int(Double(info.height) * scale))
      // Ensure even dimensions
      if d.targetWidth % 2 != 0 { d.targetWidth += 1 }
      if d.targetHeight % 2 != 0 { d.targetHeight += 1 }
    }

    d.profile = "standard"
    d.reencode = true
    return d
  }

  private func analyzeVideo(_ info: VideoInfo) -> ProbeDecision {
    var d = ProbeDecision()

    let needsDimensionResize = max(info.width, info.height) > videoMaxDimension
    let needsFPS = Double(info.fps) > Double(videoMaxFPS)
    let needsBitrate = info.bitrate > Double(videoMaxBitrate)
    let needsSizeCap = info.fileSize > videoMaxBytes
    let needsHDR = info.hdr
    // Pixel rate check: very high pixel rates need aggressive normalization
    let needsPixelRate = info.pixelRate > Double(videoMaxDimension * videoMaxDimension) * Double(videoMaxFPS)

    guard needsDimensionResize || needsFPS || needsBitrate || needsSizeCap || needsHDR || needsPixelRate else {
      d.profile = "keep"
      d.reencode = false
      return d
    }

    // Target dimensions preserving aspect ratio
    d.resize = needsDimensionResize || needsPixelRate
    if d.resize {
      let longEdge = max(info.width, info.height)
      let scale = Double(videoMaxDimension) / Double(longEdge)
      d.targetWidth = max(2, Int(Double(info.width) * scale))
      d.targetHeight = max(2, Int(Double(info.height) * scale))
      if d.targetWidth % 2 != 0 { d.targetWidth += 1 }
      if d.targetHeight % 2 != 0 { d.targetHeight += 1 }
    } else {
      d.targetWidth = info.width
      d.targetHeight = info.height
    }

    d.targetFPS = needsFPS ? videoMaxFPS : Int(info.fps)
    if d.targetFPS <= 0 { d.targetFPS = 30 }
    d.targetBitrate = videoTargetBitrate(forWidth: d.targetWidth, height: d.targetHeight, sourceBitrate: info.bitrate)
    d.toneMap = needsHDR
    d.profile = needsHDR ? "standard_hdr" : "standard"
    d.reencode = true
    return d
  }

  // MARK: - probe()

  @objc func probe(_ call: CAPPluginCall) {
    guard let rel = call.getString("path"), !rel.isEmpty else {
      call.reject("path is required")
      return
    }
    let url = absURL(rel)
    let ext = url.pathExtension.lowercased()

    if imageExts.contains(ext) {
      let info = readImageInfo(url)
      let size = fileSizeBytes(url)
      let decision = analyzeImage(info, fileSize: size)
      var result: [String: Any] = [
        "kind": "image",
        "width": info.width,
        "height": info.height,
        "convert": decision.reencode,
        "pixelCount": info.pixelCount,
        "estimatedDecodedBytes": info.estimatedDecodedBytes,
        "fileSize": size,
        "codec": ext,
        "fps": 0,
        "duration": 0,
        "bitDepth": 8,
        "pixelFormat": info.hasAlpha ? "bgra" : "rgb",
        "hdr": info.hdr,
        "alpha": info.hasAlpha,
        "estimatedOutputBytes": 0,
        "decision": [
          "profile": decision.profile,
          "resize": decision.resize,
          "targetWidth": decision.targetWidth,
          "targetHeight": decision.targetHeight,
          "targetFPS": 0,
          "targetBitrate": 0,
          "toneMap": false,
          "reencode": decision.reencode,
        ] as [String: Any],
      ]
      // Estimate output size for WebP
      if decision.reencode {
        let bpp: Double = 0.7 // typical WebP bits per pixel at quality 82
        let targetPixels = decision.resize ? decision.targetWidth * decision.targetHeight : info.pixelCount
        result["estimatedOutputBytes"] = Int(Double(targetPixels) * bpp / 8)
      }
      call.resolve(result)
      return
    }

    if videoExts.contains(ext) {
      let info = readVideoInfo(url)
      let decision = analyzeVideo(info)
      // Estimate output video size: targetBitrate × duration / 8
      let estimatedVideoBytes = decision.reencode && info.duration > 0
        ? Int(Double(decision.targetBitrate) * info.duration / 8)
        : 0
      var result: [String: Any] = [
        "kind": "video",
        "width": info.width,
        "height": info.height,
        "convert": decision.reencode,
        "complete": isCompleteMp4(url),
        "pixelCount": info.pixelCount,
        "estimatedDecodedBytes": info.estimatedDecodedBytes,
        "fileSize": info.fileSize,
        "codec": info.codec,
        "fps": info.fps,
        "duration": info.duration,
        "bitDepth": info.bitDepth,
        "pixelFormat": info.pixelFormat,
        "hdr": info.hdr,
        "alpha": false,
        "estimatedOutputBytes": estimatedVideoBytes,
        "decision": [
          "profile": decision.profile,
          "resize": decision.resize,
          "targetWidth": decision.targetWidth,
          "targetHeight": decision.targetHeight,
          "targetFPS": decision.targetFPS,
          "targetBitrate": decision.targetBitrate,
          "toneMap": decision.toneMap,
          "reencode": decision.reencode,
        ] as [String: Any],
      ]
      call.resolve(result)
      return
    }

    if audioExts.contains(ext) {
      let size = fileSizeBytes(url)
      let forced = audioForceConvert.contains(ext)
      let needsConvert = forced || size > audioMaxBytes
      call.resolve([
        "kind": "audio",
        "width": 0,
        "height": 0,
        "convert": needsConvert,
        "pixelCount": 0,
        "estimatedDecodedBytes": 0,
        "fileSize": size,
        "codec": ext,
        "fps": 0,
        "duration": 0,
        "bitDepth": 0,
        "pixelFormat": "",
        "hdr": false,
        "alpha": false,
        "estimatedOutputBytes": needsConvert ? size / 4 : 0,
        "decision": [
          "profile": needsConvert ? "standard" : "keep",
          "resize": false,
          "targetWidth": 0,
          "targetHeight": 0,
          "targetFPS": 0,
          "targetBitrate": audioBitrate,
          "toneMap": false,
          "reencode": needsConvert,
        ] as [String: Any],
      ] as [String: Any])
      return
    }

    call.resolve([
      "kind": "other",
      "width": 0,
      "height": 0,
      "convert": false,
      "pixelCount": 0,
      "estimatedDecodedBytes": 0,
      "fileSize": 0,
      "codec": "",
      "fps": 0,
      "duration": 0,
      "bitDepth": 0,
      "pixelFormat": "",
      "hdr": false,
      "alpha": false,
      "estimatedOutputBytes": 0,
      "decision": [
        "profile": "keep",
        "resize": false,
        "targetWidth": 0,
        "targetHeight": 0,
        "targetFPS": 0,
        "targetBitrate": 0,
        "toneMap": false,
        "reencode": false,
      ] as [String: Any],
    ] as [String: Any])
  }

  // MARK: - convert()

  @objc func convert(_ call: CAPPluginCall) {
    guard let rel = call.getString("path"), !rel.isEmpty else {
      call.reject("path is required")
      return
    }
    let keepOriginal = call.getBool("keepOriginal") ?? false

    DispatchQueue.global(qos: .userInitiated).async {
      self.convertInternal(rel: rel, keepOriginal: keepOriginal) { result in
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

  private func convertInternal(rel: String, keepOriginal: Bool, completion: @escaping (Result<(String, Bool), Error>) -> Void) {
    let url = absURL(rel)
    let ext = url.pathExtension.lowercased()

    if imageExts.contains(ext) {
      completion(.success(convertImage(url: url, rel: rel, keepOriginal: keepOriginal)))
      return
    }
    if videoExts.contains(ext) {
      convertVideo(url: url, rel: rel, keepOriginal: keepOriginal) { result in
        completion(.success(result))
      }
      return
    }
    if audioExts.contains(ext) {
      convertAudio(url: url, rel: rel, keepOriginal: keepOriginal) { result in
        completion(.success(result))
      }
      return
    }
    completion(.success((rel, false)))
  }

  // MARK: - Image conversion

  /// Thread-safe flag so convertImageSync never deletes the original after the
  /// calling side has already given up waiting and resumed holding on to it.
  private final class AbandonFlag {
    private let lock = NSLock()
    private var value = false
    func abandon() { lock.lock(); value = true; lock.unlock() }
    var isAbandoned: Bool { lock.lock(); defer { lock.unlock() }; return value }
  }

  /// Bounds a single image conversion with a hard deadline.
  private func convertImage(url: URL, rel: String, keepOriginal: Bool) -> (String, Bool) {
    var result: (String, Bool) = (rel, false)
    let flag = AbandonFlag()
    let semaphore = DispatchSemaphore(value: 0)
    DispatchQueue.global(qos: .userInitiated).async { [weak self] in
      defer { semaphore.signal() }
      autoreleasepool {
        result = self?.convertImageSync(url: url, rel: rel, keepOriginal: keepOriginal, abandoned: flag) ?? (rel, false)
      }
    }
    let waited = semaphore.wait(timeout: .now() + 30) == .success
    if !waited {
      // Hung decode: caller resumes using the ORIGINAL path, so the background
      // sync must be prevented from deleting it when it finally settles.
      NSLog("[FlipTranscoder] image convert timed out, keeping original: %@", rel)
      flag.abandon()
    }
    return result
  }

  private func convertImageSync(url: URL, rel: String, keepOriginal: Bool, abandoned: AbandonFlag) -> (String, Bool) {
    autoreleasepool {
      let info = readImageInfo(url)
      let size = fileSizeBytes(url)
      let decision = analyzeImage(info, fileSize: size)
      guard decision.reencode else { return (rel, false) }

      guard let src = CGImageSourceCreateWithURL(url as CFURL, nil) else {
        noteFailure("cannot open image source \(rel)")
        return (rel, false)
      }

      // Calculate max pixel dimension for ImageIO bounded decode
      let maxPixelDim: Int
      if decision.resize {
        maxPixelDim = max(decision.targetWidth, decision.targetHeight)
      } else {
        maxPixelDim = max(imageMaxDimension, imageMaxDimension)
      }

      // Bounded ImageIO decode — never materializes the full-resolution image.
      // kCGImageSourceShouldCacheImmediately: false avoids IOSurface up-front
      // allocation that can fail on memory-limited devices. If the IOSurface
      // still cannot be allocated (large images on constrained devices), retry
      // once at half the target size with caching disabled entirely.
      let thumbOptions: [CFString: Any] = [
        kCGImageSourceCreateThumbnailFromImageAlways: true,
        kCGImageSourceThumbnailMaxPixelSize: maxPixelDim,
        kCGImageSourceCreateThumbnailWithTransform: true,
        kCGImageSourceShouldCacheImmediately: false,
        kCGImageSourceShouldCache: true,
      ]
      var thumb = CGImageSourceCreateThumbnailAtIndex(src, 0, thumbOptions as CFDictionary)
      if thumb == nil, maxPixelDim > 1000 {
        NSLog("[FlipTranscoder] bounded decode failed for %@, retrying at half size", rel)
        var retry = thumbOptions
        retry[kCGImageSourceThumbnailMaxPixelSize] = maxPixelDim / 2
        retry[kCGImageSourceShouldCacheImmediately] = false
        retry[kCGImageSourceShouldCache] = false
        thumb = CGImageSourceCreateThumbnailAtIndex(src, 0, retry as CFDictionary)
      }
      guard let decoded = thumb else {
        noteFailure("image decode failed for \(rel) (IOSurface/memory)")
        return (rel, false)
      }

      let w = decoded.width, h = decoded.height

      // Flatten to opaque RGB surface — drops alpha channel, halves decode
      // memory vs BGRA, and avoids ImageIO's "opaque image ignored alpha" path.
      guard let ctx = CGContext(
        data: nil,
        width: w,
        height: h,
        bitsPerComponent: 8,
        bytesPerRow: w * 4,
        space: CGColorSpaceCreateDeviceRGB(),
        bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue
      ) else {
        noteFailure("cannot allocate RGB context for \(rel)")
        return (rel, false)
      }
      ctx.draw(decoded, in: CGRect(x: 0, y: 0, width: w, height: h))
      guard let opaque = ctx.makeImage() else {
        noteFailure("cannot flatten image \(rel)")
        return (rel, false)
      }

      // Output WebP only when ImageIO actually has a registered WebP encoder
      // (otherwise every image hits a failing destination and falls back). Falls
      // back to JPEG when unavailable or when the encode does not land on disk.
      if FlipTranscoderPlugin.webpEncoderAvailable {
        let outRel = dirOf(rel) + fileStem(url) + "__sdr1080.webp"
        let outURL = absURL(outRel)
        if let dest = CGImageDestinationCreateWithURL(outURL as CFURL, "public.webp" as CFString, 1, nil) {
          CGImageDestinationAddImage(dest, opaque, [
            kCGImageDestinationLossyCompressionQuality: Double(imageQuality) / 100.0
          ] as CFDictionary)
          if CGImageDestinationFinalize(dest),
             let attrs = try? FileManager.default.attributesOfItem(atPath: outURL.path),
             (attrs[.size] as? NSNumber)?.intValue ?? 0 > 0 {
            if !keepOriginal && !abandoned.isAbandoned && !isAbortRequested {
              try? FileManager.default.removeItem(at: url)
            }
            return (outRel, true)
          }
          try? FileManager.default.removeItem(at: outURL)
        }
        return convertImageToJPEG(opaque: opaque, url: url, rel: rel, keepOriginal: keepOriginal, abandoned: abandoned)
      }
      return convertImageToJPEG(opaque: opaque, url: url, rel: rel, keepOriginal: keepOriginal, abandoned: abandoned)
    }
  }

  private func convertImageToJPEG(opaque: CGImage, url: URL, rel: String, keepOriginal: Bool, abandoned: AbandonFlag) -> (String, Bool) {
    let outRel = dirOf(rel) + fileStem(url) + "__sdr1080.jpg"
    let outURL = absURL(outRel)
    guard let dest = CGImageDestinationCreateWithURL(outURL as CFURL, UTType.jpeg.identifier as CFString, 1, nil) else {
      noteFailure("cannot create JPEG destination for \(rel)")
      return (rel, false)
    }
    CGImageDestinationAddImage(dest, opaque, [
      kCGImageDestinationLossyCompressionQuality: Double(imageQuality) / 100.0
    ] as CFDictionary)
    if !CGImageDestinationFinalize(dest) {
      noteFailure("JPEG encode failed for \(rel)")
      return (rel, false)
    }
    if !keepOriginal && !abandoned.isAbandoned && !isAbortRequested {
      try? FileManager.default.removeItem(at: url)
    }
    return (outRel, true)
  }

  // MARK: - Video conversion

  private func convertVideo(url: URL, rel: String, keepOriginal: Bool, completion: @escaping ((String, Bool)) -> Void) {
    let info = readVideoInfo(url)
    let decision = analyzeVideo(info)
    guard decision.reencode else {
      completion((rel, false))
      return
    }

    let outRel = dirOf(rel) + fileStem(url) + "__sdr1080.mp4"
    let outURL = absURL(outRel)
    try? FileManager.default.removeItem(at: outURL)

    // Build composition for scaling + frame rate
    let asset = AVURLAsset(url: url)
    guard let track = asset.tracks(withMediaType: .video).first else {
      completion((rel, false))
      return
    }

    let outW = decision.targetWidth
    let outH = decision.targetHeight
    let outFPS = decision.targetFPS
    let targetBitrate = videoTargetBitrate(forWidth: outW, height: outH, sourceBitrate: info.bitrate)

    let frameDuration = CMTime(value: 1, timescale: Int32(outFPS))

    let composition = AVMutableVideoComposition()
    composition.renderSize = CGSize(width: outW, height: outH)
    composition.frameDuration = frameDuration
    composition.colorPrimaries = AVVideoColorPrimaries_ITU_R_709_2
    composition.colorTransferFunction = AVVideoTransferFunction_ITU_R_709_2
    composition.colorYCbCrMatrix = AVVideoYCbCrMatrix_ITU_R_709_2

    let instruction = AVMutableVideoCompositionInstruction()
    instruction.timeRange = CMTimeRange(start: .zero, duration: asset.duration)
    let layer = AVMutableVideoCompositionLayerInstruction(assetTrack: track)
    // Fit the full displayed source frame into renderSize, centered. The source
    // preferredTransform can carry editor-baked tx/ty that are wrong both as-is and
    // after scaledBy (which leaves tx/ty untouched), so rebuild from the rotation/scale
    // part and re-add a centering translation from the transformed bounding box.
    let tf = track.preferredTransform
    let applied = track.naturalSize.applying(tf)
    let outSize = CGSize(width: outW, height: outH)
    let scale = min(outSize.width / max(abs(applied.width), 1),
                    outSize.height / max(abs(applied.height), 1))
    var m = CGAffineTransform(a: tf.a, b: tf.b, c: tf.c, d: tf.d, tx: 0, ty: 0)
      .scaledBy(x: scale, y: scale)

    let nW = track.naturalSize.width
    let nH = track.naturalSize.height
    var minX = CGFloat.greatestFiniteMagnitude
    var maxX = -CGFloat.greatestFiniteMagnitude
    var minY = CGFloat.greatestFiniteMagnitude
    var maxY = -CGFloat.greatestFiniteMagnitude
    for p in [CGPoint.zero, CGPoint(x: nW, y: 0), CGPoint(x: 0, y: nH), CGPoint(x: nW, y: nH)] {
      let q = p.applying(m)
      minX = min(minX, q.x); maxX = max(maxX, q.x)
      minY = min(minY, q.y); maxY = max(maxY, q.y)
    }
    var final = m
    final.tx = -minX + (outSize.width - (maxX - minX)) / 2
    final.ty = -minY + (outSize.height - (maxY - minY)) / 2
    layer.setTransform(final, at: .zero)
    instruction.layerInstructions = [layer]
    composition.instructions = [instruction]

    transcodeVideoWrite(videoTrack: track, composition: composition, outURL: outURL, outW: outW, outH: outH, fps: Double(outFPS), sourceFPS: Double(info.fps), targetBitrate: targetBitrate) { ok in
      if ok {
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

  /// AVAssetReader → AVAssetWriter with H.264 output for maximum WebView
  /// compatibility. Uses hardware encoder where available.
  private func transcodeVideoWrite(videoTrack: AVAssetTrack, composition: AVMutableVideoComposition, outURL: URL, outW: Int, outH: Int, fps: Double, sourceFPS: Double, targetBitrate: Int, completion: @escaping (Bool) -> Void) {
    guard let asset = videoTrack.asset as? AVURLAsset else {
      completion(false)
      return
    }
    guard let reader = try? AVAssetReader(asset: asset) else {
      noteFailure("cannot create AVAssetReader for \(asset.url.lastPathComponent)")
      completion(false)
      return
    }

    let videoOutput = AVAssetReaderVideoCompositionOutput(videoTracks: [videoTrack], videoSettings: [
      kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange,
    ])
    videoOutput.videoComposition = composition
    videoOutput.alwaysCopiesSampleData = false
    guard reader.canAdd(videoOutput) else { completion(false); return }
    reader.add(videoOutput)

    var audioOutput: AVAssetReaderTrackOutput?
    if let audioTrack = asset.tracks(withMediaType: .audio).first {
      let ao = AVAssetReaderTrackOutput(track: audioTrack, outputSettings: [AVFormatIDKey: kAudioFormatLinearPCM])
      ao.alwaysCopiesSampleData = false
      if reader.canAdd(ao) {
        reader.add(ao)
        audioOutput = ao
      }
    }

    let writer: AVAssetWriter
    do {
      writer = try AVAssetWriter(outputURL: outURL, fileType: .mp4)
    } catch {
      noteFailure("cannot create AVAssetWriter for \(outURL.lastPathComponent): \(error)")
      completion(false)
      return
    }
    sessionLock.lock()
    activeReader = reader
    activeWriter = writer
    sessionLock.unlock()

    // Single exit path that unregisters the live sessions — this runs when the
    // conversion actually settles (including the async finishWriting callback),
    // not when this function merely returns, so cancel() can still reach the
    // in-flight reader/writer while the encode is running.
    func finish(_ ok: Bool) {
      sessionLock.lock()
      if activeReader === reader { activeReader = nil }
      if activeWriter === writer { activeWriter = nil }
      sessionLock.unlock()
      completion(ok)
    }

    // H.264 output for maximum WebView compatibility (not HEVC).
    var compression: [String: Any] = [
      AVVideoAverageBitRateKey: targetBitrate,
      AVVideoMaxKeyFrameIntervalKey: max(1, Int(fps * Double(videoIFrameInterval))),
      AVVideoMaxKeyFrameIntervalDurationKey: videoIFrameInterval,
      AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel,
      AVVideoAllowFrameReorderingKey: true,
    ]
    if sourceFPS > 0 {
      compression[AVVideoExpectedSourceFrameRateKey] = NSNumber(value: sourceFPS)
    }
    var settings: [String: Any] = [
      AVVideoCodecKey: AVVideoCodecType.h264,
      AVVideoWidthKey: outW,
      AVVideoHeightKey: outH,
      AVVideoCompressionPropertiesKey: compression,
      // Deterministic SDR color tags so tone-mapped content is tagged BT.709.
      AVVideoColorPropertiesKey: [
        AVVideoColorPrimariesKey: AVVideoColorPrimaries_ITU_R_709_2,
        AVVideoTransferFunctionKey: AVVideoTransferFunction_ITU_R_709_2,
        AVVideoYCbCrMatrixKey: AVVideoYCbCrMatrix_ITU_R_709_2,
      ],
    ]
    let videoInput = AVAssetWriterInput(mediaType: .video, outputSettings: settings)
    videoInput.expectsMediaDataInRealTime = false
    let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: videoInput, sourcePixelBufferAttributes: nil)
    guard writer.canAdd(videoInput) else { finish(false); return }
    writer.add(videoInput)

    var audioInput: AVAssetWriterInput?
    if audioOutput != nil {
      let ai = AVAssetWriterInput(mediaType: .audio, outputSettings: [
        AVFormatIDKey: kAudioFormatMPEG4AAC,
        AVSampleRateKey: audioSampleRate,
        AVNumberOfChannelsKey: 2,
        AVEncoderBitRateKey: audioBitrate,
      ])
      ai.expectsMediaDataInRealTime = false
      if writer.canAdd(ai) {
        writer.add(ai)
        audioInput = ai
      }
    }

    guard reader.startReading(), reader.status == .reading else {
      noteFailure("AVAssetReader failed to start for \(asset.url.lastPathComponent): \(String(describing: reader.error))")
      finish(false)
      return
    }
    guard writer.startWriting() else {
      noteFailure("AVAssetWriter failed to start for \(outURL.lastPathComponent): \(String(describing: writer.error))")
      finish(false)
      return
    }
    writer.startSession(atSourceTime: .zero)

    let inputSeconds = mediaDurationSeconds(of: videoTrack, fallback: asset)
    let muxedAudio = audioInput != nil
    var lastVideoAppendedSeconds = 0.0
    var lastAudioAppendedSeconds = 0.0

    let lock = NSLock()
    var videoDone = false
    var audioDone = audioInput == nil

    func markDone(_ video: Bool) {
      lock.lock()
      if video {
        videoDone = true
      } else {
        audioDone = true
      }
      let allDone = videoDone && audioDone
      lock.unlock()
      guard allDone else { return }
      writer.finishWriting {
        let outSeconds = max(lastVideoAppendedSeconds, muxedAudio ? lastAudioAppendedSeconds : 0)
        let ok = writer.status == .completed
          && self.plausibleOutputDuration(input: inputSeconds, output: outSeconds)
        if !ok {
          NSLog("[FlipTranscoder] video encode failed or truncated (in=%.1fs out=%.1fs status=%@): %@",
                inputSeconds, outSeconds, String(describing: writer.status.rawValue), outURL.path)
          try? FileManager.default.removeItem(at: outURL)
        }
        finish(ok)
      }
    }

    videoInput.requestMediaDataWhenReady(on: DispatchQueue(label: "flipflip.transcoder.video")) {
      while videoInput.isReadyForMoreMediaData {
        // Guard the reader state BEFORE copyNextSampleBuffer: calling it after
        // the reader was cancelled/failed/teardown throws an ObjC
        // NSInternalInconsistencyException that cannot be caught in Swift and
        // would terminate the whole app (and the library sweep with it).
        guard reader.status == .reading, let sample = videoOutput.copyNextSampleBuffer() else {
          videoInput.markAsFinished()
          markDone(true)
          return
        }
        guard let buffer = CMSampleBufferGetImageBuffer(sample) else {
          videoInput.markAsFinished()
          markDone(true)
          return
        }
        let pts = CMSampleBufferGetPresentationTimeStamp(sample)
        if !adaptor.append(buffer, withPresentationTime: pts) {
          videoInput.markAsFinished()
          markDone(true)
          return
        }
        lastVideoAppendedSeconds = pts.seconds
      }
    }

    if let ai = audioInput, let ao = audioOutput {
      ai.requestMediaDataWhenReady(on: DispatchQueue(label: "flipflip.transcoder.audio")) {
        while ai.isReadyForMoreMediaData {
          guard reader.status == .reading, let sample = ao.copyNextSampleBuffer() else {
            ai.markAsFinished()
            markDone(false)
            return
          }
          if !ai.append(sample) {
            ai.markAsFinished()
            markDone(false)
            return
          }
          lastAudioAppendedSeconds = CMSampleBufferGetPresentationTimeStamp(sample).seconds
        }
      }
    }
  }

  // MARK: - Audio conversion

  private func convertAudio(url: URL, rel: String, keepOriginal: Bool, completion: @escaping ((String, Bool)) -> Void) {
    let ext = url.pathExtension.lowercased()
    if !audioForceConvert.contains(ext) && fileSizeBytes(url) <= audioMaxBytes {
      completion((rel, false))
      return
    }

    let outRel = dirOf(rel) + fileStem(url) + "__aac256.m4a"
    let outURL = absURL(outRel)
    try? FileManager.default.removeItem(at: outURL)

    let asset = AVURLAsset(url: url)
    guard let track = asset.tracks(withMediaType: .audio).first else { completion((rel, false)); return }
    guard let formatDesc = track.formatDescriptions.first else { completion((rel, false)); return }
    let desc = formatDesc as! CMFormatDescription
    guard let asbd = CMAudioFormatDescriptionGetStreamBasicDescription(desc)?.pointee else { completion((rel, false)); return }
    let channels = Int(asbd.mChannelsPerFrame)
    guard channels >= 1 && channels <= 2 else { completion((rel, false)); return }

    let reader: AVAssetReader
    let writer: AVAssetWriter
    do {
      reader = try AVAssetReader(asset: asset)
      writer = try AVAssetWriter(outputURL: outURL, fileType: .m4a)
    } catch {
      completion((rel, false))
      return
    }
    sessionLock.lock()
    activeReader = reader
    activeWriter = writer
    sessionLock.unlock()

    // Single exit path that unregisters the live sessions when the conversion
    // actually settles (including the async finishWriting callback) — not when
    // this function merely returns — so cancel() can still reach the in-flight
    // reader/writer while the encode is running.
    func finish(_ ok: Bool) {
      sessionLock.lock()
      if activeReader === reader { activeReader = nil }
      if activeWriter === writer { activeWriter = nil }
      sessionLock.unlock()
      if ok {
        if !keepOriginal {
          try? FileManager.default.removeItem(at: url)
        }
        completion((outRel, true))
      } else {
        try? FileManager.default.removeItem(at: outURL)
        completion((rel, false))
      }
    }

    let readingSettings: [String: Any] = [
      AVFormatIDKey: kAudioFormatLinearPCM,
      AVSampleRateKey: audioSampleRate,
      AVNumberOfChannelsKey: channels,
      AVLinearPCMBitDepthKey: 16,
      AVLinearPCMIsFloatKey: false,
      AVLinearPCMIsNonInterleaved: false,
    ]
    let output = AVAssetReaderAudioMixOutput(audioTracks: [track], audioSettings: readingSettings)
    output.alwaysCopiesSampleData = true
    guard reader.canAdd(output) else { finish(false); return }
    reader.add(output)

    let writingSettings: [String: Any] = [
      AVFormatIDKey: kAudioFormatMPEG4AAC,
      AVSampleRateKey: audioSampleRate,
      AVNumberOfChannelsKey: channels,
      AVEncoderBitRateKey: audioBitrate,
    ]
    let input = AVAssetWriterInput(mediaType: .audio, outputSettings: writingSettings)
    input.expectsMediaDataInRealTime = false
    guard writer.canAdd(input) else { finish(false); return }
    writer.add(input)

    guard reader.startReading(), writer.startWriting() else { finish(false); return }
    writer.startSession(atSourceTime: .zero)

    let lock = NSLock()
    var lastAudioAppendedSeconds = 0.0
    let inputDuration = mediaDurationSeconds(of: track, fallback: asset)
    let trustInputDuration = !audioForceConvert.contains(url.pathExtension.lowercased())

    func settle() {
      writer.finishWriting {
        lock.lock()
        let appended = lastAudioAppendedSeconds
        lock.unlock()
        let ok = writer.status == .completed
          && FileManager.default.fileExists(atPath: outURL.path)
          && self.plausibleOutputDuration(input: inputDuration, output: appended,
                                          trustInput: trustInputDuration)
        if !ok {
          NSLog("[FlipTranscoder] audio encode failed or truncated (in=%.1fs out=%.1fs status=%@ trustInput=%d): %@",
                inputDuration, appended, String(describing: writer.status.rawValue),
                trustInputDuration ? 1 : 0, rel)
        }
        finish(ok)
      }
    }

    input.requestMediaDataWhenReady(on: DispatchQueue(label: "flipflip.transcoder.audio.optimize", qos: .userInitiated)) {
      while input.isReadyForMoreMediaData {
        // Guard the reader state BEFORE copyNextSampleBuffer: calling it after
        // the reader was cancelled/failed/teardown throws an ObjC
        // NSInternalInconsistencyException that cannot be caught in Swift and
        // would terminate the whole app (and the library sweep with it).
        guard reader.status == .reading, let sample = output.copyNextSampleBuffer() else {
          input.markAsFinished()
          settle()
          return
        }
        if !input.append(sample) {
          input.markAsFinished()
          settle()
          return
        }
        lock.lock()
        lastAudioAppendedSeconds = CMSampleBufferGetPresentationTimeStamp(sample).seconds
        lock.unlock()
      }
    }
  }

  // MARK: - Encode validation

  /// Track `timeRange` is the authoritative duration for the media actually in
  /// the stream. `AVURLAsset.duration` is unreliable for some containers
  /// (notably Ogg/Opus, where it can over-report by several-fold) and
  /// push/pull edit lists can inflate it too.
  private func mediaDurationSeconds(of track: AVAssetTrack?, fallback asset: AVURLAsset?) -> Double {
    if let track = track {
      let s = track.timeRange.duration.seconds
      if s.isFinite && s > 0 { return s }
    }
    if let asset = asset {
      let s = asset.duration.seconds
      if s.isFinite && s > 0 { return s }
    }
    return 0
  }

  private func plausibleOutputDuration(input: Double, output: Double, trustInput: Bool = true) -> Bool {
    if !trustInput || input <= 5 {
      return output > 0.5
    }
    return output >= min(input * 0.95, input - 2)
  }

  // MARK: - Library sweep (unchanged)

  @objc func cancel(_ call: CAPPluginCall) {
    sweepCancelled = true
    sessionLock.lock()
    abortRequested = true
    let reader = activeReader
    let writer = activeWriter
    sessionLock.unlock()
    reader?.cancelReading()
    writer?.cancelWriting()
    call.resolve()
  }

  @objc func optimizeLibrary(_ call: CAPPluginCall) {
    let raw: [String]? = call.getArray("paths")?.compactMap { $0 as? String }
    let paths = (raw ?? []).filter { !$0.isEmpty }
    if paths.isEmpty {
      call.resolve(["mapping": [], "canceled": false])
      return
    }
    let keepOriginal = call.getBool("keepOriginal") ?? false
    sweepCancelled = false
    sessionLock.lock()
    abortRequested = false
    sessionLock.unlock()
    DispatchQueue.global(qos: .userInitiated).async { [weak self] in
      self?.runLibrarySweep(paths: paths, keepOriginal: keepOriginal, call: call)
    }
  }

  private func runLibrarySweep(paths: [String], keepOriginal: Bool, call: CAPPluginCall) {
    let total = paths.count
    let start = Date()
    var bgTask = UIBackgroundTaskIdentifier.invalid
    bgTask = UIApplication.shared.beginBackgroundTask(withName: "flipflip-optimize") {
      UIApplication.shared.endBackgroundTask(bgTask)
    }
    defer {
      if bgTask != .invalid {
        UIApplication.shared.endBackgroundTask(bgTask)
      }
    }
    var mapping: [[String: Any]] = []
    for (index, rel) in paths.enumerated() {
      if sweepCancelled { break }
      if isOptimizedOutput(rel) {
        let u = absURL(rel)
        if FileManager.default.fileExists(atPath: u.path),
           let attrs = try? FileManager.default.attributesOfItem(atPath: u.path),
           (attrs[.size] as? Int) == 0 {
          try? FileManager.default.removeItem(at: u)
        }
        continue
      }
      notifySweepProgress(current: index + 1, total: total, name: (rel as NSString).lastPathComponent)
      // Await each conversion before moving on. convertInternal is asynchronous
      // for video/audio; running several AVAssetReader/AVAssetWriter pipelines
      // concurrently spiked memory (IOSurface failures) and risked the
      // AVFoundation teardown race that terminated the app mid-sweep.
      let isImage = imageExts.contains((rel as NSString).pathExtension.lowercased())
      let deadline: DispatchTime = .now() + (isImage ? 60 : audioEncodeTimeout)
      var outRel = rel
      var converted = false
      let done = DispatchSemaphore(value: 0)
      convertInternal(rel: rel, keepOriginal: keepOriginal) { result in
        switch result {
        case .success(let pair):
          outRel = pair.0
          converted = pair.1
        case .failure(let error):
          self.noteFailure(String(describing: error))
        }
        done.signal()
      }
      if done.wait(timeout: deadline) != .success {
        NSLog("[FlipTranscoder] sweep timed out waiting for %@ — keeping original", rel)
        noteFailure("conversion did not settle for \(rel)")
      }
      if converted {
        mapping.append(["from": rel, "to": outRel])
        NSLog("[FlipTranscoder] sweep converted %@ -> %@ at %.0fs",
             rel, outRel, Date().timeIntervalSince(start))
      } else {
        if let reason = takeFailureReason() {
          NSLog("[FlipTranscoder] sweep FAILED %@ at %.0fs: %@", rel, Date().timeIntervalSince(start), reason)
        } else {
          NSLog("[FlipTranscoder] sweep unchanged %@ at %.0fs", rel, Date().timeIntervalSince(start))
        }
      }
      persistSweepState(total: total, current: index + 1, keepOriginal: keepOriginal, mapping: mapping)
    }
    try? FileManager.default.removeItem(at: absURL("optimize-state.json"))
    call.resolve(["mapping": mapping, "canceled": sweepCancelled])
  }

  private func isOptimizedOutput(_ rel: String) -> Bool {
    let n = rel.lowercased()
    return n.contains("__sdr1080.") || n.contains("__aac256.")
  }

  private func notifySweepProgress(current: Int, total: Int, name: String) {
    notifyListeners("progress", data: ["current": current, "total": total, "name": name])
  }

  private func persistSweepState(total: Int, current: Int, keepOriginal: Bool, mapping: [[String: Any]]) {
    let obj: [String: Any] = [
      "total": total,
      "current": current,
      "keepOriginal": keepOriginal,
      "mapping": mapping,
    ]
    guard let data = try? JSONSerialization.data(withJSONObject: obj) else { return }
    try? data.write(to: absURL("optimize-state.json"))
  }
}
