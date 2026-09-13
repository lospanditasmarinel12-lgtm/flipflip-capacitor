import { AudioContext } from 'standardized-audio-context';
import { AudioAnalysisFrame } from './types';
import { NativeMeterFrame, MeterSubscription } from '../audio/ISystemAudioCapture';

export const FFT_SIZE = 2048;
const SMOOTHING_TIME_CONSTANT = 0.8;
const POLL_INTERVAL_MS = 32;
const WARMUP_FRAMES = 5;
const READINESS_POLL_MS = 100;
const READINESS_TIMEOUT_MS = 5000;

let unlockRegistered = false;
let pendingBind: { analyzer: AudioAnalyzer | null } | null = null;

/**
 * iOS/WebKit suspends an AudioContext until a user gesture. The analyser must
 * never bind a media element while the context is suspended — that exclusively
 * routes the element's audio into a dead graph and mutes the track. Instead we
 * stash the element and bind it on the next gesture once the context resumes.
 */
function registerGestureUnlock() {
  if (unlockRegistered) return;
  unlockRegistered = true;
  const handler = () => {
    document.removeEventListener('pointerdown', handler);
    document.removeEventListener('touchend', handler);
    document.removeEventListener('mousedown', handler);
    unlockContexts();
  };
  document.addEventListener('pointerdown', handler);
  document.addEventListener('touchend', handler);
  document.addEventListener('mousedown', handler);
}

const liveContexts: AudioContext[] = [];

async function unlockContexts(): Promise<void> {
  for (const ctx of liveContexts) {
    try {
      if (ctx.state === 'suspended') {
        await (ctx as any).resume?.().catch(() => {});
      }
    } catch (e) {}
  }
  // Re-attempt a deferred media-element binding now that the context runs.
  const pend = pendingBind;
  if (pend && pend.analyzer) {
    const a = pend.analyzer;
    const el = a.getPendingElement();
    if (el) {
      a.tryBindPending(el).catch(() => {});
    }
  }
}

export class AudioAnalyzer {
  private _ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private source: any = null;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private _readinessTimer: ReturnType<typeof setInterval> | null = null;
  private _meterUnsubscribe: (() => void) | null = null;
  private smoothedRms = 0;
  private onFrame: ((frame: AudioAnalysisFrame) => void) | null = null;
  private _frameCount = 0;
  /** The media element we have (or will) bind to the context. */
  private _boundElement: HTMLMediaElement | null = null;
  private _pendingElement: HTMLMediaElement | null = null;
  /**
   * Optional silent audio tap (HTMLMediaElement.captureStream) used instead of
   * createMediaElementSource. The element keeps playing natively at full
   * quality and we analyze a duplicate stream, so haptics never alter the
   * audible output. Unset on iOS/WebKit where captureStream is unavailable.
   */
  private _tapStream: MediaStream | null = null;
  alpha = 0.3;

  setSmoothing(alpha: number): void {
    this.alpha = Math.max(0.05, Math.min(0.95, alpha));
  }

  private ensureContext(): AudioContext {
    if (this._ctx && this._ctx.state !== 'closed') {
      return this._ctx;
    }
    this._ctx = new AudioContext() as unknown as AudioContext;
    registerGestureUnlock();
    if (!liveContexts.includes(this._ctx as any)) {
      liveContexts.push(this._ctx as any);
    }
    return this._ctx;
  }

  private async resumeIfNeeded(): Promise<boolean> {
    const ctx = this.ensureContext();
    if ((ctx as any).state === 'running') return true;
    try {
      await (ctx as any).resume?.();
    } catch (e) {}
    return (ctx as any).state === 'running';
  }

  getPendingElement(): HTMLMediaElement | null {
    return this._pendingElement;
  }

  async tryBindPending(el: HTMLMediaElement): Promise<void> {
    if (this._pendingElement !== el) return;
    if (await this.resumeIfNeeded()) {
      this.bindAndStart(el);
    }
  }

