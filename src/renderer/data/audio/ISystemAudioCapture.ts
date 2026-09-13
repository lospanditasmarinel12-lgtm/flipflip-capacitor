export interface CaptureDevice {
  id: string;
  label: string;
  groupId: string;
  isMonitor: boolean;
  isRunning: boolean;
}

/** A compact native audio-analysis frame (~30Hz) with no MediaStream. */
export interface NativeMeterFrame {
  /** EMA-smoothed RMS 0..1 */
  rms: number;
  /** raw RMS 0..1 */
  rmsRaw: number;
  /** magnitude spectrum 0..255 (frequencyData-compatible) */
  spectrum: number[];
  /** optional time-domain waveform 0..255 */
  waveform?: number[];
  sampleRate?: number;
}

/** Subscribe to compact native meter frames. Returns an unsubscribe fn. */
export type MeterSubscription = (onFrame: (frame: NativeMeterFrame) => void) => () => void;

export interface CaptureResult {
  /** Desktop loopback MediaStream (mobile feeds back null) */
  stream: MediaStream | null;
  device: CaptureDevice;
  /** Mobile native meter feed (when no MediaStream is available) */
  meter?: MeterSubscription;
}

export interface ISystemAudioCapture {
  isAvailable(): boolean;
  enumerateDevices(): Promise<CaptureDevice[]>;
  getCachedDevices(): CaptureDevice[];
  createLoopback(): Promise<boolean>;
  startCapture(deviceId?: string): Promise<CaptureResult>;
  stopCapture(): void;
  getStatus(): string;
  dispose(): void;
  /** iOS: presents the system broadcast picker (ReplayKit) for the FlipFlip extension. */
  startBroadcast?(): Promise<void>;
}
