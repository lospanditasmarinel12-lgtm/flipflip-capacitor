import { Capacitor } from "@capacitor/core";
import { isCapacitor } from "./platform";
import { showOptimizeProgress, updateOptimizeProgress, hideOptimizeProgress, isImportCancelled, ensureDialogMounted } from "./convert";
import { base64ToArrayBuffer, importBytes, optimizeCopied } from "./filepicker-shared";
import type { PickFilesResult } from "./filepicker-shared";
import { pickNativeDirectory, pickNativeMedia, pickNativeFilesByOptions as pickNativeFiles } from "./filepicker-native";
import { chooseImportSource } from "./picker-source";

// Let the main thread breathe between large imports: releases the current
// File/bytes so memory doesn't accumulate, and gives the UI a chance to render
// the progress overlay while the WebView is busy decoding heavy media.
const yieldTick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

// The web picker has no native file:// path to copy, so buffering a file this
// large (or larger) through JS would OOM the WebView — skip it instead.
const MAX_BUFFERED_FILE_BYTES = 30 * 1024 * 1024;

// The snapshot is only meaningful right after a picker launch reloads the
// WebView (same process, seconds later). localStorage is persistent across app
// launches, so a snapshot that is even a few minutes old must NOT be restored —
// otherwise a stale state would clobber the disk data.json on every fresh boot
// (seen: audios wiped 13 -> 0 on relaunch).
const PRE_PICK_MAX_AGE_MS = 5 * 60 * 1000;

export function saveAppState() {
  try {
    const state = (window as any).__ZUSTAND_STATE__;
    if (state) {
      localStorage.setItem("flipflip_prepick_state", JSON.stringify({
        ts: Date.now(),
        state,
      }));
    }
  } catch(e) {}
}

export function restoreAppStateIfNeeded() {
  try {
    const saved = localStorage.getItem("flipflip_prepick_state");
    if (!saved) return null;
    let parsed: any = null;
    try { parsed = JSON.parse(saved); } catch(e) { parsed = null; }
    localStorage.removeItem("flipflip_prepick_state");
    const ts = parsed && typeof parsed.ts === "number" ? parsed.ts : 0;
    if (ts > 0 && Date.now() - ts < PRE_PICK_MAX_AGE_MS) {
      return parsed.state;
    }
  } catch(e) {}
  return null;
}

export type { PickFilesResult };

/**
 * On mobile the web `<input type=file>` opens the native OS media chooser
 * (Photo Library / Files) and respects `accept` filters. On iOS WKWebView this
 * reads reliably, so we keep it as the primary path there. On Android the
 * WebView hands back content-URI-backed File objects whose `arrayBuffer()` can
 * silently return empty, so we use the native Capawesome picker instead
 * (see filepicker-native.ts — it also preserves extensions via MIME type).
 */

export async function pickDirectory(): Promise<PickFilesResult> {
  if (!isCapacitor()) {
    return pickDirectoryWeb();
  }
  console.log("filepicker: Capacitor pickDirectory - saving state");
  saveAppState();
  // Restore the photo-library-vs-files choice the web input picker used to
  // offer: Photo Library → PHPicker media import, Files → document picker.
  let source;
  try {
    source = await chooseImportSource();
  } catch (e) {
    console.warn("filepicker: source chooser failed, defaulting to Files", e);
    source = "files";
  }
  if (!source) return { canceled: true, filePaths: [] };
  try {
    if (source === "media") {
      return await pickNativeMedia();
    }
    return await pickNativeDirectory();
  } catch (e) {
    console.warn("filepicker: native pickDirectory failed on this device/OS (document picker unavailable), falling back to the web picker", e);
    return pickDirectoryWeb();
  }
}

export async function pickFiles(options: {
  properties?: string[];
  filters?: Array<{name: string; extensions: string[]}>;
}): Promise<PickFilesResult> {
  if (!isCapacitor()) {
    return pickFilesWeb(options);
  }
  console.log("filepicker: Capacitor pickFiles - saving state");
  saveAppState();
  // Prefer the native picker (returns real paths so large files can be copied
  // path-to-path without buffering the whole file in JS). On devices where the
  // native document picker is unavailable or errors (e.g. some SAF providers
  // fail with "Error opening activity"), fall back to the standard WebView file
  // chooser instead of rejecting — a silently swallowed rejection is what left
  // the audio library permanently empty.
  try {
    return await pickNativeFiles(options);
  } catch (e) {
    console.warn("filepicker: native pickFiles failed on " + Capacitor.getPlatform() + " (document picker unavailable), falling back to the web picker", e);
    return pickFilesWeb(options);
  }
}

