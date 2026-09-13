import ReplayKit
import Accelerate
import CoreMedia

/**
 * FlipFlip Broadcast Upload Extension — the only iOS way to capture system
 * audio while another app is playing (per iosAudio.md / SYSTEM_AUDIO_CAPTURE.md).
 *
 * The extension runs in its own process. Every `.audioApp` CMSampleBuffer is
 * converted to mono Float32 PCM (handling big-endian and non-interleaved
 * layouts), RMS + magnitude spectrum are computed with vDSP, and ONE compact
 * JSON frame is written into the shared App Group container.
 * The main app's FlipSystemAudioPlugin polls that file and re-emits Capacitor
 * `data` events to JS (which feeds AudioAnalyzer.startFromMeter unchanged).
 *
 * A `flipflip_state.json` heartbeat is also written so the app can display
 * live extension health (started / buffer counts / write errors) in-app,
 * since extension `print` output is not visible in the WebView console.
 *
 * UX: the user must start a Broadcast from Control Center (or the in-app
 * picker) each session; iOS shows the red recording banner. No silent capture.
 */
class SampleHandler: RPBroadcastSampleHandler {

    private let appGroupId = "group.com.flipflip.app"
    private let meterFileName = "flipflip_meter.json"
    private let stateFileName = "flipflip_state.json"
    private let fftSize = 2048

    private var log2n: vDSP_Length = 0
    private var fftSetup: FFTSetup?
    private var window = [Float]()

    private var stateTimer: Timer?

    // MARK: - Lifecycle

    override func broadcastStarted(withSetupInfo setupInfo: [String: NSObject]?) {
        log2n = vDSP_Length(log2(Double(fftSize)))
        fftSetup = vDSP_create_fftsetup(log2n, FFTRadix(kFFTRadix2))
        if fftSetup == nil {
            NSLog("[FlipMeter] vDSP_create_fftsetup returned nil")
        }
        window.removeAll(keepingCapacity: true)
        lastStateTime = 0
        lastStateSignature = ""
        clearMeterFile()
        writeState()
        startStateTimer()
        NSLog("[FlipMeter] broadcastStarted; meterURL=\(meterURL()?.path ?? "nil")")
    }

    override func broadcastPaused() {
        NSLog("[FlipMeter] broadcastPaused")
    }

    override func broadcastResumed() {
        NSLog("[FlipMeter] broadcastResumed")
    }

    override func broadcastFinished() {
        NSLog("[FlipMeter] broadcastFinished")
        stopStateTimer()
        writeState()
        clearMeterFile()
    }

    private func startStateTimer() {
        stopStateTimer()
        let t = Timer(timeInterval: 2.0, repeats: true) { [weak self] _ in
            self?.writeState()
        }
        RunLoop.main.add(t, forMode: .common)
        stateTimer = t
    }

    private func stopStateTimer() {
        stateTimer?.invalidate()
        stateTimer = nil
    }

    // MARK: - Sample processing

    private var bufferCounts: [RPSampleBufferType: Int] = [:]
    private var pcmNilCount = 0
    private var pcmGarbageCount = 0
    private var wroteCount = 0
    private var wroteLogged = false
    private var lastWriteError: String? = nil
    private var lastStateTime: TimeInterval = 0
    private var lastStateSignature = ""
    private var audioAppLogged = false

    override func processSampleBuffer(
        _ sampleBuffer: CMSampleBuffer,
        with sampleBufferType: RPSampleBufferType
    ) {
        bufferCounts[sampleBufferType, default: 0] += 1
        if bufferCounts[sampleBufferType, default: 0] == 1 || bufferCounts[sampleBufferType, default: 0] % 300 == 0 {
            NSLog("[FlipMeter] buffer type=\(sampleBufferType.rawValue) count=\(bufferCounts[sampleBufferType, default: 0])")
        }
        guard sampleBufferType == .audioApp else { return }
        guard let samples = pcmToFloat(sampleBuffer) else {
            pcmNilCount += 1
            NSLog("[FlipMeter] pcmToFloat returned nil (audioApp) total=\(pcmNilCount)")
            return
        }
        if samples.isEmpty {
            pcmGarbageCount += 1
            NSLog("[FlipMeter] pcmToFloat returned empty (audioApp) total=\(pcmGarbageCount)")
            return
        }
        if !audioAppLogged {
            audioAppLogged = true
            NSLog("[FlipMeter] first audioApp: samples=\(samples.count)")
        }
        window.append(contentsOf: samples)

        // Emit once every ~1024 samples (~21Hz @48k; keeps the JS feed high-throughput).
        let chunk = 1024
        if window.count >= chunk {
            let frameSamples = Array(window.suffix(chunk))
            window.removeFirst(max(0, window.count - chunk))
            writeFrame(pcm: frameSamples)
        }
    }

