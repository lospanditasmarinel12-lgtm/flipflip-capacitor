interface MemSnapshot {
  timestamp: number;
  heapUsedMB: number;
  heapTotalMB: number;
  liveImgs: number;
  liveVideos: number;
  liveCanvases: number;
  iframes: number;
  imgViewTimeouts: number;
  tag: string;
}

let _autoPollInterval: ReturnType<typeof setInterval> | null = null;
let _snapshots: MemSnapshot[] = [];
const MAX_SNAPSHOTS = 5000;

function heapUsedMB(): number {
  try {
    const perf = (performance as any).memory;
    if (perf && perf.usedJSHeapSize) return Math.round(perf.usedJSHeapSize / (1024 * 1024));
  } catch (e) {}
  return 0;
}

function heapTotalMB(): number {
  try {
    const perf = (performance as any).memory;
    if (perf && perf.jsHeapSizeLimit) return Math.round(perf.jsHeapSizeLimit / (1024 * 1024));
  } catch (e) {}
  return 0;
}

function countLiveElements() {
  let imgs = 0, videos = 0, canvases = 0, iframes = 0;
  try {
    imgs = document.images?.length || 0;
    videos = document.querySelectorAll('video').length;
    canvases = document.querySelectorAll('canvas').length;
    iframes = document.querySelectorAll('iframe').length;
  } catch (e) {}
  return { imgs, videos, canvases, iframes };
}

function countImageViewTimeouts(): number {
  let total = 0;
  try {
    for (let el of document.querySelectorAll('div[id="image"], [class*="copy-"][style*="position"]')) {
      const k = Object.keys(el).find((key) => key.startsWith('__reactFiber$'));
      if (!k) continue;
      let fiber = (el as any)[k];
      let depth = 0;
      while (fiber && depth < 20) {
        const inst = fiber.stateNode;
        if (inst && typeof inst.clearTimeouts === 'function' && Array.isArray(inst._timeouts)) {
          total += inst._timeouts.length;
          break;
        }
        fiber = fiber.return;
        depth++;
      }
    }
  } catch (e) {}
  return total;
}

function takeSnapshot(tag: string = '', includeDOMScan = true): MemSnapshot {
  const elems = includeDOMScan ? countLiveElements() : { imgs: 0, videos: 0, canvases: 0, iframes: 0 };
  const imgViewTimeouts = includeDOMScan ? countImageViewTimeouts() : 0;

  const s: MemSnapshot = {
    timestamp: Date.now(),
    heapUsedMB: heapUsedMB(),
    heapTotalMB: heapTotalMB(),
    liveImgs: elems.imgs,
    liveVideos: elems.videos,
    liveCanvases: elems.canvases,
    iframes: elems.iframes,
    imgViewTimeouts,
    tag,
  };
  _snapshots.push(s);
  if (_snapshots.length > MAX_SNAPSHOTS) {
    const overflow = _snapshots.length - MAX_SNAPSHOTS;
    _snapshots.splice(0, overflow);
  }
  return s;
}

function logSnapshot(s: MemSnapshot, label: string = '') {
  const elapsed = _snapshots.length > 1
    ? `+${((s.timestamp - _snapshots[_snapshots.length - 2].timestamp) / 1000).toFixed(1)}s`
    : '0.0s';
  console.log(
    `[FFDEBUG${label ? ` ${label}` : ''}] ${elapsed}` +
    `  heap:${s.heapUsedMB}/${s.heapTotalMB}MB` +
    `  dom:img${s.liveImgs} v${s.liveVideos} c${s.liveCanvases} i${s.iframes}` +
    `  ivTimeouts:${s.imgViewTimeouts}` +
    (s.tag ? `  "${s.tag}"` : '')
  );
}

function printSummary() {
  if (_snapshots.length < 2) {
    console.log('[FFDEBUG] Need at least 2 snapshots for summary');
    return;
  }
  const first = _snapshots[0];
  const last = _snapshots[_snapshots.length - 1];
  const duration = ((last.timestamp - first.timestamp) / 1000).toFixed(1);
  console.log('--- FFDEBUG SUMMARY ---');
  console.log(`  Duration: ${duration}s`);
  console.log(`  heap:    ${first.heapUsedMB}MB → ${last.heapUsedMB}MB  (Δ${last.heapUsedMB - first.heapUsedMB}MB)`);
  console.log(`  domMedia: img ${first.liveImgs}→${last.liveImgs}  video ${first.liveVideos}→${last.liveVideos}  canvas ${first.liveCanvases}→${last.liveCanvases}`);
  console.log(`  ivTimeouts: ${first.imgViewTimeouts} → ${last.imgViewTimeouts}`);
}

