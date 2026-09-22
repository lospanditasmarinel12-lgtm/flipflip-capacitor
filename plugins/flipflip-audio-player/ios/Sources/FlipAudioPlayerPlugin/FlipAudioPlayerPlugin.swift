import Capacitor
import Foundation
import AVFoundation
import Accelerate

/**
 * FlipAudioPlayer — focus-safe native scene-audio player.
 *
 * Plays the scene audio track with AVPlayer under an AVAudioSession configured
 * for mixing (see AppDelegate: .playback + .mixWithOthers), so
 * background music from other apps keeps playing at its own volume and WebView <video/> playback
 * no longer suspends the scene audio (both live outside the one-audio-session
 * constraint WebKit applies to multiple WebView media elements).
 *
 * Haptics keep working via a native meter: an MTAudioProcessingTap on the
 * player's audio mix computes RMS + magnitude spectrum and emits the same
 * `meter` event shape AudioAnalyzer.startFromMeter consumes.
 */
@objc(FlipAudioPlayer)
public class FlipAudioPlayerPlugin: CAPPlugin, CAPBridgedPlugin {
  public let identifier = "FlipAudioPlayer"
  public let jsName = "FlipAudioPlayer"
  public let pluginMethods: [CAPPluginMethod] = [
    CAPPluginMethod(name: "load", returnType: CAPPluginReturnPromise),
    CAPPluginMethod(name: "play", returnType: CAPPluginReturnPromise),
    CAPPluginMethod(name: "pause", returnType: CAPPluginReturnPromise),
    CAPPluginMethod(name: "seekTo", returnType: CAPPluginReturnPromise),
    CAPPluginMethod(name: "setVolume", returnType: CAPPluginReturnPromise),
    CAPPluginMethod(name: "getState", returnType: CAPPluginReturnPromise),
    CAPPluginMethod(name: "dispose", returnType: CAPPluginReturnPromise),
  ]

  private var player: AVPlayer?
  private var timeObserver: Any?
  private var active = false
  private var endedNotified = false
  private var pendingEndNotificationToken: NSObjectProtocol?
  private var interruptionToken: NSObjectProtocol?
  private var wasInterruptedWhilePlaying = false

  @objc func load(_ call: CAPPluginCall) {
    guard let urlString = call.getString("url"), let url = normalizedURL(urlString) else {
      call.reject("url is required")
      return
    }
    let loop = call.getBool("loop", false) ?? false
    let volume = Float(call.getDouble("volume", 1.0) ?? 1.0)
    teardown()

    let session = AVAudioSession.sharedInstance()
    try? session.setCategory(.playback, options: [.mixWithOthers])
    try? session.setActive(true)

    // Interruptions (phone call, Siri, Control Center) deactivate our session and
    // pause the player; when they end we re-arm the session and resume playback.
    interruptionToken = NotificationCenter.default.addObserver(
      forName: AVAudioSession.interruptionNotification,
      object: nil,
      queue: .main
    ) { [weak self] note in
      guard let self = self,
            let info = note.userInfo,
            let raw = info[AVAudioSessionInterruptionTypeKey] as? UInt,
            let type = AVAudioSession.InterruptionType(rawValue: raw) else { return }
      switch type {
      case .began:
        self.wasInterruptedWhilePlaying = self.player?.rate ?? 0 > 0
      case .ended:
        try? AVAudioSession.sharedInstance().setActive(true)
        if self.wasInterruptedWhilePlaying {
          self.player?.play()
        }
        self.wasInterruptedWhilePlaying = false
      @unknown default:
        break
      }
    }

    let item = AVPlayerItem(url: url)
    item.audioTimePitchAlgorithm = .spectral

    // Tap the audio path for the haptics meter.
    let tap = MeterTap.makeTap { [weak self] rms, spectrum, sampleRate in
      DispatchQueue.main.async {
        self?.emitMeter(rms: rms, spectrum: spectrum, sampleRate: sampleRate)
      }
    }
    // Re-resolve the audio mix on each new item assignment.
    item.audioMix = {
      let mix = AVMutableAudioMix()
      if let track = item.asset.tracks(withMediaType: .audio).first {
        let params = AVMutableAudioMixInputParameters(track: track)
        params.audioTapProcessor = tap
        mix.inputParameters = [params]
      }
      return mix
    }()

    let p = AVPlayer(playerItem: item)
    p.volume = min(1, max(0, volume))
    p.actionAtItemEnd = loop ? .none : .pause
    if loop {
      NotificationCenter.default.addObserver(
        forName: .AVPlayerItemDidPlayToEndTime,
        object: item,
        queue: .main
      ) { [weak self] note in
        guard let self = self, let item = note.object as? AVPlayerItem else { return }
        item.seek(to: .zero) { _ in }
        self.player?.play()
      }
    } else {
      NotificationCenter.default.addObserver(
        forName: .AVPlayerItemDidPlayToEndTime,
        object: item,
        queue: .main
      ) { [weak self] _ in
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
          self?.handleEnded()
        }
      }
    }

