import { produce } from "immer";

import { useStore } from "../stores/flipflipStore";
import { getFilesystem } from "./filesystem";
import { isCapacitor } from "./platform";
import { FlipTranscoder } from "flipflip-transcoder";
import {
  convertDetached,
  ensureDialogMounted,
  hideOptimizeProgress,
  isHeavyMediaPath,
  showOptimizeProgress,
  updateOptimizeProgress,
} from "./convert";
import { isImportCancelled, trackDetachedConvert, settleDetachedConvert } from "./convert-state";
import { rememberPath, syncPathExists } from "./local-paths";

export interface OptimizeSummary {
  total: number;
  converted: number;
  canceled: boolean;
}

/**
 * Rewrite library/scene/audio source URLs after a conversion pass, then persist.
 * Uses the same immer+produce diff pattern as Meta.applyAction so the auto-save
 * watcher in Meta picks up the change and writes data.json.
 */
export function applySourceRewrites(mapping: Record<string, string>): void {
  const keys = Object.keys(mapping);
  if (keys.length === 0) return;
  const next = produce(useStore.getState(), (draft: any) => {
    const remap = (url: string) => (url && mapping[url]) || url;
    for (const s of draft.library ?? []) {
      if (s && s.url) s.url = remap(s.url);
    }
    for (const a of draft.audios ?? []) {
      if (a && a.url) a.url = remap(a.url);
    }
    for (const scene of draft.scenes ?? []) {
      for (const s of scene?.sources ?? []) {
        if (s && s.url) s.url = remap(s.url);
      }
    }
    if (draft.config?.defaultScene?.sources) {
      for (const s of draft.config.defaultScene.sources) {
        if (s && s.url) s.url = remap(s.url);
      }
    }
  });
  useStore.setState(next);
}

// Completed (and in-flight) background conversions keyed by original path, so an
// import that commits AFTER a detached convert has already finished still points
// at the optimized copy.
const resolvedRewrites = new Map<string, string>();
const inFlightRewrites = new Set<string>();

/** Best-known final path for an original imported file (optimized copy if done). */
export function getResolvedRewrite(path: string): string {
  return resolvedRewrites.get(path) || path;
}

/**
 * Convert a just-imported heavy file in the background — never awaited by the
 * import chain. When the encode settles on an output, every current reference
 * to the original is rewritten to the optimized copy (library, scenes, audios)
 * and the mapping is cached so references created afterwards still resolve.
 * The file appears in the list instantly and is upgraded in place.
 */
export function runDetachedConvert(path: string, notifLabel?: string): Promise<void> {
  if (!isCapacitor()) return Promise.resolve();
  if (inFlightRewrites.has(path)) return Promise.resolve();
  inFlightRewrites.add(path);
  trackDetachedConvert(path, notifLabel);
  return convertDetached(path, notifLabel)
    .then((out) => {
      if (out && out !== path) {
        resolvedRewrites.set(path, out);
        rememberPath(out);
        applySourceRewrites({ [path]: out });
        console.log(`[optimize-library] detached convert ${path} -> ${out}`);
      }
    })
    .catch((e) => console.warn("[optimize-library] detached convert failed:", path, e))
    .finally(() => {
      inFlightRewrites.delete(path);
      settleDetachedConvert(path);
    });
}

/**
 * A sandbox-relative media path the native plugin can probe/convert. Skips
 * remote (http[s]://) and absolute on-disk paths — folder/library sources that
 * point off-device or scan whole directories are left untouched on purpose.
 */
function isLocalMediaPath(p: string): boolean {
  if (!p || p.startsWith("/") || /^\w:/.test(p)) return false;
  if (p.includes("://")) return false;
  return isHeavyMediaPath(p);
}

/**
 * Collect every local media file worth checking: everything referenced by the
 * library / scenes plus every file currently stored under imported/.
 */
