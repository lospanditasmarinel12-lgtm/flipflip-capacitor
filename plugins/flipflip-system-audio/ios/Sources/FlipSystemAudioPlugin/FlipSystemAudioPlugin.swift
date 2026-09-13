import Capacitor
import Foundation
import ReplayKit
import UIKit

/**
 * FlipSystemAudio — native system-audio meter for FlipFlip haptics.
 *
 * iOS (Phase C): the ReplayKit Broadcast Upload Extension computes RMS + FFT
 * of the system audio output mix and writes compact JSON frames into the
 * shared App Group container. This plugin polls that file and re-emits each
 * frame as a Capacitor `data` event feeding AudioAnalyzer.startFromMeter.
 *
 * The user must start a Broadcast each session (there is no silent capture);
 * `startBroadcast` presents the system RPSystemBroadcastPickerView targeted at
 * the app's existing BroadcastExtension so the haptics card can trigger it
 * in-app instead of requiring Control Center.
 */
@objc(FlipSystemAudio)
public class FlipSystemAudioPlugin: CAPPlugin, CAPBridgedPlugin {
  public let identifier = "FlipSystemAudio"
  public let jsName = "FlipSystemAudio"
  public let pluginMethods: [CAPPluginMethod] = [
    CAPPluginMethod(name: "startCapture", returnType: CAPPluginReturnPromise),
    CAPPluginMethod(name: "stopCapture", returnType: CAPPluginReturnPromise),
    CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise),
    CAPPluginMethod(name: "getState", returnType: CAPPluginReturnPromise),
    CAPPluginMethod(name: "startBroadcast", returnType: CAPPluginReturnPromise),
  ]

  private let appGroupId = "group.com.flipflip.app"
  private let meterFileName = "flipflip_meter.json"
  private let stateFileName = "flipflip_state.json"
  private let pollInterval = 0.033 // ~30Hz

  private var pollTimer: DispatchSourceTimer?
  private var pollTick = 0
  private var lastPayload: Data?
  private var reportedFailures = Set<String>()

  private func meterURL() -> URL? {
    FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroupId)?
      .appendingPathComponent(meterFileName)
  }

  private func stateURL() -> URL? {
    FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroupId)?
      .appendingPathComponent(stateFileName)
  }

  func getExtensionState() -> [String: Any]? {
    guard let url = stateURL() else { return ["containerNil": true] }
    guard let data = try? Data(contentsOf: url) else { return ["stateMissing": true] }
    var state = (try? JSONSerialization.jsonObject(with: data, options: [])) as? [String: Any] ?? [:]
    state["meter"] = meterFileFacts()
    return state
  }

  /// App-side facts about the meter file so the in-app Refresh Status readout
  /// can localize a failure without any console logging:
  /// visible / bytes / age(s) / readable / parsed.
  private func meterFileFacts() -> [String: Any] {
    guard let url = meterURL() else { return ["meterVisible": false] }
    guard let attrs = try? FileManager.default.attributesOfItem(atPath: url.path),
          let mtime = (attrs[.modificationDate] as? Date)?.timeIntervalSince1970 else {
      return ["meterVisible": false, "meterPath": url.path]
    }
    let bytes = (attrs[.size] as? NSNumber)?.intValue ?? -1
    let age = Date().timeIntervalSince1970 - mtime
    guard let data = try? Data(contentsOf: url) else {
      return ["meterVisible": true, "meterBytes": bytes, "meterAge": age, "meterReadable": false]
    }
    let parsed = (try? JSONSerialization.jsonObject(with: data, options: [])) != nil
    return ["meterVisible": true, "meterBytes": bytes, "meterAge": age, "meterReadable": true, "meterParsed": parsed]
  }

  @objc func getState(_ call: CAPPluginCall) {
    let state = getExtensionState() ?? ["stateMissing": true]
    call.resolve(state)
  }

  @objc func startCapture(_ call: CAPPluginCall) {
    stopPolling()
    lastPayload = nil
    reportedFailures.removeAll()
    framesSent = 0
    pollTick = 0
    let tick = pollInterval
    let source = DispatchSource.makeTimerSource(queue: DispatchQueue.main)
    source.schedule(deadline: .now() + tick, repeating: tick)
    source.setEventHandler { [weak self] in
      self?.poll()
    }
    pollTimer = source
    source.resume()
    if let state = getExtensionState() {
      print("[FlipSystemAudio] extension state:", state)
    } else {
      print("[FlipSystemAudio] extension state: MISSING")
    }
    call.resolve([
      "deviceId": "replaykit-broadcast",
      "label": "Broadcast (ReplayKit) — start from Control Center",
    ])
  }

  @objc func stopCapture(_ call: CAPPluginCall) {
    stopPolling()
    call.resolve()
  }

  @objc func isAvailable(_ call: CAPPluginCall) {
    // The extension target is always embedded; availability only means the
    // plugin exists (the active broadcast is a user action, detected live).
    call.resolve(["available": true])
  }

  /// Presents the system broadcast picker (RPSystemBroadcastPickerView) targeted
  /// at this app's existing BroadcastExtension so the user can start system-audio
  /// capture from inside the haptics card instead of via Control Center.
  @objc func startBroadcast(_ call: CAPPluginCall) {
    DispatchQueue.main.async { [weak self] in
      self?.showBroadcastPicker()
    }
    call.resolve()
  }

  private func showBroadcastPicker() {
    let picker = RPSystemBroadcastPickerView(
      frame: CGRect(x: 0, y: 0, width: 44, height: 44)
    )
    picker.preferredExtension = "com.flipflip.app.BroadcastExtension"
    picker.showsMicrophoneButton = false
    // A non-zero frame keeps the view tappable on iPad (where a zero-size
    // target is invisible).
    picker.translatesAutoresizingMaskIntoConstraints = false

    guard let host = topMostViewController() else {
      print("[FlipSystemAudio] startBroadcast: no view controller to anchor the picker")
      return
    }

    let overlay = UIView(frame: host.view.bounds)
    overlay.backgroundColor = UIColor.black.withAlphaComponent(0.45)
    overlay.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    overlay.alpha = 0

    let card = UIStackView()
    card.axis = .vertical
    card.alignment = .center
    card.spacing = 12
    card.translatesAutoresizingMaskIntoConstraints = false
    overlay.addSubview(card)

    let label = UILabel()
    label.text = "FlipFlip Audio Meter — tap to start broadcast"
    label.textColor = .white
    label.font = UIFont.systemFont(ofSize: 14, weight: .medium)
    label.textAlignment = .center
    label.numberOfLines = 0
    label.translatesAutoresizingMaskIntoConstraints = false
    card.addArrangedSubview(label)

    // Put the picker inside a white card so its tap target is clearly tappable
    // regardless of the surrounding dim overlay.
    let pickerCard = UIView()
    pickerCard.backgroundColor = .white
    pickerCard.layer.cornerRadius = 8
    pickerCard.translatesAutoresizingMaskIntoConstraints = false
    let pickerContainer = UIView()
    pickerContainer.translatesAutoresizingMaskIntoConstraints = false
    pickerContainer.addSubview(picker)
    pickerCard.addSubview(pickerContainer)
    card.addArrangedSubview(pickerCard)

    NSLayoutConstraint.activate([
      card.centerXAnchor.constraint(equalTo: overlay.centerXAnchor),
      card.centerYAnchor.constraint(equalTo: overlay.centerYAnchor),
      label.leadingAnchor.constraint(equalTo: card.leadingAnchor),
      label.trailingAnchor.constraint(equalTo: card.trailingAnchor),

      pickerCard.widthAnchor.constraint(equalToConstant: 64),
      pickerCard.heightAnchor.constraint(equalToConstant: 64),
      pickerContainer.centerXAnchor.constraint(equalTo: pickerCard.centerXAnchor),
      pickerContainer.centerYAnchor.constraint(equalTo: pickerCard.centerYAnchor),
      pickerContainer.widthAnchor.constraint(equalToConstant: 44),
      pickerContainer.heightAnchor.constraint(equalToConstant: 44),
      picker.centerXAnchor.constraint(equalTo: pickerContainer.centerXAnchor),
      picker.centerYAnchor.constraint(equalTo: pickerContainer.centerYAnchor),
      picker.widthAnchor.constraint(equalToConstant: 44),
      picker.heightAnchor.constraint(equalToConstant: 44),
    ])

    host.view.addSubview(overlay)
    UIView.animate(withDuration: 0.2, animations: {
      overlay.alpha = 1
    })

    // Auto-dismiss shortly after presentation: the picker pushes its own system
    // broadcast UI on tap, so we don't want the overlay lingering full-screen.
    DispatchQueue.main.asyncAfter(deadline: .now() + 3.0) { [weak overlay] in
      UIView.animate(withDuration: 0.2, animations: {
        overlay?.alpha = 0
      }, completion: { _ in
        overlay?.removeFromSuperview()
      })
    }
  }

  private func topMostViewController() -> UIViewController? {
    let keyWindow = UIApplication.shared.connectedScenes
      .compactMap { $0 as? UIWindowScene }
      .filter { $0.activationState == .foregroundActive }
      .flatMap { $0.windows }
      .first { $0.isKeyWindow }
    var top = keyWindow?.rootViewController
    while let presented = top?.presentedViewController {
      top = presented
    }
    return top
  }

  private var framesSent = 0

  private func poll() {
    pollTick += 1
    // Heartbeat every ~10s so "timer alive" is visible in console even when the
    // file is missing or the payload is unchanged (e.g. silence frames).
    if pollTick % 300 == 0 {
      print("[FlipSystemAudio] poll alive tick=\(pollTick)")
    }
    guard let url = meterURL() else {
      reportOnce("meterURLNil")
      return
    }

    var data: Data
    do {
      data = try Data(contentsOf: url)
    } catch {
      reportOnce("readFailed(\(error.localizedDescription))")
      return
    }
    // A real parsed frame always exceeds a few hundred bytes; skip the brief
    // window where the extension is between writes / mid-rename.
    if data.count < 32 {
      reportOnce("payloadTiny(\(data.count))")
      return
    }

    // Payload-diff detection: the extension rewrites ~43Hz and we poll ~30Hz,
    // so every tick normally sees a fresh frame. No reliance on file mtime or
    // attributesOfItem — both were suspects for the silent stall.
    if let last = lastPayload, last == data {
      return
    }
    lastPayload = data

    guard let json = try? JSONSerialization.jsonObject(with: data, options: []) as? [String: Any] else {
      reportOnce("parseFailed")
      return
    }

    let spectrum = (json["spectrum"] as? [Int] ?? []).map { max(0, min(255, $0)) }
    let waveform = json["waveform"] as? [Int] ?? []
    let rms = (json["rms"] as? Double ?? 0.0)
    let rmsRaw = (json["rmsRaw"] as? Double ?? rms)

    if framesSent < 5 {
      framesSent += 1
      print("[FlipSystemAudio] meter frame #\(framesSent) rms=\(rms) rmsRaw=\(rmsRaw) spectrumBins=\(spectrum.count)")
    }

    // One-shot trace if the feed stalled earlier and has recovered.
    if !reportedFailures.isEmpty {
      print("[FlipSystemAudio] frames resumed after: \(reportedFailures.joined(separator: ", "))")
      reportedFailures.removeAll()
    }

    notifyListeners("data", data: [
      "rms": clamp01(rms),
      "rmsRaw": clamp01(rmsRaw),
      "spectrum": spectrum,
      "waveform": waveform,
    ])
  }

  /// Logs each distinct poll failure exactly once (no per-second spam).
  private func reportOnce(_ key: String) {
    guard !reportedFailures.contains(key) else { return }
    reportedFailures.insert(key)
    print("[FlipSystemAudio] poll \(key)")
  }

  private func stopPolling() {
    pollTimer?.cancel()
    pollTimer = nil
  }

  private func clamp01(_ v: Double) -> Double {
    min(1, max(0, v))
  }

  deinit {
    stopPolling()
  }
}