  /**
   * Binds the media element into the graph ONLY once the context is running.
   * If the context is still suspended (iOS/WebKit pre-gesture), the element is
   * stashed and bound on the next user gesture — never routed into a dead
   * graph (which would mute the track).
   */
  private bindAndStart(el: HTMLMediaElement): void {
    try {
      const ctx = this.ensureContext();
      if ((ctx as any).state !== 'running') {
        this._pendingElement = el;
        pendingBind = { analyzer: this };
        console.log('[Haptics] AudioContext suspended; deferring media-element routing until next gesture');
        return;
      }

      if (this.analyser == null) {
        this.analyser = ctx.createAnalyser() as any;
        (this.analyser as any).fftSize = FFT_SIZE;
        (this.analyser as any).smoothingTimeConstant = SMOOTHING_TIME_CONSTANT;
      }

      if (this._boundElement !== el) {
        // Release the previous tap/route before binding the new element.
        this.stopTapStream();
        if (this.source) {
          try { (this.source as any).disconnect(); } catch (_) {}
          this.source = null;
        }

        // Prefer a silent captureStream tap: the element keeps playing through
        // the browser's native media path (full quality) while the analyser
        // listens to a duplicate — routing the audible element into the WebAudio
        // graph (createMediaElementSource) resamples it and audibly degrades the
        // scene audio on some platforms (especially Android WebView).
        if (typeof (el as any).captureStream === 'function') {
          try {
            const stream = (el as any).captureStream() as MediaStream;
            const tap = (ctx as any).createMediaStreamSource(stream);
            tap.connect(this.analyser as any);
            this._tapStream = stream;
            this.source = tap;
            this._boundElement = el;
            console.log('[Haptics] Using captureStream tap for scene audio analysis (element plays natively)');
          } catch (tapErr) {
            console.warn('[Haptics] captureStream tap failed, falling back to createMediaElementSource:', tapErr);
            this.stopTapStream();
            this.source = null;
          }
        }

        // Fallback (iOS/WebKit, or any WebView without media captureStream):
        // route the element through the graph and pass through to destination so
        // audio stays audible (same behavior as before this change).
        if (!this.source) {
          try {
            this.source = (ctx as any).createMediaElementSource(el);
          } catch (boundErr) {
            console.warn('[Haptics] createMediaElementSource failed — element already bound to another context:', boundErr);
            return;
          }
          if (!this.source) {
            console.error('[Haptics] Failed to create media element source');
            return;
          }
          this.source.connect(this.analyser as any);
          (this.analyser as any).connect((ctx as any).destination);
          this._boundElement = el;
          console.log('[Haptics] Routing scene audio element through WebAudio graph (no captureStream)');
        }
      } else if (this._tapStream && this.source) {
        // Same element rebound; the tap stream is still live, just re-wire it.
        try { (this.source as any).disconnect(); } catch (_) {}
        this.source.connect(this.analyser as any);
      } else if (!this._tapStream && this.source) {
        try { (this.source as any).disconnect(); } catch (_) {}
        this.source.connect(this.analyser as any);
        (this.analyser as any).connect((ctx as any).destination);
      }

      this._pendingElement = null;
      pendingBind = null;
    } catch (err) {
      console.error('[Haptics] Failed to route media element:', err);
      return;
    }

    this._frameCount = 0;
    this.smoothedRms = 0;
    if (this.intervalId) clearInterval(this.intervalId);
    this.intervalId = setInterval(() => this.tick(), POLL_INTERVAL_MS);
  }

  start(audioElement: HTMLAudioElement, onFrame: (frame: AudioAnalysisFrame) => void): void {
    this.stop();
    this.onFrame = onFrame;

    const attempt = () => {
      if ((this.ensureContext() as any).state === 'running') {
        this.bindAndStart(audioElement);
      } else {
        this._pendingElement = audioElement;
        pendingBind = { analyzer: this };
        console.log('[Haptics] AudioContext suspended; deferring media-element routing until next gesture');
      }
    };

    if (audioElement.readyState >= HTMLMediaElement.HAVE_ENOUGH_DATA) {
      attempt();
    } else {
      console.log('[Haptics] Audio element not ready (readyState=' + audioElement.readyState + '), polling...');
      this._readinessTimer = setInterval(() => {
        if (audioElement.readyState >= HTMLMediaElement.HAVE_ENOUGH_DATA) {
          this.clearReadinessTimer();
          attempt();
        }
      }, READINESS_POLL_MS);
      setTimeout(() => {
        if (this._readinessTimer) {
          console.warn('[Haptics] Audio readiness timeout, attempting start anyway');
          this.clearReadinessTimer();
          attempt();
        }
      }, READINESS_TIMEOUT_MS);
    }
  }

  startFromStream(mediaStream: MediaStream, onFrame: (frame: AudioAnalysisFrame) => void): void {
    this.stop();
    this.onFrame = onFrame;

    try {
      const ctx = this.ensureContext();
      this.analyser = ctx.createAnalyser() as any;
      (this.analyser as any).fftSize = FFT_SIZE;
      (this.analyser as any).smoothingTimeConstant = SMOOTHING_TIME_CONSTANT;

      this.source = (ctx as any).createMediaStreamSource(mediaStream);
      this.source.connect(this.analyser as any);
    } catch (err) {
      console.warn('[Haptics] Failed to create stream audio context:', err);
      this.tearDownRouting();
      return;
    }

    this._frameCount = 0;
    this.smoothedRms = 0;
    this.intervalId = setInterval(() => this.tick(), POLL_INTERVAL_MS);
  }