async function collectLocalMediaPaths(): Promise<string[]> {
  const paths = new Set<string>();
  const state: any = useStore.getState();

  for (const s of state.library ?? []) {
    if (isLocalMediaPath(s?.url)) paths.add(s.url);
  }
  for (const scene of state.scenes ?? []) {
    for (const s of scene?.sources ?? []) {
      if (isLocalMediaPath(s?.url)) paths.add(s.url);
    }
  }
  if (state.config?.defaultScene?.sources) {
    for (const s of state.config.defaultScene.sources) {
      if (isLocalMediaPath(s?.url)) paths.add(s.url);
    }
  }

  // Sweep the whole imported/ folder so on-device files that are no longer (or
  // not yet) referenced still get optimized.
  try {
    const imported = await getFilesystem().readDirectory("imported");
    for (const e of imported ?? []) {
      if (!e.isDirectory && isLocalMediaPath(e.name)) {
        paths.add(e.path || `imported/${e.name}`);
      }
    }
  } catch (e) {
    // imported/ may not exist yet — referenced files above still handle it.
  }

  return Array.from(paths);
}

/**
 * Run the entire "Optimize Existing Library" sweep natively. Converts heavy
 * images/videos (HDR, >1080p/1920, oversized, or high bitrate) and oversized /
 * one-platform-only audio to SDR 1080p / AAC 256 kbps copies and rewires every
 * library/scene reference to the optimized file.
 *
 * The sweep runs inside the native plugin (dedicated worker + Android
 * foreground service with a wake lock / iOS background task), so it keeps going
 * while the screen is locked or the app is minimized. Progress arrives as
 * 'progress' events; cancellation is native (FlipTranscoder.cancel()).
 *
 * When `keepOriginal` is true the originals stay on disk but the optimized
 * copies still become the new playback references. Otherwise originals are
 * deleted (matches on-import behavior) to free space.
 */
export async function optimizeLibrary(opts: {
  keepOriginal: boolean;
  onProgress?: (done: number, total: number, name: string) => void;
}): Promise<OptimizeSummary> {
  if (!isCapacitor()) {
    return { total: 0, converted: 0, canceled: false };
  }
  ensureDialogMounted();

  const paths = await collectLocalMediaPaths();
  const total = paths.length;
  if (total === 0) {
    return { total: 0, converted: 0, canceled: false };
  }
  showOptimizeProgress(total);

  let progressHandle: { remove: () => void } | null = null;
  try {
    try {
      progressHandle = await FlipTranscoder.addListener("progress", (data: { current: number; total: number; name: string }): void => {
        const current = Math.min(Number(data.current) || 0, total);
        const name = String(data.name || "");
        updateOptimizeProgress(current, name);
        opts.onProgress?.(current, total, name);
      });
    } catch (e) {
      progressHandle = null;
    }

    const res = await FlipTranscoder.optimizeLibrary({ paths, keepOriginal: opts.keepOriginal });
    const mapping: Record<string, string> = {};
    let converted = 0;
    for (const m of res?.mapping ?? []) {
      if (m?.from && m?.to) {
        mapping[m.from] = m.to;
        converted += 1;
      }
    }
    applySourceRewrites(mapping);
    return {
      total,
      converted,
      canceled: Boolean(isImportCancelled() || res?.canceled),
    };
  } finally {
    if (progressHandle) {
      try { progressHandle.remove(); } catch (e) { /* no-op */ }
    }
    hideOptimizeProgress();
  }
}

/**
 * Boot-time recovery: if the app was killed mid-sweep, the native plugin wrote
 * optimize-state.json with every finished from->to rewrite. Re-apply them so
 * references keep pointing at the optimized copies, then delete the state file.
 */
