import { FlipTranscoder } from "flipflip-transcoder";

/**
 * Conversion-progress state + import skip/cancel signals.
 *
 * Kept free of React so both the picker loops (services) and the dialog
 * component can consume it without a circular import.
 */
export interface DetachedConvert {
  /** Original path being converted in the background. */
  id: string;
  name: string;
  settled: boolean;
}

export interface ConversionState {
  open: boolean;
  /** True while an import batch loop is live (show…/hideOptimizeProgress). */
  active: boolean;
  /** True when a per-file skip signal is armed (maybeConvertHeavy flow). */
  hasSignal: boolean;
  total: number;
  current: number;
  name: string;
  /** In-flight / finished detached background conversions (import optimizes). */
  detached: DetachedConvert[];
}

export type SkipSignalValue = "skip" | "cancel";

let state: ConversionState = {
  open: false,
  active: false,
  hasSignal: false,
  total: 0,
  current: 0,
  name: "",
  detached: [],
};
let cancelled = false;
let skipResolve: ((v: SkipSignalValue) => void) | null = null;

const listeners = new Set<() => void>();
const badgeListeners = new Set<() => void>();
const notify = () => {
  for (const fn of listeners) fn();
};
const notifyBadges = () => {
  for (const fn of badgeListeners) fn();
};

export function getConversionState(): ConversionState {
  return { ...state, detached: state.detached.map((d) => ({ ...d })) };
}

export function subscribeConversion(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Subscribe to the lightweight channel that only fires when the set of
 *  in-flight background conversions changes (used by library-row badges, so
 *  a large grid doesn't re-render on every import progress tick). */
export function subscribeConversionBadges(fn: () => void): () => void {
  badgeListeners.add(fn);
  return () => {
    badgeListeners.delete(fn);
  };
}

export function showOptimizeProgress(total: number): void {
  cancelled = false;
  state = { ...state, open: true, active: true, hasSignal: false, total, current: 0, name: "" };
  notify();
}

export function updateOptimizeProgress(current: number, name: string): void {
  state = { ...state, current, name };
  notify();
}

/** Hide the dialog when the import loop ends. Background conversions keep the
 *  dialog open until they ALL settle (see settleDetachedConvert). */
export function hideOptimizeProgress(): void {
  state = { ...state, active: false, hasSignal: false, open: state.detached.some((d) => !d.settled) };
  notify();
}

/** Register a detached background conversion; keeps the dialog open. */
export function trackDetachedConvert(id: string, name?: string): void {
  if (state.detached.some((d) => d.id === id)) return;
  let short = name && name.length > 0 ? name : id.substring(id.lastIndexOf("/") + 1);
  const labelMatch = /^\d+\/\d+\s*[—-]\s*(.*)$/.exec(short);
  if (labelMatch) short = labelMatch[1];
  state = { ...state, open: true, detached: [...state.detached, { id, name: short, settled: false }] };
  notifyBadges();
  notify();
}

/** Mark a detached conversion finished; close the dialog when all are done. */
export function settleDetachedConvert(id: string): void {
  const next = state.detached.map((d) => (d.id === id ? { ...d, settled: true } : d));
  state = { ...state, detached: next, open: state.active || next.some((d) => !d.settled) };
  notifyBadges();
  notify();
}

/** Is this path currently the subject of an in-flight background conversion? */
export function isPathOptimizing(path: string): boolean {
  return state.detached.some((d) => !d.settled && d.id === path);
}

export function isImportCancelled(): boolean {
  return cancelled;
}

/** User pressed Cancel: stop the batch; files already done are still added. */
export function cancelImport(): void {
  cancelled = true;
  // Tell the native side too, so a runaway foreground-sweep / background
  // conversion aborts instead of deleting originals the user tried to keep.
  try { FlipTranscoder.cancel().catch(() => {}); } catch (e) { /* no-op */ }
  const r = skipResolve;
  skipResolve = null;
  if (r) r("cancel");
  // Everything still converting is considered done from the UI's perspective
  // (the native side aborts the rest), so badges clear and the dialog closes.
  state = {
    ...state,
    detached: state.detached.map((d) => ({ ...d, settled: true })),
    open: false,
    active: false,
    hasSignal: false,
  };
  notifyBadges();
  notify();
}

/** User pressed Skip: save the current file as-is (no conversion) and continue. */
export function skipCurrentFile(): void {
  const r = skipResolve;
  skipResolve = null;
  state = { ...state, hasSignal: false };
  notify();
  if (r) r("skip");
}

/** Per-file signal raced against the current file's conversion/probe. */
export function beginFileSkipSignal(): Promise<SkipSignalValue> {
  return new Promise<SkipSignalValue>((resolve) => {
    skipResolve = resolve;
    state = { ...state, hasSignal: true };
    notify();
  });
}