    // MARK: - PCM extraction

    /**
     * Converts an .audioApp CMSampleBuffer to mono Float32 [-1,1].
     *
     * Handles both interleaved (1 buffer, N channels) and non-interleaved
     * (N buffers, 1 channel each) layouts, and both little- and big-endian
     * sample data (big-endian is common for `.audioApp`).
     */
    private func pcmToFloat(_ sampleBuffer: CMSampleBuffer) -> [Float]? {
        guard let formatDesc = CMSampleBufferGetFormatDescription(sampleBuffer),
              let asbd = CMAudioFormatDescriptionGetStreamBasicDescription(formatDesc)?.pointee else {
            return nil
        }
        let channels = max(1, Int(asbd.mChannelsPerFrame))
        let bits = Int(asbd.mBitsPerChannel)
        let flags = asbd.mFormatFlags
        let isFloat = (flags & AudioFormatFlags(kAudioFormatFlagIsFloat)) != 0
        let isBigEndian = (flags & AudioFormatFlags(kAudioFormatFlagIsBigEndian)) != 0
        let isNonInterleaved = channels > 1 && (flags & AudioFormatFlags(kAudioFormatFlagIsNonInterleaved)) != 0

        // First, determine the required buffer-list size.
        var bufferListNeeded: Int = 0
        _ = CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(
            sampleBuffer,
            bufferListSizeNeededOut: &bufferListNeeded,
            bufferListOut: nil,
            bufferListSize: 0,
            blockBufferAllocator: kCFAllocatorDefault,
            blockBufferMemoryAllocator: kCFAllocatorDefault,
            flags: 0,
            blockBufferOut: nil
        )
        if bufferListNeeded <= 0 {
            bufferListNeeded = MemoryLayout<AudioBufferList>.size + (max(1, channels) - 1) * MemoryLayout<AudioBuffer>.size
        }

        let ptr = UnsafeMutablePointer<AudioBufferList>.allocate(capacity: bufferListNeeded)
        defer { ptr.deallocate() }
        ptr.initialize(to: AudioBufferList(mNumberBuffers: UInt32(max(1, channels)),
                                           mBuffers: AudioBuffer(mNumberChannels: 0, mDataByteSize: 0, mData: nil)))

        var blockBuffer: CMBlockBuffer?
        defer { blockBuffer = nil }
        let status = CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(
            sampleBuffer,
            bufferListSizeNeededOut: nil,
            bufferListOut: ptr,
            bufferListSize: bufferListNeeded,
            blockBufferAllocator: kCFAllocatorDefault,
            blockBufferMemoryAllocator: kCFAllocatorDefault,
            flags: kCMSampleBufferFlag_AudioBufferList_Assure16ByteAlignment,
            blockBufferOut: &blockBuffer
        )
        guard status == kCMBlockBufferNoErr || status == noErr else { return nil }

        let list = UnsafeMutableAudioBufferListPointer(ptr)

        if isNonInterleaved {
            // Each buffer holds its channel's samples.
            var perChannel: [[Float]] = Array(repeating: [], count: channels)
            for (idx, buf) in list.enumerated() {
                let data = buf.mData
                let byteCount = Int(buf.mDataByteSize)
                guard data != nil, byteCount > 0, idx < channels else { continue }
                perChannel[idx] = extractSamples(data: data!, byteCount: byteCount, bits: bits, isFloat: isFloat, isBigEndian: isBigEndian)
            }
            let frameCount = perChannel.map { $0.count }.min() ?? 0
            guard frameCount > 0 else { return [] }
            var mono = [Float](repeating: 0, count: frameCount)
            if channels >= 1, perChannel[0].count >= frameCount {
                for f in 0..<frameCount {
                    var sum: Float = 0
                    for c in 0..<channels {
                        sum += perChannel[c][f]
                    }
                    mono[f] = sum / Float(channels)
                }
            }
            return mono
        }

        // Interleaved: samples arrive in one (or more) allocated buffers.
        var planar = [Float]()
        for buf in list {
            let data = buf.mData
            let byteCount = Int(buf.mDataByteSize)
            guard data != nil, byteCount > 0 else { continue }
            planar.append(contentsOf: extractSamples(data: data!, byteCount: byteCount, bits: bits, isFloat: isFloat, isBigEndian: isBigEndian))
        }
        return downmixToMono(planar, channels: channels)
    }