export async function recoverInterruptedOptimization(): Promise<void> {
  if (!isCapacitor()) return;
  const fs = getFilesystem();
  let mapping: Record<string, string> = {};
  try {
    const text = await fs.readFileText("optimize-state.json");
    const state = JSON.parse(text);
    for (const m of state?.mapping ?? []) {
      if (m?.from && m?.to) mapping[m.from] = m.to;
    }
  } catch (e) {
    return;
  }
  const safe: Record<string, string> = {};
  for (const [from, to] of Object.entries(mapping)) {
    if (isLocalMediaPath(from) && isLocalMediaPath(to)) {
      // Only re-apply rewrites whose optimized target actually exists. A stale
      // optimize-state.json must never point references at a missing file (and
      // then cause the app to treat the still-present original as garbage).
      const toExists = await fs.stat(to).then(() => true, () => false);
      const fromExists = await fs.stat(from).then(() => true, () => false);
      if (!toExists && fromExists) continue;
    }
    safe[from] = to;
  }
  const count = Object.keys(safe).length;
  if (count === 0) return;
  console.log(`[optimize-library] recovering ${count} interrupted rewrite(s)`);
  applySourceRewrites(safe);
  try {
    await fs.deleteFile("optimize-state.json");
  } catch (e) { /* no-op */ }
}

/** Optimized-copy sibling candidates for an original media path. */
function optimizedSiblingCandidates(path: string): string[] {
  const dot = path.lastIndexOf(".");
  if (dot <= 0) return [];
  const stem = path.substring(0, dot);
  return [`${stem}__sdr1080.mp4`, `${stem}__aac256.m4a`, `${stem}__sdr1080.jpg`];
}

/**
 * Boot-time reconciliation: any library/scene/audio URL that is missing from
 * the local path index but has an optimized sibling on disk (the original was
 * deleted by a successful conversion the app didn't get to re-point) is
 * re-pointed to that sibling. The reverse direction — a missing original with
 * no optimized copy — is intentionally left alone: the app shows an offline
 * marker instead of ever auto-deleting or re-writing references to nothing.
 */
export async function reconcileMissingReferences(): Promise<number> {
  if (!isCapacitor()) return 0;
  const fs = getFilesystem();
  const state: any = useStore.getState();

  const urls = new Set<string>();
  for (const s of state.library ?? []) if (isLocalMediaPath(s?.url)) urls.add(s.url);
  for (const a of state.audios ?? []) if (isLocalMediaPath(a?.url)) urls.add(a.url);
  for (const scene of state.scenes ?? []) {
    for (const s of scene?.sources ?? []) if (isLocalMediaPath(s?.url)) urls.add(s.url);
  }
  if (state.config?.defaultScene?.sources) {
    for (const s of state.config.defaultScene.sources) if (isLocalMediaPath(s?.url)) urls.add(s.url);
  }

  const mapping: Record<string, string> = {};
  for (const url of urls) {
    if (syncPathExists(url)) continue;
    for (const sibling of optimizedSiblingCandidates(url)) {
      const ok = await fs.stat(sibling).then(() => true, () => false);
      if (!ok) continue;
      mapping[url] = sibling;
      rememberPath(sibling);
      console.log(`[optimize-library] reconciled ${url} -> ${sibling}`);
      break;
    }
  }
  const count = Object.keys(mapping).length;
  if (count > 0) applySourceRewrites(mapping);
  return count;
}

/**
 * Best playable path for a possibly-stale reference: the recorded rewrite if a
 * conversion settled, otherwise the first optimized sibling (`__sdr1080.mp4`,
 * `__aac256.m4a`, `__sdr1080.jpg`) found on disk. Used by the media preview so
 * a reference whose original was deleted still plays instead of going blank;
 * the discovered sibling is also registered so all future references resolve.
 */
export async function resolveOptimizedFallback(url: string): Promise<string> {
  if (!isLocalMediaPath(url)) return url;
  const resolved = getResolvedRewrite(url);
  if (resolved !== url) return resolved;
  const fs = getFilesystem();
  for (const sibling of optimizedSiblingCandidates(url)) {
    const ok = await fs.stat(sibling).then(() => true, () => false);
    if (!ok) continue;
    resolvedRewrites.set(url, sibling);
    rememberPath(sibling);
    applySourceRewrites({ [url]: sibling });
    console.log(`[optimize-library] preview fallback ${url} -> ${sibling}`);
    return sibling;
  }
  return url;
}