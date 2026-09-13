import * as React from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider, createTheme } from "@mui/material/styles";

import { isCapacitor } from "./platform";
import { FlipTranscoder } from "flipflip-transcoder";
import { useStore } from "../stores/flipflipStore";
import {
  showOptimizeProgress,
  updateOptimizeProgress,
  hideOptimizeProgress,
  beginFileSkipSignal,
  isImportCancelled,
} from "./convert-state";
import ConversionDialog from "../components/ConversionDialog";

// Keep the overlay-based progress API exported for existing callers
// (filepicker + filepicker-native); the UI is now the Conversion dialog.
export { showOptimizeProgress, updateOptimizeProgress, hideOptimizeProgress };
export { isImportCancelled };

export const MAX_DECODE_DIMENSION = 1920;

const IMAGE_RE = /\.(jpe?g|png|gif|webp|tiff|bmp|heic|heif)$/i;
const VIDEO_RE = /\.(mp4|mov|m4v|webm)$/i;

let _dialogMounted = false;

export function ensureDialogMounted(): void {
  if (_dialogMounted) return;
  _dialogMounted = true;
  try {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const theme = createTheme();
    createRoot(container).render(
      React.createElement(ThemeProvider, { theme }, React.createElement(ConversionDialog))
    );
  } catch (e) {
    console.warn("[convert] failed to mount conversion dialog:", e);
  }
}

export function isHeavyMediaPath(path: string): boolean {
  return IMAGE_RE.test(path) || VIDEO_RE.test(path);
}

export interface ConvertOptions {
  /** Keep the original file on disk and return the optimized copy's path. */
  keepOriginal?: boolean;
  /** Run even when Settings → Media Optimization is disabled. */
  force?: boolean;
}

/**
 * Race a native bridge call against a timeout AND the user's per-file
 * skip/cancel signal. Returns the resolved value, or 'skip'/'cancel' if the
 * user chose to save the file as-is (or stop), or undefined on timeout.
 */
type SignalOutcome = "skip" | "cancel" | undefined;
async function raceNative<T>(
  p: Promise<T>,
  ms: number,
  signal: Promise<"skip" | "cancel">
): Promise<T | SignalOutcome> {
  return await Promise.race([
    p,
    new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), ms)),
    signal,
  ]);
}

/**
 * Ask the native transcoder whether `path` (relative to Directory.Data) needs
 * conversion to SDR 1080p, and if so, convert it (deleting the original so only
 * the optimized copy is kept). Returns the path to use for playback.
 *
 * If the user presses Skip during this file, the raw already-written file is
 * kept as-is (no conversion) and returned unchanged.
 */
export async function maybeConvertHeavy(path: string, opts: ConvertOptions = {}): Promise<string> {
  if (!isCapacitor()) return path;
  // Media Optimization toggle (Settings → General). When disabled, heavy
  // camera media is imported untouched — no SDR conversion, original kept.
  const enabled = useStore.getState()?.config?.generalSettings?.mediaOptimizationEnabled ?? true;
  if (!opts.force && !enabled) {
    console.log("[convert] Media optimization is disabled — importing untouched:", path);
    return path;
  }
  ensureDialogMounted();
  // Stop any background native conversion when the user asks to keep the file
  // as-is (or the window elapses/import is cancelled). Without this the native
  // convert keeps running and deletes the original import once it settles,
  // which loses the file the user chose to keep.
  const abortBackgroundConvert = () => {
    try { FlipTranscoder.cancel().catch(() => {}); } catch (e) { /* no-op */ }
  };
  const signal = beginFileSkipSignal();
  try {
    // Probe quickly; videos and images get appropriate convert windows.
    const probe = await raceNative(FlipTranscoder.probe({ path }), 15000, signal);
    if (probe === "skip" || probe === "cancel") { abortBackgroundConvert(); return path; }
    if (!probe) {
      console.warn("[convert] probe timed out, keeping original:", path);
      abortBackgroundConvert();
      return path;
    }
    if (probe.kind === "other" || !probe.convert) return path;

    // Images can be wedged by ImageIO/IOSurface on some devices; keep their
    // window short so a stuck decode doesn't block the rest of the import.
    const convertMs = probe.kind === "video" ? 600000 : 30000;
    const res = await raceNative(
      FlipTranscoder.convert({ path, maxDimension: MAX_DECODE_DIMENSION, keepOriginal: opts.keepOriginal === true }),
      convertMs,
      signal
    );
    if (res === "skip" || res === "cancel") { abortBackgroundConvert(); return path; }
    if (!res) {
      console.warn("[convert] convert timed out, keeping original:", path);
      abortBackgroundConvert();
      return path;
    }
    if (res.converted) return res.outputPath;
    if (res.error) console.warn("[convert]", res.outputPath, res.error);
    return path;
  } catch (e) {
    console.warn("[convert] skipped heavy media:", path, e);
    return path;
  }
}