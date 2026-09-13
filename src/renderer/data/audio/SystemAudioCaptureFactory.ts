import { ISystemAudioCapture } from './ISystemAudioCapture';
import { NoOpCapture } from './NoOpCapture';
import { NativeMeterCapture } from './NativeMeterCapture';
import { PlatformType } from '../haptics/types';

// Mobile system-audio loopback has no WebView MediaStream equivalent, so the
// desktop getUserMedia approach is replaced by the NativeMeterCapture feed:
// the native plugin computes RMS/FFT of the device output mix and ships compact
// frames into the existing haptic pipeline (~30Hz). Non-mobile platforms keep
// the NoOp fallback (scene-audio analysis).
export function createSystemAudioCapture(platform: PlatformType): ISystemAudioCapture {
  if (platform === 'capacitor-android' || platform === 'capacitor-ios') {
    return new NativeMeterCapture(platform);
  }
  return new NoOpCapture();
}
