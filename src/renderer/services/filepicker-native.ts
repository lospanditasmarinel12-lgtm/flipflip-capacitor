import { Capacitor } from "@capacitor/core";
import { base64ToArrayBuffer, importBytes, optimizeCopied, PickFilesResult, sanitizeName } from "./filepicker-shared";
import { showOptimizeProgress, updateOptimizeProgress, hideOptimizeProgress, isImportCancelled } from "./convert";
import { rememberPath } from "./local-paths";

// Let the main thread breathe between large imports (see filepicker.ts).
const yieldTick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

// Files above this size, plus all audio/video, are copied path-to-path into the
// app's storage instead of being buffered through JS (which OOM-kills the
// WebView on big media).
const BIG_FILE_BYTES = 30 * 1024 * 1024;
const VIDEO_EXT_RE = /\.(mp4|mov|m4v|webm|mkv|ogv|3gp)$/i;
const AUDIO_EXT_RE = /\.(wav|mp3|m4a|aac|flac|ogg|opus|wma|aiff?|caf)$/i;

/**
 * Pick a free `imported/<clean-name>` for a path-to-path native copy. If the
 * name exists, a consecutive numeric suffix is appended (`clip.mp4`,
 * `clip-1.mp4`, …) — duplicates are allowed, nothing is deduped.
 */
async function uniqueDestName(name: string): Promise<string> {
  const { Filesystem, Directory } = await import("@capacitor/filesystem");
  const full = sanitizeName(name);
  const dot = full.toLowerCase().lastIndexOf(".");
  const stem = dot > 0 ? full.substring(0, dot) : full;
  let ext = dot > 0 ? full.substring(dot) : "";
  for (let i = 0; i < 1000; i++) {
    const destName = `${stem}${i === 0 ? "" : "-" + i}${ext}`;
    const exists = await Filesystem.stat({ path: `imported/${destName}`, directory: Directory.Data })
      .then(() => true, () => false);
    if (!exists) return destName;
  }
  return `${stem}-${Date.now()}${ext}`;
}

/**
 * Media import over native Capawesome pickers.
 *
 * The pickers return real file:// paths, so audio/video and large files are
 * copied path-to-path into the app's storage via FilePicker.copyFile (a native
 * FileManager copy, no JS buffering). Audio is never hashed or analyzed — it is
 * imported as-is. Only small images go through the content-addressed, buffered
 * path (importBytes) for dedupe.
 */