async function pickFilesWeb(options: {
  properties?: string[];
  filters?: Array<{name: string; extensions: string[]}>;
}): Promise<PickFilesResult> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.style.display = "none";

    if (options.filters && options.filters.length > 0) {
      const exts = options.filters.flatMap((f) =>
        f.extensions.map((e) => (e === "*" ? "" : `.${e}`))
      ).filter(Boolean);
      if (exts.length > 0) input.accept = exts.join(",");
    }

    input.onchange = async () => {
      const files = Array.from(input.files || []);
      if (files.length === 0) {
        resolve({ canceled: true, filePaths: [] });
        input.remove();
        return;
      }

      const paths: string[] = [];
      let skippedDuplicates = 0;
      const total = files.length;
      ensureDialogMounted();
      showOptimizeProgress(total);
      let done = 0;
      while (files.length > 0) {
        if (isImportCancelled()) break;
        const file = files.shift();
        done++;
        // The web picker has no file:// path to copy natively; buffering huge
        // files in JS OOMs the WebView, so skip anything too large with a note.
        if (file.size > MAX_BUFFERED_FILE_BYTES) {
          console.warn(`[filepicker] skipping large file (${file.name}, ${file.size} bytes) - no native path to copy, buffering would OOM`);
          updateOptimizeProgress(done, file.name);
          await yieldTick();
          continue;
        }
        try {
          const bytes = await readFileAsArrayBuffer(file);
          const r = await importBytes(bytes, file.name);
          if (!r) { updateOptimizeProgress(done, file.name); await yieldTick(); continue; }
          if (r.existing) skippedDuplicates++;
          const finalPath = await optimizeCopied(r.path, file.name, done, total);
          if (finalPath) paths.push(finalPath);
        } catch (e) {
          console.error("Failed to import file", file.name, e);
          updateOptimizeProgress(done, file.name);
        }
        await yieldTick();
      }
      hideOptimizeProgress();
      console.log("[filepicker] web import done:", paths.length, "files,", skippedDuplicates, "duplicates skipped");

      input.remove();
      resolve({ canceled: false, filePaths: paths, skippedDuplicates });
    };

    document.body.appendChild(input);
    input.click();

    setTimeout(() => {
      if (!resolve) return;
      input.remove();
      resolve({ canceled: true, filePaths: [] });
    }, 120000);
  });
}

async function pickDirectoryWeb(): Promise<PickFilesResult> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.accept = "image/*,video/*,audio/*";
    input.style.display = "none";

    input.onchange = async () => {
      const files = Array.from(input.files || []);
      if (files.length === 0) {
        resolve({ canceled: true, filePaths: [] });
        input.remove();
        return;
      }

      const paths: string[] = [];
      let skippedDuplicates = 0;
      const total = files.length;
      ensureDialogMounted();
      showOptimizeProgress(total);
      let done = 0;
      while (files.length > 0) {
        if (isImportCancelled()) break;
        const file = files.shift();
        done++;
        // The web picker has no file:// path to copy natively; buffering huge
        // files in JS OOMs the WebView, so skip anything too large with a note.
        if (file.size > MAX_BUFFERED_FILE_BYTES) {
          console.warn(`[filepicker] skipping large file (${file.name}, ${file.size} bytes) - no native path to copy, buffering would OOM`);
          updateOptimizeProgress(done, file.name);
          await yieldTick();
          continue;
        }
        try {
          const bytes = await readFileAsArrayBuffer(file);
          const r = await importBytes(bytes, file.name);
          if (!r) { updateOptimizeProgress(done, file.name); await yieldTick(); continue; }
          if (r.existing) skippedDuplicates++;
          const finalPath = await optimizeCopied(r.path, file.name, done, total);
          if (finalPath) paths.push(finalPath);
        } catch (e) {
          console.error("Failed to import file", file.name, e);
          updateOptimizeProgress(done, file.name);
        }
        await yieldTick();
      }
      hideOptimizeProgress();
      console.log("[filepicker] web import done:", paths.length, "files,", skippedDuplicates, "duplicates skipped");

      input.remove();
      resolve({ canceled: false, filePaths: paths, skippedDuplicates });
    };

    document.body.appendChild(input);
    input.click();

    setTimeout(() => {
      if (!resolve) return;
      input.remove();
      resolve({ canceled: true, filePaths: [] });
    }, 120000);
  });
}

async function readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  if (typeof file.arrayBuffer === "function") {
    return await file.arrayBuffer();
  }
  const base64 = await readFileAsDataURL(file);
  return base64ToArrayBuffer(base64.split(",")[1]);
}

function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
