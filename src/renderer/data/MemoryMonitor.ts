export type MemoryZone = 'green' | 'yellow' | 'orange' | 'red';

export interface GovernorState {
  zone: MemoryZone;
  warmWindowMultiplier: number;
  warmBudgetMB: number;
  warmItemCount: number;
  preloadMode: 'auto' | 'metadata' | 'none';
  cacheEnabled: boolean;
  purgeEnabled: boolean;
  purgeFraction: number;
  gcInterval: number;
  maxLoadingAtOnce: number;
  systemBudgetMB: number;
  systemUsedMB: number;
  heapRatio: number;
  gpuVramUsedPercent: number;
  gpuImageCount: number;
  gpuImageSizeMB: number;
  vramTotalMB: number;
  vramUsedMB: number;
  vramSource: 'sysfs' | 'nvidia-smi' | 'none';
  rssMB: number;
  rssRatio: number;
}

interface GPUVRAM {
  usedMB: number;
  totalMB: number;
  usedPercent: number;
  source: GovernorState['vramSource'];
}

type GovernorCallback = (state: GovernorState) => void;

interface ZoneConfig {
  warmWindowMultiplier: number;
  warmItemCount: number;
  preloadMode: 'auto' | 'metadata' | 'none';
  cacheEnabled: boolean;
  purgeEnabled: boolean;
  purgeFraction: number;
  gcInterval: number;
  maxLoadingAtOnce: number;
}

interface CachedBudget {
  total: number;
  free: number;
  used: number;
  ratio: number;
}

const ZONE_CONFIGS: Record<MemoryZone, ZoneConfig> = {
  green: {
    warmWindowMultiplier: 0.4,
    warmItemCount: 2,
    preloadMode: 'auto',
    cacheEnabled: true,
    purgeEnabled: false,
    purgeFraction: 0,
    gcInterval: 60000,
    maxLoadingAtOnce: -1,
  },
  yellow: {
    warmWindowMultiplier: 0.25,
    warmItemCount: 2,
    preloadMode: 'auto',
    cacheEnabled: true,
    purgeEnabled: false,
    purgeFraction: 0,
    gcInterval: 30000,
    maxLoadingAtOnce: -1,
  },
  orange: {
    warmWindowMultiplier: 0.15,
    warmItemCount: 1,
    preloadMode: 'auto',
    cacheEnabled: false,
    purgeEnabled: true,
    purgeFraction: 0.25,
    gcInterval: 15000,
    maxLoadingAtOnce: 2,
  },
  red: {
    warmWindowMultiplier: 0.10,
    warmItemCount: 1,
    preloadMode: 'none',
    cacheEnabled: false,
    purgeEnabled: true,
    purgeFraction: 1.0,
    gcInterval: 3000,
    maxLoadingAtOnce: 1,
  },
};

/**
 * Mobile thresholds: WebView heaps are far smaller than Electron's
 * --max-old-space-size=1024, so pressure kicks in earlier. (From
 * Flip-Electron/things to implement/CAPACITOR_PORTING.md.)
 */
const HEAP_YELLOW_MOBILE = 0.55;
const HEAP_ORANGE_MOBILE = 0.65;
const HEAP_RED_MOBILE = 0.75;
const RED_MIN_COUNT = 4;
const GREEN_MIN_COUNT = 6;
const SAMPLING_INTERVAL = 3000;

function heapRatioFromPerf(): number {
  try {
    const perf = (performance as any).memory;
    if (perf && perf.usedJSHeapSize && perf.jsHeapSizeLimit && perf.jsHeapSizeLimit > 0) {
      return perf.usedJSHeapSize / perf.jsHeapSizeLimit;
    }
  } catch (e) {}
  return 0;
}

/** Estimated live DOM media — WebView stand-in for webFrame GPU counters. */
function countLiveMedia() {
  let imgs = 0;
  let videos = 0;
  try {
    imgs = document.images?.length || 0;
    videos = document.querySelectorAll('video').length;
  } catch (e) {}
  return { count: imgs + videos, sizeMB: 0 };
}

class MemoryGovernor {
  private _intervalId: ReturnType<typeof setInterval> | null = null;
  private _zone: MemoryZone = 'green';
  private _redCount = 0;
  private _greenCount = 0;
  private _callbacks: GovernorCallback[] = [];
  private _systemTotalRAM_MB: number;
  private _lastBudgetMB: number = 0;
  private _tick = 0;
  private _cachedBudget: CachedBudget | null = null;
  private _cachedMedia: { count: number; sizeMB: number } = { count: 0, sizeMB: 0 };
  private _startupTime: number;