  /**
   * Mobile native-meter mode: no AudioContext, no poll interval. Native code
   * computes RMS + FFT of the device output mix and we synthesize
   * AudioAnalysisFrame objects from each compact frame (~30Hz).
   */
  startFromMeter(subscribe: MeterSubscription, onFrame: (frame: AudioAnalysisFrame) => void): void {
    this.stop();
    this.onFrame = onFrame;

    this._frameCount = 0;
    this.smoothedRms = 0;
    this._meterUnsubscribe = null;

    try {
      this._meterUnsubscribe = subscribe((meter: NativeMeterFrame) => this.onMeterFrame(meter));
    } catch (err) {
      console.warn('[Haptics] Failed to start native meter:', err);
      this._meterUnsubscribe = null;
      this.onFrame = null;
    }
  }

  private onMeterFrame(meter: NativeMeterFrame): void {
    if (!this.onFrame) return;
    this._frameCount++;

    const frequencyData = new Uint8Array(meter.spectrum || []);
    const waveform = meter.waveform && meter.waveform.length > 0
      ? meter.waveform
      : new Array(128).fill(128); // silence baseline when native sends no waveform
    const waveformData = new Uint8Array(waveform);

    const rmsRaw = Math.min(1, Math.max(0, meter.rmsRaw ?? 0));
    const alpha = this.alpha;
    this.smoothedRms = alpha * rmsRaw + (1 - alpha) * this.smoothedRms;

    this.onFrame({
      timestamp: performance.now() / 1000,
      rms: Math.min(1, meter.rms ?? this.smoothedRms),
      rmsRaw,
      frequencyData,
      waveformData,
      // Android's Visualizer supplies its actual capture rate; iOS ReplayKit
      // poll may not, in which case fall back to a standard 44.1 kHz.
      sampleRate: meter.sampleRate ?? 44100,
    });
  }

  stop(): void {
    this.clearReadinessTimer();
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    if (this._meterUnsubscribe) {
      try { this._meterUnsubscribe(); } catch (_) {}
      this._meterUnsubscribe = null;
    }
    // Timing: if we were analyzing via captureStream, the audible element is
    // playing natively, so stopping the tap restores fully-native audio (no
    // graph involvement at all). If we were on the createMediaElementSource
    // fallback, we intentionally do NOT disconnect — that element plays
    // exclusively through the graph and tearing it down mutes the track; we
    // only halt polling. dispose() closes the context fully at shutdown.
    this.stopTapStream();
    this.onFrame = null;
  }

  /** Stops the silent captureStream tap if one is active (no-op otherwise). */
  private stopTapStream(): void {
    if (this._tapStream) {
      try {
        this._tapStream.getTracks().forEach((t) => { try { t.stop(); } catch (_) {} });
      } catch (_) {}
      this._tapStream = null;
      if (this.source) {
        try { (this.source as any).disconnect(); } catch (_) {}
      }
      this.source = null;
      this._boundElement = null;
    }
  }

  private tearDownRouting(): void {
    this.stopTapStream();
    if (this.source) {
      try { (this.source as any).disconnect(); } catch (_) {}
      this.source = null;
    }
    if (this.analyser) {
      try { (this.analyser as any).disconnect(); } catch (_) {}
      this.analyser = null;
    }
    this._boundElement = null;
  }

  dispose(): void {
    this.stop();
    if (this._ctx) {
      const idx = liveContexts.indexOf(this._ctx as any);
      if (idx >= 0) liveContexts.splice(idx, 1);
      (this._ctx as any).close().catch(() => {});
      this._ctx = null;
    }
    this.tearDownRouting();
  }

  private clearReadinessTimer(): void {
    if (this._readinessTimer) {
      clearInterval(this._readinessTimer);
      this._readinessTimer = null;
    }
  }

  private tick(): void {
    if (!this.analyser || !this._ctx) return;

    this._frameCount++;
    if (this._frameCount <= WARMUP_FRAMES) return;

    const freqData = new Uint8Array(this.analyser.frequencyBinCount);
    const waveData = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteFrequencyData(freqData);
    this.analyser.getByteTimeDomainData(waveData);

    let sum = 0;
    for (let i = 0; i < waveData.length; i++) {
      const normalized = (waveData[i] - 128) / 128;
      sum += normalized * normalized;
    }
    const rmsRaw = Math.sqrt(sum / waveData.length);

    const alpha = this.alpha;
    this.smoothedRms = alpha * rmsRaw + (1 - alpha) * this.smoothedRms;

    this.onFrame?.({
      timestamp: this._ctx.currentTime,
      rms: Math.min(1, this.smoothedRms),
      rmsRaw,
      frequencyData: freqData,
      waveformData: waveData,
      sampleRate: this._ctx.sampleRate,
    });
  }
}
