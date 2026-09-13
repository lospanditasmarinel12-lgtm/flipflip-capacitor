export interface DisplayAutoConfig {
  maxInMemory: number;
  maxInHistory: number;
  maxLoadingAtOnce: number;
  cacheMaxSizeMB: number;
  maxDecodedImages: number;
}

function screenMegapixels(): number {
  try {
    const w = window.screen?.width || 0;
    const h = window.screen?.height || 0;
    if (w > 0 && h > 0) return (w * h) / (1024 * 1024);
  } catch (e) {}
  return 0;
}

/**
 * Mobile auto-config: no dedicated GPU / VRAM and no remote-session concept.
 * Caps scale with device RAM (from @capacitor/device) and, as a secondary
 * pressure, screen resolution (SoC unified memory holds decoded bitmaps).
 * Heuristic tiers keep preloads conservative so the WebView stays inside the
 * OS memory budget.
 */
export function computeDisplayAutoConfig(
  systemRAM_MB: number,
  _vramMB: number,
  _isDedicatedGPU: boolean,
  _hasRiskyGPU: boolean,
  _isRemoteSession: boolean,
): DisplayAutoConfig {
  const mp = screenMegapixels();

  let cfg: DisplayAutoConfig;
  if (systemRAM_MB <= 0 || systemRAM_MB < 2048) {
    cfg = { maxInMemory: 4, maxInHistory: 8, maxLoadingAtOnce: 1, cacheMaxSizeMB: 100, maxDecodedImages: 2 };
  } else if (systemRAM_MB < 4096) {
    cfg = { maxInMemory: 6, maxInHistory: 12, maxLoadingAtOnce: 1, cacheMaxSizeMB: 150, maxDecodedImages: 3 };
  } else if (systemRAM_MB < 8192) {
    cfg = { maxInMemory: 8, maxInHistory: 18, maxLoadingAtOnce: 2, cacheMaxSizeMB: 250, maxDecodedImages: 4 };
  } else {
    cfg = { maxInMemory: 10, maxInHistory: 24, maxLoadingAtOnce: 2, cacheMaxSizeMB: 400, maxDecodedImages: 6 };
  }

  // Very high-resolution screens (>=4K class tablets) decode larger bitmaps;
  // apply a modest downward nudge on in-memory decode limits.
  if (mp > 8.5) {
    cfg.maxInMemory = Math.max(3, Math.round(cfg.maxInMemory * 0.75));
    cfg.maxInHistory = Math.max(6, Math.round(cfg.maxInHistory * 0.75));
    cfg.maxDecodedImages = Math.max(2, cfg.maxDecodedImages - 1);
  }

  return cfg;
}