    private func extractSamples(data: UnsafeMutableRawPointer, byteCount: Int, bits: Int, isFloat: Bool, isBigEndian: Bool) -> [Float] {
        guard byteCount > 0 else { return [] }

        if isFloat {
            let count = byteCount / MemoryLayout<Float>.size
            guard count > 0 else { return [] }
            var out = [Float](repeating: 0, count: count)
            if isBigEndian {
                let bytes = data.assumingMemoryBound(to: UInt8.self)
                for i in 0..<count {
                    var u: UInt32 = 0
                    u = UInt32(bytes[(i * 4) + 0]) << 24
                    u |= UInt32(bytes[(i * 4) + 1]) << 16
                    u |= UInt32(bytes[(i * 4) + 2]) << 8
                    u |= UInt32(bytes[(i * 4) + 3])
                    out[i] = Float(bitPattern: u)
                }
            } else {
                data.withMemoryRebound(to: Float.self, capacity: count) { fptr in
                    for i in 0..<count { out[i] = fptr[i] }
                }
            }
            return out
        }

        if bits == 24 {
            let bytes = data.assumingMemoryBound(to: UInt8.self)
            let frames = byteCount / 3
            var out = [Float](repeating: 0, count: frames)
            for i in 0..<frames {
                var s: Int32 = 0
                if isBigEndian {
                    let b0 = Int32(bytes[(i * 3) + 0]) << 16
                    let b1 = Int32(bytes[(i * 3) + 1]) << 8
                    let b2 = Int32(bytes[(i * 3) + 2])
                    s = (b0 | b1 | b2)
                    if s & 0x800000 != 0 { s |= ~0xFFFFFF }
                } else {
                    let b0 = Int32(bytes[(i * 3) + 0])
                    let b1 = Int32(bytes[(i * 3) + 1]) << 8
                    let b2 = Int32(bytes[(i * 3) + 2]) << 16
                    s = (b0 | b1 | b2)
                    if s & 0x800000 != 0 { s |= ~0xFFFFFF }
                }
                out[i] = Float(s) / 8388608.0
            }
            return out
        }

        let count = byteCount / MemoryLayout<Int16>.size
        guard count > 0 else { return [] }
        var out = [Float](repeating: 0, count: count)
        if isBigEndian {
            let bytes = data.assumingMemoryBound(to: UInt8.self)
            for i in 0..<count {
                var s: Int16 = 0
                s = Int16(bitPattern: UInt16(bytes[(i * 2)]) << 8 | UInt16(bytes[(i * 2) + 1]))
                out[i] = Float(s) / 32768.0
            }
        } else {
            data.withMemoryRebound(to: Int16.self, capacity: count) { iptr in
                for i in 0..<count { out[i] = Float(iptr[i]) / 32768.0 }
            }
        }
        return out
    }

    /** If the buffer is interleaved (channels > 1), downmix to mono. */
    private func downmixToMono(_ samples: [Float], channels: Int) -> [Float] {
        guard channels > 1 else { return samples }
        let frames = samples.count / channels
        guard frames > 0 else { return [] }
        var mono = [Float](repeating: 0, count: frames)
        for f in 0..<frames {
            var sum: Float = 0
            for c in 0..<channels {
                sum += samples[f * channels + c]
            }
            mono[f] = sum / Float(channels)
        }
        return mono
    }

    // MARK: - Analysis

    /** Computes RMS + 256-bin magnitude spectrum and writes one JSON frame. */
    private func writeFrame(pcm: [Float]) {
        guard pcm.count >= 128 else { return }
        let rmsRaw = computeRMS(pcm)

        var spectrum: [Int] = []
        if let setup = fftSetup {
            spectrum = computeSpectrum(pcm, setup: setup)
        } else {
            spectrum = Array(repeating: 0, count: 256)
        }

        let obj: [String: Any] = [
            "rms": rmsRaw,
            "rmsRaw": rmsRaw,
            "spectrum": spectrum,
            "waveform": [],
        ]
        guard let payload = try? JSONSerialization.data(withJSONObject: obj, options: []) else { return }
        writeAtomically(payload: payload)
    }