  constructor(totalRAM_MB: number) {
    this._systemTotalRAM_MB = totalRAM_MB;
  }

  start() {
    if (this._intervalId) return;
    this._startupTime = Date.now();
    this._tick = 0;
    this._refreshCache();
    this._doPoll();
    this._intervalId = setInterval(() => this._doPoll(), SAMPLING_INTERVAL);
  }

  stop() {
    if (this._intervalId) {
      clearInterval(this._intervalId);
      this._intervalId = null;
    }
  }

  onGovernorState(cb: GovernorCallback): () => void {
    this._callbacks.push(cb);
    return () => {
      this._callbacks = this._callbacks.filter(c => c !== cb);
    };
  }

  getCurrentState(): GovernorState {
    return this._buildState(this._zone, this._cachedBudget || this._getBudgetFallback(), this._getHeapRatio(), this._getRSSInfo(), this._cachedMedia, this._getVRAMFallback());
  }

  private _refreshCache() {
    this._cachedBudget = this._estimateBudget();
    this._cachedMedia = countLiveMedia();
  }

  /**
   * Budget estimate on a WebView: system RAM benchmark (from @capacitor/device)
   * minus our own gauge of live JS heap, clamped and scaled by a safety factor.
   * No OS-level free-memory API is exposed to a WebView.
   */
  private _estimateBudget(): CachedBudget {
    const total = this._systemTotalRAM_MB;
    const heapMB = Math.round((heapRatioFromPerf() * (heapEstimateLimitMB() || 256)));
    const free = Math.max(0, total - heapMB);
    const safeFree = free > total ? total : free;
    const used = total - safeFree;
    const safeBudget = Math.round(safeFree * 0.7);
    this._lastBudgetMB = safeBudget;
    return { total, free: safeFree, used, ratio: total > 0 ? used / total : 0 };
  }

  private _doPoll() {
    this._tick++;
    this._cachedMedia = countLiveMedia();
    const budget = this._cachedBudget || this._getBudgetFallback();
    const heapRatio = this._getHeapRatio();
    const rssInfo = this._getRSSInfo();
    const vram = this._getVRAMFallback();

    const newZone = this._classifyZone(heapRatio, rssInfo, budget, vram, this._cachedMedia);
    const effectiveZone = this._debounceZone(newZone, heapRatio, rssInfo.rssRatio, vram.usedPercent);

    if (effectiveZone !== this._zone || this._tick % 5 === 0) {
      this._zone = effectiveZone;
      this._applyZone(effectiveZone, budget, heapRatio, rssInfo, this._cachedMedia, vram);
    }
  }

  private _getRSSInfo(): { rssMB: number; rssRatio: number } {
    const heapMB = Math.round(heapRatioFromPerf() * (heapEstimateLimitMB() || 256));
    const ratio = this._systemTotalRAM_MB > 0 ? heapMB / this._systemTotalRAM_MB : 0;
    return { rssMB: heapMB, rssRatio: ratio };
  }

  private _getHeapRatio(): number {
    return heapRatioFromPerf();
  }

  private _classifyZone(
    heapRatio: number,
    rssInfo: { rssMB: number; rssRatio: number },
    budget: { total: number; free: number; used: number; ratio: number },
    vram: GPUVRAM,
    media: { count: number; sizeMB: number },
  ): MemoryZone {
    const rssRatio = rssInfo.rssRatio;
    const budgetRatio = budget.total > 0 ? (budget.total - budget.free) / budget.total : 0;
    const inStartupGrace = (Date.now() - this._startupTime) < 30000;
    const heapRed = inStartupGrace ? HEAP_RED_MOBILE + 0.1 : HEAP_RED_MOBILE;
    const heapOrange = inStartupGrace ? HEAP_ORANGE_MOBILE + 0.1 : HEAP_ORANGE_MOBILE;
    const heapYellow = inStartupGrace ? HEAP_YELLOW_MOBILE + 0.1 : HEAP_YELLOW_MOBILE;

    if (heapRatio >= heapRed || budgetRatio >= 0.92 || rssRatio >= 0.80) {
      return 'red';
    }
    if (heapRatio >= heapOrange || budgetRatio >= 0.78 || rssRatio >= 0.55 ||
        media.count > 800 || media.sizeMB > 3000) {
      return 'orange';
    }
    if (heapRatio >= heapYellow || budgetRatio >= 0.58 || rssRatio >= 0.40 ||
        media.count > 300 || media.sizeMB > 1200) {
      return 'yellow';
    }
    return 'green';
  }

