import { Device } from '@capacitor/device';

export interface SystemCapabilities {
  platform: string;
  displayServer: 'X11' | 'wayland' | 'unknown';
  gpuVendor: 'nvidia' | 'amd' | 'intel' | 'apple' | 'unknown';
  gpuModel: string;
  vramMB: number;
  systemRAM_MB: number;
  cpuCores: number;
  isRemoteSession: boolean;
  isDedicatedGPU: boolean;
}

/**
 * Mobile system capabilities. There is no OS-level GPU/VRAM or remote-session
 * concept in a WebView: VRAM is a heuristic share of total RAM (SoC unified
 * memory), system RAM comes from @capacitor/device, and everything else falls
 * back to safe defaults.
 */
export async function detectSystemCapabilities(): Promise<SystemCapabilities> {
  let systemRAM_MB = 0;
  let platform = 'unknown';

  try {
    const info = await Device.getInfo();
    platform = info.platform || 'unknown';
  } catch (e) { /* plugin unavailable in a plain web build */ }

  try {
    if (typeof navigator !== 'undefined' && navigator.platform) {
      const p = navigator.platform.toLowerCase();
      if (!platform || platform === 'unknown') {
        if (p.includes('iphone') || p.includes('ipad') || p.includes('mac')) platform = 'ios';
        else if (p.includes('android')) platform = 'android';
      }
    }
  } catch (e) {}

  // Chromium/Android expose device RAM in GB; iOS does not — UA-based fallback.
  const deviceMemGB = (navigator as any).deviceMemory;
  systemRAM_MB = (typeof deviceMemGB === 'number' && deviceMemGB > 0)
    ? Math.round(deviceMemGB * 1024)
    : mobileRAMFallback();

  const isApple = platform === 'ios' || platform === 'macos';
  const gpuVendor = isApple ? 'apple' as const : 'unknown' as const;

  return {
    platform,
    displayServer: 'unknown',
    gpuVendor,
    gpuModel: isApple ? (systemRAM_MB > 8192 ? 'Apple GPU (high-gen)' : 'Apple GPU') : 'Mobile SoC GPU',
    vramMB: estimateVRAMShare(systemRAM_MB),
    systemRAM_MB,
    cpuCores: navigator.hardwareConcurrency || 4,
    isRemoteSession: false,
    isDedicatedGPU: false,
  };
}

function estimateVRAMShare(ramMB: number): number {
  // Mobile SoCs share unified memory; ~25–30% is a rough GPU allotment.
  if (ramMB >= 8192) return Math.round(ramMB * 0.3);
  if (ramMB >= 4096) return Math.round(ramMB * 0.28);
  if (ramMB >= 2048) return Math.round(ramMB * 0.25);
  return Math.round(ramMB * 0.2);
}

function mobileRAMFallback(): number {
  // Rough defaults when @capacitor/device is unavailable (e.g. plain web build).
  const ua = navigator.userAgent;
  if (/iphone/i.test(ua)) return 4096;
  if (/ipad/i.test(ua)) return 6144;
  if (/android/i.test(ua)) return 4096;
  return 4096;
}

export function hasRiskyGPUConfig(_caps: SystemCapabilities): boolean {
  return false;
}

let _cachedCapabilities: SystemCapabilities | null = null;

export async function getSystemCapabilities(): Promise<SystemCapabilities> {
  if (!_cachedCapabilities) {
    _cachedCapabilities = await detectSystemCapabilities();
  }
  return _cachedCapabilities;
}