    timeObserver = p.addPeriodicTimeObserver(forInterval: CMTimeMake(value: 1, timescale: 5), queue: .main) { [weak self] time in
      guard let self = self else { return }
      // Duration can be NaN/indefinite for a just-loaded or unplayable item;
      // never pipe a non-finite Double into Int64 (that traps the process).
      let positionMS = self.ms(CMTimeGetSeconds(time))
      let durationMS = self.ms(CMTimeGetSeconds(p.currentItem?.duration ?? .zero))
      if positionMS > 0 || durationMS > 0 {
        self.emitPlayerState(playing: p.rate > 0, position: positionMS, duration: durationMS, ended: false)
      }
    }

    player = p
    active = true
    endedNotified = false
    call.resolve(["duration": self.ms(CMTimeGetSeconds(item.duration))])
  }

  @objc func play(_ call: CAPPluginCall) {
    player?.play()
    notifyPlayerStateChanged()
    call.resolve()
  }

  @objc func pause(_ call: CAPPluginCall) {
    player?.pause()
    notifyPlayerStateChanged()
    call.resolve()
  }

  @objc func seekTo(_ call: CAPPluginCall) {
    guard let positionMS = call.getDouble("position"), positionMS.isFinite else {
      call.reject("position is required")
      return
    }
    let time = CMTimeMake(value: Int64(positionMS), timescale: 1000)
    player?.seek(to: time, toleranceBefore: .zero, toleranceAfter: .zero)
    call.resolve()
  }

  @objc func setVolume(_ call: CAPPluginCall) {
    let volume = Float(call.getDouble("volume", 1.0) ?? 1.0)
    player?.volume = min(1, max(0, volume))
    call.resolve()
  }

  @objc func getState(_ call: CAPPluginCall) {
    call.resolve([
      "playing": player?.rate ?? 0 > 0,
      "position": positionMS(),
      "duration": durationMS(),
    ])
  }

  @objc func dispose(_ call: CAPPluginCall) {
    teardown()
    call.resolve()
  }

  /// AVPlayer requires an absolute, sandbox-resolvable file URL. The JS side may
  /// hand us a relative app-sandbox path (`imported/foo.mp3`) or a webview
  /// `capacitor://`/`_capacitor_file_` src — map those onto real file URLs so a
  /// track can never silently fail to load. Symlinks are resolved (`/var` →
  /// `/private/var`), which is what AVFoundation actually opens.
  private func normalizedURL(_ urlString: String) -> URL? {
    if urlString.hasPrefix("file://") {
      let path = String(urlString.dropFirst("file://".count))
      return URL(fileURLWithPath: path).resolvingSymlinksInPath()
    }
    if urlString.hasPrefix("capacitor://localhost/_capacitor_file_") {
      let rest = String(urlString.dropFirst("capacitor://localhost/_capacitor_file_".count))
      return URL(fileURLWithPath: rest).resolvingSymlinksInPath()
    }
    for prefix in ["http://localhost/_capacitor_file_", "https://localhost/_capacitor_file_"]
      where urlString.hasPrefix(prefix) {
      let rest = String(urlString.dropFirst(prefix.count))
      return URL(fileURLWithPath: rest).resolvingSymlinksInPath()
    }
    if urlString.hasPrefix("http://") || urlString.hasPrefix("https://") {
      return URL(string: urlString)
    }
    // Relative app-sandbox path (or bare filename).
    let rel = urlString.hasPrefix("/") ? String(urlString.dropFirst()) : urlString
    guard !rel.isEmpty else { return nil }
    let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
    return docs.appendingPathComponent(rel).resolvingSymlinksInPath()
  }

  private func handleEnded() {
    guard active else { return }
    endedNotified = true
    emitPlayerState(playing: false, position: 0, duration: durationMS(), ended: true)
  }

  private func notifyPlayerStateChanged() {
    emitPlayerState(playing: player?.rate ?? 0 > 0, position: positionMS(), duration: durationMS(), ended: false)
  }

  private func positionMS() -> Int64 {
    guard let p = player else { return 0 }
    return ms(CMTimeGetSeconds(p.currentTime()))
  }

  private func durationMS() -> Int64 {
    guard let d = player?.currentItem?.duration, d.isNumeric else { return 0 }
    return ms(CMTimeGetSeconds(d))
  }

  /// Safe milliseconds conversion — returns 0 for NaN/±Infinity instead of
  /// trapping in `Int64(_:)`.
  private func ms(_ seconds: Double) -> Int64 {
    seconds.isFinite ? Int64(seconds * 1000) : 0
  }

  private func emitPlayerState(playing: Bool, position: Int64, duration: Int64, ended: Bool) {
    guard active else { return }
    notifyListeners("playerState", data: [
      "playing": playing,
      "position": position,
      "duration": duration,
      "ended": ended,
    ])
  }

  private func emitMeter(rms: Double, spectrum: [Int], sampleRate: Double) {
    guard active else { return }
    notifyListeners("meter", data: [
      "rms": min(1, max(0, rms)),
      "rmsRaw": min(1, max(0, rms)),
      "spectrum": spectrum,
      "sampleRate": Int(sampleRate),
    ])
  }

  private func teardown() {
    if let token = pendingEndNotificationToken {
      NotificationCenter.default.removeObserver(token)
      pendingEndNotificationToken = nil
    }
    if let token = interruptionToken {
      NotificationCenter.default.removeObserver(token)
      interruptionToken = nil
    }
    if let obs = timeObserver, let p = player {
      p.removeTimeObserver(obs)
    }
    timeObserver = nil
    player?.pause()
    player = nil
    active = false
    wasInterruptedWhilePlaying = false
  }
}