async function importPickedFiles(files: Array<any>): Promise<PickFilesResult> {
  const paths: string[] = [];
  let skippedDuplicates = 0;
  showOptimizeProgress(files.length);
  let done = 0;
  let importDirReady = false;
  const queue = Array.from(files);
  while (queue.length > 0) {
    if (isImportCancelled()) break;
    const f = queue.shift();
    done++;
    const name = f.name || "file";

    const isVideo = VIDEO_EXT_RE.test(name) || (f.mimeType || "").startsWith("video/");
    const isAudio = AUDIO_EXT_RE.test(name) || (f.mimeType || "").startsWith("audio/");
    const isBig = (f.size || 0) > BIG_FILE_BYTES;

    // Audio/video/large files are imported with a native path-to-path copy —
    // never buffered through JS, never hashed. Audio is stored as-is.
    if ((isAudio || isVideo || isBig) && f.path) {
      try {
        const { FilePicker } = await import("@capawesome/capacitor-file-picker");
        const { Filesystem, Directory } = await import("@capacitor/filesystem");
        if (!importDirReady) {
          // Ensure Documents/imported/ exists for the native copy. iOS creates
          // parents itself, but Android's copy does NOT. Do it once — Capacitor
          // mkdir errors when the directory already exists, so only create when
          // it's actually missing to keep the log clean.
          const exists = await Filesystem.stat({ path: "imported", directory: Directory.Data })
            .then(() => true, () => false);
          if (!exists) {
            await Filesystem.mkdir({ path: "imported", directory: Directory.Data, recursive: true }).catch(() => {});
          }
          importDirReady = true;
        }
        const base = await Filesystem.getUri({ path: "", directory: Directory.Data });
        const destName = await uniqueDestName(name);
        const absDest = `${base.uri}/imported/${destName}`;
        await FilePicker.copyFile({ from: f.path, to: absDest });
        const dest = `imported/${destName}`;
        const finalPath = await optimizeCopied(dest, name, done);
        // The native copy bypasses the JS filesystem adapter, so register the
        // result with the local path index — consumers gate on syncPathExists
        // (e.g. AudioLibrary.addAudioSources) and would silently drop new files.
        if (finalPath) { rememberPath(finalPath); paths.push(finalPath); }
        updateOptimizeProgress(done, name);
        await yieldTick();
        continue;
      } catch (e) {
        // Never fall back to a buffered read for these classes: it would load
        // the whole file (up to GBs) into the WebView/native bridge and OOM.
        console.warn("[filepicker:native] path-copy failed for", name, f.path, e);
        updateOptimizeProgress(done, name);
        await yieldTick();
        continue;
      }
    }
    // No usable path for an audio/video/large file — cannot import safely.
    if (isAudio || isVideo || isBig) {
      console.warn("[filepicker:native] skipping", name, "- no usable path for a path-to-path import");
      updateOptimizeProgress(done, name);
      await yieldTick();
      continue;
    }

    let bytes: ArrayBuffer | null = null;
    if (f.path) {
      try {
        const { Filesystem } = await import("@capacitor/filesystem");
        const d = await Filesystem.readFile({ path: f.path });
        bytes = d.data instanceof Blob ? await d.data.arrayBuffer() : base64ToArrayBuffer(d.data);
      } catch (e) {
        try {
          const url = f.path.startsWith("content://") || f.path.startsWith("file://")
            ? Capacitor.convertFileSrc(f.path)
            : f.path;
          const resp = await fetch(url);
          bytes = await resp.arrayBuffer();
        } catch (e2) {
          console.error("copyFileToSandbox: error copying", f.path, e2);
        }
      }
    } else if (f.blob) {
      bytes = await f.blob.arrayBuffer();
    }
    if (bytes == null) { updateOptimizeProgress(done, name); await yieldTick(); continue; }
    try {
      console.log("[filepicker:native]", JSON.stringify({ name, path: f.path, mimeType: f.mimeType, size: f.size, bytes: bytes.byteLength }));
      const r = await importBytes(bytes, name, f.mimeType);
      if (r) {
        if (r.existing) skippedDuplicates++;
        rememberPath(r.path);
        const finalPath = await optimizeCopied(r.path, name, done);
        if (finalPath) { rememberPath(finalPath); paths.push(finalPath); }
      }
    } catch (e) {
      console.warn("[filepicker:native] import failed for", name, e);
      updateOptimizeProgress(done, name);
    }
    await yieldTick();
  }
  hideOptimizeProgress();
  console.log("[filepicker:native] got", paths.length, "files,", skippedDuplicates, "duplicates skipped");
  return { canceled: paths.length === 0, filePaths: paths, skippedDuplicates };
}

async function pickNativeFiles(_options?: {
  properties?: string[];
  filters?: Array<{name: string; extensions: string[]}>;
}): Promise<PickFilesResult> {
  const { FilePicker } = await import("@capawesome/capacitor-file-picker");
  const result = await FilePicker.pickFiles({ limit: 0, readData: false });
  return importPickedFiles(result.files as Array<any>);
}

/** Photo Library import (PHPicker on iOS, photo picker on Android). */
export async function pickNativeMedia(): Promise<PickFilesResult> {
  const { FilePicker } = await import("@capawesome/capacitor-file-picker");
  const result = await FilePicker.pickMedia({ limit: 0 });
  return importPickedFiles(result.files as Array<any>);
}

export async function pickNativeDirectory(): Promise<PickFilesResult> {
  return pickNativeFiles();
}

export async function pickNativeFilesByOptions(options?: {
  properties?: string[];
  filters?: Array<{name: string; extensions: string[]}>;
}): Promise<PickFilesResult> {
  return pickNativeFiles(options);
}