const debugAPI = {
  snapshot: (tag: string = 'manual') => {
    const s = takeSnapshot(tag);
    logSnapshot(s, 'SNAPSHOT');
    return s;
  },

  mark: (tag: string) => {
    const s = takeSnapshot(tag);
    logSnapshot(s, 'MARK');
  },

  summary: () => printSummary(),

  snapshots: () => [..._snapshots],

  clearSnapshots: () => { _snapshots = []; console.log('[FFDEBUG] Snapshots cleared'); },

  startPoll: (intervalMs: number = 5000) => {
    if (_autoPollInterval) clearInterval(_autoPollInterval);
    takeSnapshot('poll-start', false);
    _autoPollInterval = setInterval(() => {
      const s = takeSnapshot('poll', false);
      logSnapshot(s);
    }, intervalMs);
    console.log(`[FFDEBUG] Auto-poll started every ${intervalMs}ms`);
  },

  stopPoll: () => {
    if (_autoPollInterval) {
      clearInterval(_autoPollInterval);
      _autoPollInterval = null;
      console.log('[FFDEBUG] Auto-poll stopped');
    }
  },

  leakCheck: () => {
    const elems = countLiveElements();
    const ivTimeouts = countImageViewTimeouts();
    console.log('=== LEAK CHECK ===');
    console.log('heap:', `${heapUsedMB()}MB / ${heapTotalMB()}MB`);
    console.log('DOM media:', `img=${elems.imgs} video=${elems.videos} canvas=${elems.canvases} iframe=${elems.iframes}`);
    console.log('ImageView _timeouts (total):', ivTimeouts);
    console.log('=== END LEAK CHECK ===');
  },

  budget: () => {
    try {
      const { MediaBudget } = require('../data/MediaBudget');
      return {
        budget: MediaBudget.getBudget(),
        live: MediaBudget.totalLive(),
        ready: MediaBudget.totalReady(),
        players: MediaBudget.playerCount(),
        perPlayerCap: MediaBudget.perPlayerCap(),
        exhausted: MediaBudget.isExhausted(),
        playersDetail: MediaBudget.dump(),
      };
    } catch (e) {
      return { error: (e as Error).message };
    }
  },

  monitorRAF: (durationMs: number = 30000) => {
    var last = performance.now();
    var count = 0;
    var maxGap = 0;
    var longFrames: { at: string; gap: number }[] = [];
    var start = last;
    var rafId: number;
    function tick() {
      var now = performance.now();
      var gap = now - last;
      last = now;
      count++;
      if (gap > maxGap) maxGap = gap;
      if (gap > 50) longFrames.push({ at: ((now - start) / 1000).toFixed(1), gap: Math.round(gap) });
      if ((now - start) < durationMs) {
        rafId = requestAnimationFrame(tick);
      } else {
        cancelAnimationFrame(rafId);
        var pct = longFrames.length > 0 ? Math.round(longFrames.length / count * 100) : 0;
        console.log(`[RAFMONITOR] duration=${(durationMs/1000).toFixed(0)}s  frames=${count}  avg=${(durationMs/count).toFixed(1)}ms  maxGap=${Math.round(maxGap)}ms  longFrames=${longFrames.length}(${pct}%)`);
        if (longFrames.length > 0) {
          console.log('  long frames (>50ms):');
          longFrames.slice(0, 20).forEach(function(f) { console.log('    t=' + f.at + 's  gap=' + f.gap + 'ms'); });
          if (longFrames.length > 20) console.log('    ... and ' + (longFrames.length - 20) + ' more');
        }
      }
    }
    requestAnimationFrame(tick);
  },

  stopGovernor: () => {
    try {
      const { getMemoryGovernor } = require('../data/MemoryMonitor');
      getMemoryGovernor().stop();
      console.log('[FFDEBUG] MemoryGovernor stopped');
    } catch (e) {
      console.error('[FFDEBUG] Failed to stop governor:', e);
    }
  },

  startGovernor: () => {
    try {
      const { getMemoryGovernor } = require('../data/MemoryMonitor');
      getMemoryGovernor().start();
      console.log('[FFDEBUG] MemoryGovernor started');
    } catch (e) {
      console.error('[FFDEBUG] Failed to start governor:', e);
    }
  },
};

export function initMemoryDebug() {
  (window as any).__ffdebug = debugAPI;
  console.log(
    '%c[FFDEBUG] Memory debugger active. Use %c__ffdebug%c in console.\n' +
    '  %cCommands:%c\n' +
    '  __ffdebug.snapshot("label")     — take a memory snapshot\n' +
    '  __ffdebug.mark("label")          — snapshot + log\n' +
    '  __ffdebug.startPoll(ms)          — auto-poll memory every N ms\n' +
    '  __ffdebug.stopPoll()             — stop auto-poll\n' +
    '  __ffdebug.summary()              — print summary of all snapshots\n' +
    '  __ffdebug.snapshots()            — list all snapshots\n' +
    '  __ffdebug.clearSnapshots()       — clear recorded snapshots\n' +
    '  __ffdebug.leakCheck()             — dump live DOM media and ImageView timeouts\n' +
    '  __ffdebug.monitorRAF(ms)         — measure rAF intervals for N ms\n' +
    '  __ffdebug.stopGovernor()          — stop MemoryGovernor polling\n' +
    '  __ffdebug.startGovernor()         — restart MemoryGovernor polling\n' +
    '  __ffdebug.budget()                — show MediaBudget state\n',
    'font-weight:bold;color:#4caf50',
    'font-weight:bold;color:#ff9800',
    '',
    'font-weight:bold;color:#2196f3',
    'font-weight:normal;color:inherit'
  );
}

export default initMemoryDebug;
