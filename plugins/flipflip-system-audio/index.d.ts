import type { PluginListenerHandle } from '@capacitor/core';
import { registerPlugin } from '@capacitor/core';

export interface SystemAudioMeterFrame {
  rms: number;
  rmsRaw: number;
  spectrum: number[];
  waveform: number[];
}

export interface StartCaptureOptions {
  mode?: 'visualizer' | 'mediaProjection';
}

export interface StartCaptureResult {
  deviceId: string;
  label: string;
}

export interface FlipSystemAudioPlugin {
  startCapture(options?: StartCaptureOptions): Promise<StartCaptureResult>;
  stopCapture(): Promise<void>;
  isAvailable(): Promise<{ available: boolean }>;
  /** Reads the extension health state written into the shared App Group. */
  getState(): Promise<Record<string, unknown>>;
  /** iOS: presents the system broadcast picker for the existing FlipFlip extension. */
  startBroadcast(): Promise<void>;
  addListener(
    eventName: 'data',
    listenerFunc: (data: SystemAudioMeterFrame) => void
  ): Promise<PluginListenerHandle>;
}

export const FlipSystemAudio = registerPlugin<FlipSystemAudioPlugin>('FlipSystemAudio', {
  web: () => import('./web').then((m) => new m.FlipSystemAudioWeb()),
});
