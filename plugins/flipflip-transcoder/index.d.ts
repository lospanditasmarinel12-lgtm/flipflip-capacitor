import type { PluginListenerHandle } from '@capacitor/core';
import { registerPlugin } from '@capacitor/core';

/** Optimization decision returned by probe(). */
export interface ProbeDecision {
  /** KEEP | LIGHT_OPTIMIZATION | STANDARD_OPTIMIZATION | AGGRESSIVE_OPTIMIZATION */
  profile: string;
  resize: boolean;
  targetWidth: number;
  targetHeight: number;
  targetFPS: number;
  targetBitrate: number;
  toneMap: boolean;
  reencode: boolean;
}

export interface ProbeResult {
  kind: 'image' | 'video' | 'audio' | 'other';
  width: number;
  height: number;
  convert: boolean;
  /** width × height */
  pixelCount: number;
  /** Estimated decoded RGBA bytes (width × height × 4) */
  estimatedDecodedBytes: number;
  /** Compressed file size in bytes */
  fileSize: number;
  /** Codec / format name (e.g. "h264", "hevc", "jpeg", "heic") */
  codec: string;
  /** Video FPS (0 for images/audio) */
  fps: number;
  /** Duration in seconds (0 for images) */
  duration: number;
  /** Bits per pixel channel (8, 10, etc.) */
  bitDepth: number;
  /** Pixel format string (e.g. "420v", "4444", "bgra") */
  pixelFormat: string;
  /** Whether the media uses HDR transfer (PQ / HLG) */
  hdr: boolean;
  /** Whether the image has an alpha channel */
  alpha: boolean;
  /** Estimated output bytes if re-encoded (0 if unknown) */
  estimatedOutputBytes: number;
  /** Deterministic optimization decision */
  decision: ProbeDecision;
  /** Whether a video is a structurally complete MP4-family container (has a
   *  moov box). Absent/undefined on platforms that don't report it. */
  complete?: boolean;
}

export interface ConvertResult {
  outputPath: string;
  converted: boolean;
  error?: string;
}

export interface LibraryOptimizeResult {
  mapping: { from: string; to: string }[];
  canceled: boolean;
}

export interface ResolvedMediaUrl {
  url: string;
}

export interface FlipTranscoderPlugin {
  probe(options: { path: string }): Promise<ProbeResult>;
  convert(options: { path: string; maxDimension?: number; keepOriginal?: boolean; notifLabel?: string }): Promise<ConvertResult>;
  optimizeLibrary(options: { paths: string[]; keepOriginal?: boolean }): Promise<LibraryOptimizeResult>;
  resolveMediaUrl(options: { path: string }): Promise<ResolvedMediaUrl>;
  cancel(): Promise<void>;
  addListener(eventName: 'progress', listenerFunc: (data: { current: number; total: number; name: string }) => void): Promise<PluginListenerHandle>;
}

export const FlipTranscoder = registerPlugin<FlipTranscoderPlugin>('FlipTranscoder', {
  web: () => import('./web').then((m) => new m.FlipTranscoderWeb()),
});
