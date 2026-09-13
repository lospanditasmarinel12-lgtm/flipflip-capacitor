import { FlipSystemAudio } from 'flipflip-system-audio';
import type { SystemAudioMeterFrame } from 'flipflip-system-audio';

export type { SystemAudioMeterFrame };

export interface SystemAudioService {
  isAvailable(): Promise<boolean>;
  startCapture(mode?: 'visualizer' | 'mediaProjection'): Promise<{ deviceId: string; label: string }>;
  stopCapture(): Promise<void>;
  getState?(): Promise<Record<string, unknown>>;
  onData(cb: (frame: SystemAudioMeterFrame) => void): Promise<() => void>;
  /** iOS: presents the system broadcast picker for the FlipFlip extension. */
  startBroadcast?(): Promise<void>;
}

class CapacitorSystemAudioService implements SystemAudioService {
  async isAvailable(): Promise<boolean> {
    try {
      const res = await FlipSystemAudio.isAvailable();
      return !!res.available;
    } catch (e) {
      return false;
    }
  }

  async startCapture(mode?: 'visualizer' | 'mediaProjection'): Promise<{ deviceId: string; label: string }> {
    // Android: Visualizer (output mix) is the default; MediaProjection is the
    // fallback (Phase B) and is selected when a device id of 'media-projection'
    // is requested or the user explicitly chooses it. iOS ignores the mode and
    // polls the ReplayKit Broadcast extension's App Group file.
    return FlipSystemAudio.startCapture({ mode: mode === 'mediaProjection' ? 'mediaProjection' : 'visualizer' });
  }

  async stopCapture(): Promise<void> {
    try {
      await FlipSystemAudio.stopCapture();
    } catch (e) { /* already stopped */ }
  }

  async getState(): Promise<Record<string, unknown>> {
    return FlipSystemAudio.getState();
  }

  async startBroadcast(): Promise<void> {
    return FlipSystemAudio.startBroadcast();
  }

  async onData(cb: (frame: SystemAudioMeterFrame) => void): Promise<() => void> {
    let loggedFirst = false;
    const handle = await FlipSystemAudio.addListener('data', (data) => {
      if (!loggedFirst) {
        loggedFirst = true;
        console.log('[FlipSystemAudio] first data frame:', JSON.stringify(data));
      }
      cb(data);
    });
    return () => { handle.remove(); };
  }
}

/**
 * System audio meter service. In a Capacitor native build this uses the
 * FlipSystemAudio plugin (Android Visualizer output mix); in a plain web
 * build it reports unavailable.
 */
export function createSystemAudioService(): SystemAudioService {
  if (typeof window !== 'undefined' && (window as any).Capacitor) {
    return new CapacitorSystemAudioService();
  }
  return {
    async isAvailable() { return false; },
    async startCapture() { throw new Error('System audio not available in this build'); },
    async stopCapture() {},
    async onData() { return () => {}; },
  };
}
