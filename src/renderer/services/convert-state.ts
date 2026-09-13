/**
 * Conversion-progress state + import skip/cancel signals.
 *
 * Kept free of React so both the picker loops (services) and the dialog
 * component can consume it without a circular import.
 */
export interface ConversionState {
  open: boolean;
  total: number;
  current: number;
  name: string;
}

export type SkipSignalValue = "skip" | "cancel";

let state: ConversionState = { open: false, total: 0, current: 0, name: "" };
let cancelled = false;
let skipResolve: ((v: SkipSignalValue) => void) | null = null;

const listeners = new Set<() => void>();
const notify = () => {
  for (const fn of listeners) fn();
};

export function getConversionState(): ConversionState {
  return { ...state };
}

export function subscribeConversion(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function showOptimizeProgress(total: number): void {
  cancelled = false;
  state = { open: true, total, current: 0, name: "" };
  notify();
}

export function updateOptimizeProgress(current: number, name: string): void {
  state = { ...state, current, name };
  notify();
}

export function hideOptimizeProgress(): void {
  state = { ...state, open: false };
  notify();
}

export function isImportCancelled(): boolean {
  return cancelled;
}

/** User pressed Cancel: stop the batch; files already done are still added. */
export function cancelImport(): void {
  cancelled = true;
  const r = skipResolve;
  skipResolve = null;
  if (r) r("cancel");
  state = { ...state, open: false };
  notify();
}

/** User pressed Skip: save the current file as-is (no conversion) and continue. */
export function skipCurrentFile(): void {
  const r = skipResolve;
  skipResolve = null;
  if (r) r("skip");
}

/** Per-file signal raced against the current file's conversion/probe. */
export function beginFileSkipSignal(): Promise<SkipSignalValue> {
  return new Promise<SkipSignalValue>((resolve) => {
    skipResolve = resolve;
  });
}