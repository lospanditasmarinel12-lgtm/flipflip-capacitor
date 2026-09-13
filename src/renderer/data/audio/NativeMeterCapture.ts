import { ISystemAudioCapture, CaptureDevice, CaptureResult, NativeMeterFrame, MeterSubscription } from './ISystemAudioCapture';
import { createSystemAudioService } from '../../services/system-audio';
import { detectPlatform, PlatformType } from '../haptics/types';

const OUTPUT_MIX_DEVICE: CaptureDevice = {
  id: 'output-mix',
  label: 'Output Mix (all device audio)',
  groupId: 'system',
  isMonitor: true,
  isRunning: true,
};

/**
 * Mobile system-audio capture via the native FlipSystemAudio plugin.
 *
 * On Android the plugin attaches a Visualizer to audio session 0 (the global
 * output mix) so haptics react to whatever the phone plays — no consent
 * dialog. The plugin computes RMS + magnitude spectrum natively and streams
 * compact frames to JS, which feeds the existing haptic pipeline.
 */
export class NativeMeterCapture implements ISystemAudioCapture {
  private service = createSystemAudioService();
  private cachedDevices: CaptureDevice[] = [];
  private status = 'Not started';
  private stopCallbacks: Array<() => void> = [];
  private activeDeviceId: string | null = null;

  constructor(private platform: PlatformType) {}

  isAvailable(): boolean {
    // Android (Visualizer output mix) and iOS (ReplayKit Broadcast extension)
    // both feed the native meter pipeline.
    return this.platform === 'capacitor-android' || this.platform === 'capacitor-ios';
  }

  async enumerateDevices(): Promise<CaptureDevice[]> {
    if (this.platform === 'capacitor-ios') {
      this.cachedDevices = [{
        id: 'replaykit-broadcast',
        label: 'Broadcast (ReplayKit) — start from Control Center',
        groupId: 'system',
        isMonitor: true,
        isRunning: true,
      }];
      return this.cachedDevices;
    }
    if (!this.isAvailable()) {
      this.cachedDevices = [];
      return this.cachedDevices;
    }
    this.cachedDevices = [
      { ...OUTPUT_MIX_DEVICE },
      {
        id: 'media-projection',
        label: 'Audio Capture (MediaProjection, consent dialog)',
        groupId: 'system',
        isMonitor: true,
        isRunning: true,
      },
    ];
    return this.cachedDevices;
  }

  getCachedDevices(): CaptureDevice[] { return this.cachedDevices; }

  async createLoopback(): Promise<boolean> { return false; }

  async startBroadcast(): Promise<void> {
    if (this.platform !== 'capacitor-ios') {
      throw new Error('Broadcast picker is only available on iOS');
    }
    await this.service.startBroadcast?.();
  }

  async startCapture(deviceId?: string): Promise<CaptureResult> {
    if (!this.isAvailable()) {
      throw new Error('System audio capture not available on this platform');
    }
    // Android: 'media-projection' device id selects the Phase B fallback
    // (AudioRecord + consent dialog); anything else (incl. iOS) uses the
    // default backend — Visualizer output mix on Android, ReplayKit poll on iOS.
    const mode = deviceId === 'media-projection' ? 'mediaProjection' as const : undefined;

    // Second-layer guard: called again for the same device while already
    // capturing means the caller re-entered (e.g. a 1s AudioControl tick).
    // Do not tear down and rebuild the native capture — just hand back a fresh
    // subscription wrapper over the still-running feed.
    if (this.activeDeviceId !== null && this.activeDeviceId === (deviceId || null)) {
      return {
        stream: null,
        device: this.cachedDevices.find(d => d.id === deviceId) ?? { ...OUTPUT_MIX_DEVICE },
        meter: this.makeSubscribe(),
      };
    }
    this.stopCapture();

    // Bound the consent/activity flow: on some Android devices the MediaProjection
    // consent dialog triggers an Activity recreation that drops the pending
    // plugin call, leaving the promise pending forever. Convert that into a
    // visible error instead of an indefinite "waiting for audio".
    const result = await Promise.race([
      this.service.startCapture(mode),
      new Promise<never>((_, reject) => setTimeout(
        () => reject(new Error(mode === 'mediaProjection'
          ? 'MediaProjection consent timed out — the underlying Activity was recreated (screen-capture consent lost). Please try again.'
          : 'System audio capture timed out while starting.')),
        15000)),
    ]);
    this.activeDeviceId = deviceId || null;
    this.status = `Capturing: ${result.label}`;

    return { stream: null, device: { ...OUTPUT_MIX_DEVICE }, meter: this.makeSubscribe() };
  }

  private makeSubscribe(): MeterSubscription {
    return (onFrame) => {
      const cleanup: Array<() => void> = [];
      this.service.onData((frame: NativeMeterFrame) => {
        onFrame({
          rms: clamp01(frame.rms),
          rmsRaw: clamp01(frame.rmsRaw),
          spectrum: Array.isArray(frame.spectrum) ? frame.spectrum : [],
          waveform: Array.isArray(frame.waveform) ? frame.waveform : undefined,
          sampleRate: frame.sampleRate,
        });
      }).then((unsubscribe) => {
        cleanup.push(unsubscribe);
      });
      const stopFn = () => {
        cleanup.forEach((fn) => { try { fn(); } catch (e) {} });
      };
      this.stopCallbacks.push(stopFn);
      return stopFn;
    };
  }

  stopCapture(): void {
    this.activeDeviceId = null;
    this.stopCallbacks.forEach((fn) => { try { fn(); } catch (e) {} });
    this.stopCallbacks = [];
    this.service.stopCapture();
    this.status = 'Stopped';
  }

  getStatus(): string { return this.status; }

  dispose(): void { this.stopCapture(); }
}

function clamp01(v: number): number {
  return v < 0 ? 0 : (v > 1 ? 1 : v);
}
