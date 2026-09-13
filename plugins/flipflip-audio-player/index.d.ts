import type { PluginListenerHandle } from '@capacitor/core';
import { registerPlugin } from '@capacitor/core';

export interface AudioPlayerState {
  playing: boolean;
  position: number; // ms
  duration: number; // ms
  ended?: boolean;
  error?: string;
}

export interface AudioPlayerMeterFrame {
  rms: number;
  rmsRaw: number;
  spectrum: number[];
  sampleRate?: number;
}

export interface LoadOptions {
  url: string;
  loop?: boolean;
  volume?: number;
}

export interface SeekOptions {
  position: number; // ms
}

export interface VolumeOptions {
  volume: number; // 0..1
}

export interface FlipAudioPlayerPlugin {
  load(options: LoadOptions): Promise<{ duration: number }>;
  play(): Promise<void>;
  pause(): Promise<void>;
  seekTo(options: SeekOptions): Promise<void>;
  setVolume(options: VolumeOptions): Promise<void>;
  getState(): Promise<AudioPlayerState>;
  dispose(): Promise<void>;
  addListener(
    eventName: 'playerState',
    listenerFunc: (state: AudioPlayerState) => void
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'meter',
    listenerFunc: (frame: AudioPlayerMeterFrame) => void
  ): Promise<PluginListenerHandle>;
}

export const FlipAudioPlayer = registerPlugin<FlipAudioPlayerPlugin>('FlipAudioPlayer', {
  web: () => import('./web').then((m) => new m.FlipAudioPlayerWeb()),
});