/** State carried across the tap's C callbacks (C callbacks can't capture Swift context). */
private final class TapSession {
  var handler: MeterTap.FrameHandler?
}

/** MTAudioProcessingTap that turns the player's audio mix into RMS + spectrum. */
enum MeterTap {
  typealias FrameHandler = (Double, [Int], Double) -> Void

  static func makeTap(handler: @escaping FrameHandler) -> MTAudioProcessingTap {
    let session = TapSession()
    session.handler = handler
    // Retain the session via the tap's clientInfo/tapStorage so it outlives
    // makeTap() and stays valid for every process callback AVPlayer drives.
    // Released exactly once in `finalize` when CoreMedia deallocates the tap.
    let opaqueSession = Unmanaged.passRetained(session).toOpaque()
    var callbacks = MTAudioProcessingTapCallbacks(
      version: kMTAudioProcessingTapCallbacksVersion_0,
      clientInfo: opaqueSession,
      init: { _, clientInfo, tapStorageOut in
        tapStorageOut.pointee = clientInfo
      },
      finalize: { tap in
        // Called exactly once when the tap is deallocated (Apple's docs: free
        // tapStorage here). Release the session we retained in makeTap.
        Unmanaged<TapSession>.fromOpaque(MTAudioProcessingTapGetStorage(tap)).release()
      },
      prepare: { _, _, _ in },
      unprepare: { _ in },
      process: { tap, numberFrames, _, bufferListInOut, numberFramesOut, flagsOut in
        let status = MTAudioProcessingTapGetSourceAudio(tap, numberFrames, bufferListInOut, flagsOut, nil, numberFramesOut)
        guard status == noErr, let buffer = bufferListInOut.pointee.mBuffers.mData else { return }
        let session = Unmanaged<TapSession>.fromOpaque(MTAudioProcessingTapGetStorage(tap)).takeUnretainedValue()
        guard let handler = session.handler else { return }
        let frames = Int(numberFrames)
        let sampleRate = 48000.0
        let ptr = buffer.assumingMemoryBound(to: Float.self)
        var rms: Float = 0
        vDSP_rmsqv(ptr, 1, &rms, vDSP_Length(frames))
        let spectrum = MeterTap.computeSpectrum(ptr, frames)
        DispatchQueue.main.async {
          handler(Double(rms), spectrum, sampleRate)
        }
      })

    var tap: Unmanaged<MTAudioProcessingTap>?
    MTAudioProcessingTapCreate(nil, &callbacks, kMTAudioProcessingTapCreationFlag_PostEffects, &tap)
    guard let managed = tap?.takeRetainedValue() else {
      Unmanaged<TapSession>.fromOpaque(opaqueSession).release()
      fatalError("Failed to create audio processing tap")
    }
    return managed
  }

  private static func computeSpectrum(_ ptr: UnsafePointer<Float>, _ n: Int) -> [Int] {
    guard n >= 16 else { return [] }
    // vDSP FFT requires a power-of-two length; clamp to the largest one <= n.
    var n2 = 16
    while n2 * 2 <= n { n2 *= 2 }
    let log2n = vDSP_Length(log2(Double(n2)))
    guard log2n >= 4, let setup = vDSP_create_fftsetup(log2n, FFTRadix(kFFTRadix2)) else { return [] }
    var reals = [Float](repeating: 0, count: n2)
    var imags = [Float](repeating: 0, count: n2)
    memcpy(&reals, ptr, n2 * MemoryLayout<Float>.size)
    reals.withUnsafeMutableBufferPointer { rp in
      imags.withUnsafeMutableBufferPointer { ip in
        var split = DSPSplitComplex(realp: rp.baseAddress!, imagp: ip.baseAddress!)
        vDSP_fft_zip(setup, &split, 1, log2n, FFTDirection(FFT_FORWARD))
      }
    }
    var spectrum: [Int] = []
    spectrum.reserveCapacity(n2 / 2)
    for b in 1..<(n2 / 2) {
      let mag = sqrt(Double(reals[b] * reals[b] + imags[b] * imags[b]))
      let amp = mag / Double(n2 / 2)
      let db = 20.0 * log10(max(amp, 1e-6))
      let v = Int(((db + 100.0) / 70.0 * 255.0).rounded())
      spectrum.append(max(0, min(255, v)))
    }
    vDSP_destroy_fftsetup(setup)
    return spectrum
  }
}