  private _debounceZone(newZone: MemoryZone, heapRatio?: number, rssRatio?: number, vramPercent?: number): MemoryZone {
    if (newZone !== 'green') {
      this._greenCount = 0;
    }

    if (newZone === 'red') {
      this._redCount++;
    } else {
      this._redCount = 0;
    }

    if (newZone === 'red' && ((heapRatio != null && heapRatio > HEAP_RED_MOBILE) ||
      (rssRatio != null && rssRatio > 0.75))) {
      this._redCount = RED_MIN_COUNT;
      return 'red';
    }

    if (this._zone === 'green' && newZone === 'red' && this._redCount < RED_MIN_COUNT) {
      return 'yellow';
    }
    if (this._zone === 'green' && newZone === 'orange' && this._redCount < 2) {
      return 'yellow';
    }

    if (this._zone !== 'green') {
      if (newZone === 'green') {
        this._greenCount++;
        if (this._greenCount < GREEN_MIN_COUNT) {
          return this._zone;
        }
      }
    }

    return newZone;
  }

  private _buildState(
    zone: MemoryZone,
    budget: { total: number; free: number; used: number; ratio: number },
    heapRatio: number,
    rssInfo: { rssMB: number; rssRatio: number },
    media: { count: number; sizeMB: number },
    vram: GPUVRAM,
  ): GovernorState {
    const cfg = ZONE_CONFIGS[zone];
    const safeBudgetMB = this._lastBudgetMB > 0 ? this._lastBudgetMB : budget.free || 0;
    const warmBudgetMB = Math.round(safeBudgetMB * cfg.warmWindowMultiplier);
    return {
      zone,
      warmWindowMultiplier: cfg.warmWindowMultiplier,
      warmBudgetMB: Math.max(warmBudgetMB, 32),
      warmItemCount: cfg.warmItemCount,
      preloadMode: cfg.preloadMode,
      cacheEnabled: cfg.cacheEnabled,
      purgeEnabled: cfg.purgeEnabled,
      purgeFraction: cfg.purgeFraction,
      gcInterval: cfg.gcInterval,
      maxLoadingAtOnce: cfg.maxLoadingAtOnce,
      systemBudgetMB: this._lastBudgetMB,
      systemUsedMB: budget.used,
      heapRatio,
      gpuVramUsedPercent: 0,
      gpuImageCount: media.count,
      gpuImageSizeMB: media.sizeMB,
      vramTotalMB: 0,
      vramUsedMB: 0,
      vramSource: 'none',
      rssMB: rssInfo.rssMB,
      rssRatio: rssInfo.rssRatio,
    };
  }

  private _applyZone(
    zone: MemoryZone,
    budget: { total: number; free: number; used: number; ratio: number },
    heapRatio: number,
    rssInfo: { rssMB: number; rssRatio: number },
    media: { count: number; sizeMB: number },
    vram: GPUVRAM,
  ) {
    const state = this._buildState(zone, budget, heapRatio, rssInfo, media, vram);

    if (zone !== 'green') {
      console.warn(
        `[MemoryGovernor] ${zone.toUpperCase()} —` +
        ` RAM:${state.systemUsedMB}/${state.systemBudgetMB}MB` +
        ` heap:${(state.heapRatio * 100).toFixed(0)}%` +
        ` mediaEls:${media.count}` +
        ` warm:${state.warmBudgetMB}MB (${state.warmItemCount} items)`
      );
    }

    for (const cb of this._callbacks) {
      try { cb(state); } catch (e) {}
    }
  }

  private _getBudgetFallback(): CachedBudget {
    return { total: this._systemTotalRAM_MB, free: 0, used: 0, ratio: 0 };
  }

  private _getVRAMFallback(): GPUVRAM {
    return { usedMB: 0, totalMB: 0, usedPercent: 0, source: 'none' as const };
  }
}

/** Rough WebView heap ceiling used for estimating RSS-style pressure. */
function heapEstimateLimitMB(): number {
  try {
    const perf = (performance as any).memory;
    if (perf && perf.jsHeapSizeLimit) {
      return Math.round(perf.jsHeapSizeLimit / (1024 * 1024));
    }
  } catch (e) {}
  return 256;
}

let _instance: MemoryGovernor | null = null;

export function getMemoryGovernor(totalRAM_MB?: number): MemoryGovernor {
  if (!_instance) {
    _instance = new MemoryGovernor(totalRAM_MB || 4096);
  }
  return _instance;
}
