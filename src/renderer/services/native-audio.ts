import { FlipAudioPlayer } from 'flipflip-audio-player';

const NON_AUDIO_EXT_RE = /\.(jpe?g|png|gif|webp|tiff|bmp|heic|heif|avif|mp4|mov|m4v|mkv|webm|ogv|3gp|vtt|srt|json|txt|xml|html)$/i;

const CAPACITOR_SRC_MARKERS = [
  "capacitor://localhost/_capacitor_file_",
  "http://localhost/_capacitor_file_",
  "https://localhost/_capacitor_file_",
];

/** Rebuild a webview `capacitor://`/`_capacitor_file_` src back to a file:// URL. */
function webViewSrcToFileUrl(url: string): string | null {
  for (const marker of CAPACITOR_SRC_MARKERS) {
    if (url.startsWith(marker)) {
      const rest = url.slice(marker.length);
      if (rest.startsWith("/")) return "file://" + rest;
    }
  }
  return null;
}

/**
 * AVPlayer needs an absolute file:// URL, but scene audio URLs are stored as
 * app-sandbox relative paths (`imported/foo.mp3`) and may be passed here as
 * webview `capacitor://` srcs — neither loads on the native side. Resolve local
 * tracks to their sandbox file URL; remote https URLs pass through unchanged.
 */
async function resolveNativeAudioUrl(url: string): Promise<string> {
  if (!url) return url;
  if (/^(https?|capacitor):\/\//i.test(url)) {
    return webViewSrcToFileUrl(url) || url;
  }
  if (/^file:\/\//i.test(url)) return url;
  try {
    const { Filesystem, Directory } = await import("@capacitor/filesystem");
    const { uri } = await Filesystem.getUri({ path: url, directory: Directory.Data });
    return uri;
  } catch (e) {
    console.warn("[native-audio] getUri failed for", url, e);
    return url;
  }
}

export interface NativeAudioState {
  playing: boolean;
  position: number;
  duration: number;
  ended?: boolean;
}

export interface NativeAudioMeterFrame {
  rms: number;
  rmsRaw: number;
  spectrum: number[];
  sampleRate?: number;
}

export interface NativeAudioService {
  isAvailable(): boolean;
  load(url: string, loop?: boolean, volume?: number): Promise<{ duration: number }>;
  play(): Promise<void>;
  pause(): Promise<void>;
  seekTo(position: number): Promise<void>;
  setVolume(volume: number): Promise<void>;
  getState(): Promise<NativeAudioState>;
  dispose(): Promise<void>;
  onState(cb: (state: NativeAudioState) => void): Promise<() => void>;
  onMeter(cb: (frame: NativeAudioMeterFrame) => void): Promise<() => void>;
}

class CapacitorNativeAudioService implements NativeAudioService {
  // A play request issued while a load is still in flight (the JS awaits URL
  // resolution before the native load lands, so autoplay arrives before any
  // AVPlayer exists). Replayed once the track is loaded so scene/app autoplay
  // isn't silently lost.
  private _pendingPlay = false;

  isAvailable(): boolean {
    return true;
  }

  async load(url: string, loop = false, volume = 1): Promise<{ duration: number }> {
    const resolved = await resolveNativeAudioUrl(url);
    // Never feed a clearly non-audio asset (image/video/playlist/doc) to the
    // native player — AVPlayerItem durations go NaN/undefined for those and the
    // plugin must not trap or hang on them. The web <audio> element still plays
    // the track independently, so a rejection here is a graceful fallback.
    if (NON_AUDIO_EXT_RE.test(resolved)) {
      this._pendingPlay = false;
      throw new Error(`Not an audio asset: ${resolved}`);
    }
    try {
      const result = await FlipAudioPlayer.load({ url: resolved, loop, volume });
      if (this._pendingPlay) {
        this._pendingPlay = false;
        await FlipAudioPlayer.play().catch(() => {});
      }
      return result;
    } catch (e) {
      this._pendingPlay = false;
      throw e;
    }
  }

  async play(): Promise<void> {
    this._pendingPlay = true;
    return FlipAudioPlayer.play().catch(() => {});
  }

  async pause(): Promise<void> {
    this._pendingPlay = false;
    return FlipAudioPlayer.pause();
  }

  async seekTo(position: number): Promise<void> {
    return FlipAudioPlayer.seekTo({ position });
  }

  async setVolume(volume: number): Promise<void> {
    return FlipAudioPlayer.setVolume({ volume });
  }

  async getState(): Promise<NativeAudioState> {
    return FlipAudioPlayer.getState();
  }

  async dispose(): Promise<void> {
    this._pendingPlay = false;
    return FlipAudioPlayer.dispose();
  }

  async onState(cb: (state: NativeAudioState) => void): Promise<() => void> {
    const handle = await FlipAudioPlayer.addListener('playerState', (data) => cb(data));
    return () => { handle.remove(); };
  }

  async onMeter(cb: (frame: NativeAudioMeterFrame) => void): Promise<() => void> {
    const handle = await FlipAudioPlayer.addListener('meter', (data) => cb(data));
    return () => { handle.remove(); };
  }
}

export function createNativeAudioService(): NativeAudioService {
  if (typeof window !== 'undefined' && (window as any).Capacitor) {
    try { return new CapacitorNativeAudioService(); } catch (e) {
      console.warn('[NativeAudio] plugin unavailable', e);
    }
  }
  return {
    isAvailable: () => false,
    async load() { throw new Error('Native audio playback is not available in this build'); },
    async play() {},
    async pause() {},
    async seekTo() {},
    async setVolume() {},
    async getState() { return { playing: false, position: 0, duration: 0 }; },
    async dispose() {},
    async onState() { return () => {}; },
    async onMeter() { return () => {}; },
  };
}