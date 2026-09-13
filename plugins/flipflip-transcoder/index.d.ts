import type { PluginListenerHandle } from '@capacitor/core';
import { registerPlugin } from '@capacitor/core';

export interface ProbeResult {
  kind: 'image' | 'video' | 'other';
  width: number;
  height: number;
  convert: boolean;
}

export interface ConvertResult {
  outputPath: string;
  converted: boolean;
  error?: string;
}

export interface FlipTranscoderPlugin {
  probe(options: { path: string }): Promise<ProbeResult>;
  convert(options: { path: string; maxDimension?: number; keepOriginal?: boolean }): Promise<ConvertResult>;
  cancel(): Promise<void>;
  addListener(eventName: 'progress', listenerFunc: (data: { current: number; total: number; name: string }) => void): Promise<PluginListenerHandle>;
}

export const FlipTranscoder = registerPlugin<FlipTranscoderPlugin>('FlipTranscoder', {
  web: () => import('./web').then((m) => new m.FlipTranscoderWeb()),
});