    private func computeRMS(_ pcm: [Float]) -> Double {
        var sumSq: Float = 0
        vDSP_measqv(pcm, 1, &sumSq, vDSP_Length(pcm.count))
        return Double(sqrt(sumSq)) // mean-square -> RMS, expressed 0..1 for [-1,1] input
    }

    private func computeSpectrum(_ pcm: [Float], setup: FFTSetup) -> [Int] {
        let n = fftSize
        var realp = [Float](repeating: 0, count: n)
        var imag = [Float](repeating: 0, count: n)
        let copyCount = min(n, pcm.count)
        realp.replaceSubrange(0..<copyCount, with: pcm[0..<copyCount])

        // Input is purely real: sample values go into realp with imagp == 0.
        var magSq = [Float](repeating: 0, count: n / 2)
        realp.withUnsafeMutableBufferPointer { rb in
            imag.withUnsafeMutableBufferPointer { ib in
                var dsp = DSPSplitComplex(realp: rb.baseAddress!, imagp: ib.baseAddress!)
                vDSP_fft_zrip(setup, &dsp, 1, log2n, FFTDirection(FFT_FORWARD))
                vDSP_zvmags(&dsp, 1, &magSq, 1, vDSP_Length(n / 2))
            }
        }

        var mag = [Float](repeating: 0, count: n / 2)
        for i in 0..<(n / 2) { mag[i] = sqrtf(magSq[i]) } // magnitude

        let refAmplitude = Float(n) / 2.0 // full-scale amplitude of a sine at FFT size
        var bins = [Int](repeating: 0, count: 256)
        let per = (n / 2) / 256
        for b in 0..<256 {
            var sum: Float = 0
            let start = b * per
            let end = min(start + per, n / 2)
            for i in start..<end { sum += mag[i] }
            let amp = sum / Float(max(1, end - start)) / refAmplitude
            let db = 20.0 * log10(max(Double(amp), 1e-6))
            let value = Int((db + 100.0) / 70.0 * 255.0)
            bins[b] = max(0, min(255, value))
        }
        return bins
    }

    // MARK: - App Group files

    private func containerURL() -> URL? {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroupId)
    }

    private func meterURL() -> URL? {
        containerURL()?.appendingPathComponent(meterFileName)
    }

    private func stateURL() -> URL? {
        containerURL()?.appendingPathComponent(stateFileName)
    }

    /** Writes a health/state JSON the main app can read to surface live status. */
    func writeState() {
        let now = Date().timeIntervalSince1970
        if now - lastStateTime < 1.0 { return }
        lastStateTime = now

        let obj: [String: Any] = [
            "started": true,
            "ts": now,
            "containerNil": containerURL() == nil,
            "audioApp": bufferCounts[.audioApp] ?? 0,
            "audioMic": bufferCounts[.audioMic] ?? 0,
            "video": bufferCounts[.video] ?? 0,
            "pcmNil": pcmNilCount,
            "pcmGarbage": pcmGarbageCount,
            "wrote": wroteCount,
            "lastWriteError": lastWriteError ?? "",
            "fftOK": fftSetup != nil,
        ]
        guard let payload = try? JSONSerialization.data(withJSONObject: obj, options: []) else { return }
        let sig = String(data: payload, encoding: .utf8) ?? ""
        if sig == lastStateSignature { return }
        lastStateSignature = sig
        guard let url = stateURL() else { return }
        do {
            try payload.write(to: url, options: .atomic)
        } catch {
            // swallows transient extension-teardown write errors
        }
    }

    private func writeAtomically(payload: Data?) {
        guard let payload = payload else { return }
        guard let url = meterURL() else {
            if !wroteLogged {
                wroteLogged = true
                NSLog("[FlipMeter] meterURL() is nil — App Group container unavailable")
            }
            return
        }
        do {
            try payload.write(to: url, options: .atomic)
            wroteCount += 1
            if !wroteLogged {
                wroteLogged = true
                NSLog("[FlipMeter] first frame written to \(url.path)")
            }
        } catch {
            let msg = "\(error)"
            if lastWriteError != msg {
                lastWriteError = msg
                NSLog("[FlipMeter] write failed: \(msg)")
            }
        }
    }

    private func clearMeterFile() {
        guard let url = meterURL() else { return }
        try? FileManager.default.removeItem(at: url)
    }
}
