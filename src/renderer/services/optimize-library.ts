import { produce } from "immer";

import { useStore } from "../stores/flipflipStore";
import { getFilesystem } from "./filesystem";
import { isCapacitor } from "./platform";
import {
  ensureDialogMounted,
  hideOptimizeProgress,
  isHeavyMediaPath,
  maybeConvertHeavy,
  showOptimizeProgress,
  updateOptimizeProgress,
} from "./convert";
import { isImportCancelled } from "./convert-state";

export interface OptimizeSummary {
  total: number;
  converted: number;
  canceled: boolean;
}

/**
 * Rewrite library/scene source URLs after a conversion pass, then persist.
 * Uses the same immer+produce diff pattern as Meta.applyAction so the auto-save
 * watcher in Meta picks up the change and writes data.json.
 */
function applySourceRewrites(mapping: Record<string, string>): void {
  const keys = Object.keys(mapping);
  if (keys.length === 0) return;
  const next = produce(useStore.getState(), (draft: any) => {
    const remap = (url: string) => (url && mapping[url]) || url;
    for (const s of draft.library ?? []) {
      if (s && s.url) s.url = remap(s.url);
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
 * Run the native optimizer over the entire local library. Converts heavy
 * images/videos (HDR, >1080p/1920, oversized, or high bitrate) to SDR 1080p
 * copies and rewires every library/scene reference to the optimized file.
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
  showOptimizeProgress(total);

  const mapping: Record<string, string> = {};
  let converted = 0;
  let done = 0;

  try {
    for (const path of paths) {
      if (isImportCancelled()) break;
      done += 1;
      const name = path.substring(path.lastIndexOf("/") + 1);
      updateOptimizeProgress(done, name);
      opts.onProgress?.(done, total, name);
      try {
        const finalPath = await maybeConvertHeavy(path, { keepOriginal: opts.keepOriginal, force: true });
        if (finalPath && finalPath !== path) {
          mapping[path] = finalPath;
          converted += 1;
        }
      } catch (e) {
        console.warn("[optimize-library] failed for:", path, e);
      }
    }
  } finally {
    hideOptimizeProgress();
  }

  const canceled = isImportCancelled();
  applySourceRewrites(mapping);
  return { total, converted, canceled };
}