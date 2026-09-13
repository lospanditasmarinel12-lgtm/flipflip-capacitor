import { parseBuffer, parseBlob } from "music-metadata";
import { getFilesystem } from "./filesystem";
import { isCapacitor } from "./platform";

// Metadata lives in the leading bytes of a file (ID3v2 / moov / RIFF headers).
// Reading the whole track just to tag it turns multi-GB WAV imports into an
// OOM on the native bridge (base64 inflates ~4/3 and the whole file is
// buffered). Cap the pre-read; callers fall back to a filename-derived name if
// a tag block isn't within the cap. Most ID3v2 / FLAC / Vorbis tags fit in a
// 512KB lead read; only fall back to a larger read when tags are missing.
const METADATA_CHUNK_BYTES = 512 * 1024;
const MAX_METADATA_BYTES = 4 * 1024 * 1024;

/**
 * Reads music metadata for a file inside the app sandbox.
 * Uses the browser build of music-metadata (parseBuffer), which needs no
 * Node filesystem.
 */
export async function parseAudioFromPath(path: string): Promise<any> {
  const fs = getFilesystem();
  if (isCapacitor()) {
    const { Filesystem, Directory } = await import("@capacitor/filesystem");
    const buffer = await readPrefixUsingFirstChunk(path, Filesystem, Directory);
    // Duration from a truncated buffer would be wrong — compute from a full
    // decode elsewhere (capped) or let the native player report it.
    return parseBuffer(new Uint8Array(buffer), undefined, { duration: false });
  }
  const buffer = await fs.readFile(path);
  return parseBuffer(new Uint8Array(buffer), undefined, { duration: true });
}

/**
 * Reads the leading bytes of a file for tag extraction. Starts small (512KB —
 * enough for virtually every ID3v2 / FLAC / Vorbis block) and only widens the
 * read when the small chunk carries no tags at all. Keeps the base64 bridge
 * transfer (and the GC pressure it causes in the WebView) as low as possible.
 */
async function readPrefixUsingFirstChunk(path: string, Filesystem: any, Directory: any): Promise<ArrayBuffer> {
  for (const size of [METADATA_CHUNK_BYTES, MAX_METADATA_BYTES]) {
    const result = await Filesystem.readFile({
      path,
      directory: Directory.Data,
      offset: 0,
      length: size,
    });
    let buffer: ArrayBuffer;
    if (result.data instanceof Blob) {
      buffer = await result.data.arrayBuffer();
    } else {
      buffer = base64ToArrayBuffer(result.data);
    }
    if (size === MAX_METADATA_BYTES) return buffer;
    try {
      const tags = await parseBuffer(new Uint8Array(buffer), undefined, { duration: false });
      if (tags && tags.common && (tags.common.title || tags.common.artist || tags.common.album)) {
        return buffer;
      }
    } catch (e) {
      return buffer;
    }
  }
  throw new Error("metadata read failed");
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

export async function parseAudioFromBuffer(buffer: ArrayBuffer): Promise<any> {
  return parseBuffer(new Uint8Array(buffer), undefined, { duration: true });
}

export async function parseAudioFromBlob(blob: Blob): Promise<any> {
  return parseBlob(blob, { duration: true });
}