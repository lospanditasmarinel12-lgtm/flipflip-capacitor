import { getFilesystem } from "./filesystem";
import { maybeConvertHeavy, isHeavyMediaPath, updateOptimizeProgress } from "./convert";

export interface PickFilesResult {
  canceled: boolean;
  filePaths: string[];
  /** Purely informational now: files are never deduped, duplicates get a
   *  consecutive numeric suffix instead, so this stays 0. */
  skippedDuplicates?: number;
}

function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i < 0 ? "" : name.substring(i);
}

/**
 * Maps a MIME type to a file extension so imports survive the strict
 * `isVideo`/`isAudio`/`isVideoPlaylist` filters even when the picker
 * (Android content URIs) hands back a display name without an extension.
 */
const MIME_EXTENSIONS: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/png": ".png",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/tiff": ".tiff",
  "image/bmp": ".bmp",
  "image/heic": ".heic",
  "image/heif": ".heif",
  "video/mp4": ".mp4",
  "video/x-m4v": ".m4v",
  "video/quicktime": ".mov",
  "video/x-matroska": ".mkv",
  "video/webm": ".webm",
  "video/ogg": ".ogv",
  "audio/mpeg": ".mp3",
  "audio/mp4": ".m4a",
  "audio/x-m4a": ".m4a",
  "audio/wav": ".wav",
  "audio/x-wav": ".wav",
  "audio/ogg": ".ogg",
  "audio/x-flac": ".flac",
  "audio/x-ms-wma": ".wma",
  "application/x-mpegurl": ".m3u8",
  "audio/x-scpls": ".pls",
  "application/xspf+xml": ".xspf",
  "video/x-ms-asf": ".asx",
};

function extensionForMime(mime: string | undefined): string {
  if (!mime) return "";
  return MIME_EXTENSIONS[mime.split(";")[0].trim().toLowerCase()] || "";
}

export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * Clean, human-readable filename stem. Keeps the extension intact (chops the
 * stem only, lowercased ext) so extension-based content filters keep working.
 */
export function sanitizeName(name: string): string {
  const dot = name.toLowerCase().lastIndexOf(".");
  let stem = name;
  let ext = "";
  if (dot > 0 && dot < name.length - 1) {
    stem = name.substring(0, dot);
    ext = name.substring(dot).toLowerCase();
  }
  stem = stem.replace(/[^\w.\-]/g, "_").slice(0, 80 - ext.length);
  return (stem || "file") + ext;
}

function uniqueImportPath(stem: string, ext: string): Promise<string> {
  const fs = getFilesystem();
  const tryIndex = async (i: number): Promise<string> => {
    if (i > 999) {
      return `imported/${stem}-${Date.now()}${ext}`;
    }
    const name = `${stem}${i === 0 ? "" : "-" + i}${ext}`;
    const path = `imported/${name}`;
    if (await fs.fileExists(path).catch(() => false)) {
      return tryIndex(i + 1);
    }
    return path;
  };
  return tryIndex(0);
}

/**
 * Imported files are stored as `imported/<stem><ext>`. Existing files with the
 * same name are NOT deduped — duplicates are allowed and get a consecutive
 * numeric suffix (`photo.jpg`, `photo-1.jpg`, …) per the product requirement.
 * A leftover hash/timestamp prefix is never added, so filenames stay readable.
 *
 * `mimeType` is optional: when the picked name carries no extension (common for
 * Android content URIs), it is derived from the MIME type instead.
 */
export async function importBytes(
  bytes: ArrayBuffer,
  name: string,
  mimeType?: string
): Promise<{ path: string; existing: boolean } | null> {
  try {
    const full = sanitizeName(name);
    const ext = extOf(full) || extensionForMime(mimeType);
    const stem = ext ? full.substring(0, full.length - ext.length) : full;
    const rawPath = await uniqueImportPath(stem, ext);
    await getFilesystem().writeFile(rawPath, bytes);
    return { path: rawPath, existing: false };
  } catch (e) {
    console.error("importBytes:", e);
    return null;
  }
}

export async function optimizeCopied(path: string | null, name: string, done: number): Promise<string | null> {
  if (!path) { updateOptimizeProgress(done, name); return null; }
  const finalPath = isHeavyMediaPath(path) ? await maybeConvertHeavy(path) : path;
  updateOptimizeProgress(done, name);
  return finalPath;
}
