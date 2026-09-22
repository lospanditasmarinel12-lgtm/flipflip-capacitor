import * as React from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider, createTheme } from "@mui/material/styles";

import { isCapacitor } from "./platform";
import { FlipTranscoder, ProbeResult } from "flipflip-transcoder";
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

// Pixel budget and dimension limits match the native profiles.
export const MAX_DECODE_DIMENSION = 1920;
export const MAX_IMAGE_PIXELS = 2_500_000;

// GIF/WebP may be animated — encoding a single frame to a still would destroy
// them, so they are never candidates for optimization.
const IMAGE_RE = /\.(jpe?g|png|tiff|bmp|heic|heif)$/i;
const VIDEO_RE = /\.(mp4|mov|m4v|webm)$/i;
const AUDIO_RE = /\.(mp3|m4a|aac|flac|wav|aiff?|ogg|opus|wma)$/i;

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
  return IMAGE_RE.test(path) || VIDEO_RE.test(path) || AUDIO_RE.test(path);
}

export interface ConvertOptions {
  /** Keep the original file on disk and return the optimized copy's path. */
  keepOriginal?: boolean;
  /** Run even when Settings -> Media Optimization is disabled. */
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
 * Log the enriched probe output for debugging the decision model.
 */
function logProbeResult(path: string, probe: ProbeResult): void {
  const mb = (b: number) => (b / (1024 * 1024)).toFixed(1);
  const d = probe.decision;
  console.log(
    "[convert] probe:",
    path.split("/").pop(),
    `${probe.width}x${probe.height}`,
    `pixels=${probe.pixelCount}`,
    `decoded=${mb(probe.estimatedDecodedBytes)}MB`,
    `codec=${probe.codec}`,
    probe.kind === "video" ? `fps=${probe.fps} dur=${probe.duration?.toFixed(1)}s` : "",
    probe.hdr ? "HDR" : "",
    `decision=${d.profile}`,
    d.reencode ? `-> ${d.targetWidth}x${d.targetHeight}` : "-> KEEP",
    d.toneMap ? "(tone-map)" : "",
    probe.estimatedOutputBytes > 0 ? `est_out=${mb(probe.estimatedOutputBytes)}MB` : "",
  );
}

/**
 * Ask the native transcoder whether `path` (relative to Directory.Data) needs
 * conversion to a predictable playback format, and if so, convert it (deleting
 * the original so only the optimized copy is kept). Returns the path to use for
 * playback.
 *
 * The native probe returns an enriched analysis with a deterministic decision
 * (profile, target dimensions, target FPS, tone-map flag). If the decision is
 * KEEP, the original is returned untouched. Otherwise, convert() is called to
 * produce the optimized copy.
 *
 * If the user presses Skip during this file, the raw already-written file is
 * kept as-is (no conversion) and returned unchanged.
 */
export async function maybeConvertHeavy(path: string, opts: ConvertOptions = {}): Promise<string> {
  if (!isCapacitor()) return path;
  // Media Optimization toggle (Settings -> General). When disabled, heavy
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
    // Probe quickly; the native plugin analyzes media properties, calculates
    // a pixel budget / decode cost, and returns a deterministic decision.
    const probe = await raceNative(FlipTranscoder.probe({ path }), 15000, signal);
    if (probe === "skip" || probe === "cancel") { abortBackgroundConvert(); return path; }
    if (!probe) {
      console.warn("[convert] probe timed out, keeping original:", path);
      abortBackgroundConvert();
      return path;
    }
    if (probe.kind === "other") return path;
    // A boxless video (no moov box) is unplayable and untranscodable — leave it
    // untouched instead of wasting a long encode that can only fail.
    if (probe.kind === "video" && probe.complete === false) {
      console.warn("[convert] incomplete video source (no moov), keeping original:", path);
      abortBackgroundConvert();
      return path;
    }

    // Log the enriched probe output for debugging the decision model.
    logProbeResult(path, probe);

    // Use the decision from probe as the primary conversion trigger.
    // The native plugin has already analyzed pixel count, decode cost, HDR,
    // codec, and FPS to determine whether re-encoding is needed.
    if (!probe.convert || !probe.decision?.reencode) return path;

    // Images can be wedged by ImageIO/IOSurface on some devices; keep their
    // window short so a stuck decode doesn't block the rest of the import.
    // Video/audio have NO practical JS cap: the native encoder only aborts on a
    // verified stall, so a slow-but-live encode (long 4K on a slow SoC) must be
    // allowed to run to completion. The race window here is a pure backstop for
    // a bridge call that can never resolve, not a limit on encode time.
    const convertMs = probe.kind === "video" ? 6 * 60 * 60 * 1000 : probe.kind === "audio" ? 2 * 60 * 60 * 1000 : 30000;
    const res = await raceNative(
      FlipTranscoder.convert({ path, keepOriginal: opts.keepOriginal === true }),
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

/**
 * Convert a heavy media file in the background, detached from the import chain.
 * Unlike maybeConvertHeavy there is no per-file skip/cancel dialog and no signal
 * race — the encode simply runs to completion (the native encoder only aborts on
 * a verified stall) and returns the optimized path, or null to keep the
 * original. Callers must register a rewrite (see optimize-library) so references
 * are upgraded to the optimized copy once it lands.
 */
export async function convertDetached(path: string, notifLabel?: string): Promise<string | null> {
  if (!isCapacitor()) return null;
  const enabled = useStore.getState()?.config?.generalSettings?.mediaOptimizationEnabled ?? true;
  if (!enabled) {
    console.log("[convert] Media optimization disabled — leaving untouched:", path);
    return null;
  }
  // Never resolves from the user side; only the probe/convert timeout and the
  // native stall-abort can settle the race.
  const neverSignal = new Promise<"skip" | "cancel">(() => {});
  try {
    const probe = await raceNative(FlipTranscoder.probe({ path }), 15000, neverSignal);
    if (!probe || probe === "skip" || probe === "cancel" || probe.kind === "other" || !probe.convert
        || (probe.kind === "video" && probe.complete === false)) {
      return null;
    }
    logProbeResult(path, probe);
    const convertMs = probe.kind === "video" ? 6 * 60 * 60 * 1000 : probe.kind === "audio" ? 2 * 60 * 60 * 1000 : 30000;
    const res = await raceNative(
      FlipTranscoder.convert({ path, keepOriginal: false, notifLabel }),
      convertMs,
      neverSignal
    );
    if (!res || res === "skip" || res === "cancel") return null;
    if (res.converted && res.outputPath && res.outputPath !== path) {
      return res.outputPath;
    }
    if (res.error) console.warn("[convert]", path, res.error);
    return null;
  } catch (e) {
    console.warn("[convert] detached convert failed:", path, e);
    return null;
  }
}
