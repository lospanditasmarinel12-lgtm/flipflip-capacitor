import * as React from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider, createTheme } from "@mui/material/styles";

import SourcePickerDialog from "../components/SourcePickerDialog";

export type ImportSource = "media" | "files" | null;

export interface SourcePickerState {
  open: boolean;
}

let state: SourcePickerState = { open: false };
let resolveFn: ((v: ImportSource) => void) | null = null;
let mounted = false;

const listeners = new Set<() => void>();
const notify = () => {
  for (const fn of listeners) fn();
};

function mountOnce(): void {
  if (mounted) return;
  mounted = true;
  try {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const theme = createTheme();
    createRoot(container).render(
      React.createElement(ThemeProvider, { theme }, React.createElement(SourcePickerDialog))
    );
  } catch (e) {
    console.warn("[picker-source] failed to mount source dialog:", e);
  }
}

export function getSourcePickerState(): SourcePickerState {
  return { ...state };
}

export function subscribeSourcePicker(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/**
 * Ask the user where to import from: Photo Library or Files.
 * Resolves null when dismissed.
 */
export function chooseImportSource(): Promise<ImportSource> {
  mountOnce();
  // Cancel any stale pending choice before arming a new one.
  if (resolveFn) {
    const old = resolveFn;
    resolveFn = null;
    old(null);
  }
  state = { open: true };
  notify();
  return new Promise<ImportSource>((resolve) => {
    resolveFn = resolve;
  });
}

export function resolveSource(v: ImportSource): void {
  const r = resolveFn;
  resolveFn = null;
  state = { open: false };
  notify();
  if (r) r(v);
}