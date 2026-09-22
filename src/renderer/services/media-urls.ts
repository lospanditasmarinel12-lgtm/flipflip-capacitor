import { isCapacitor } from "./platform";

const REMOTE_PATTERN = /^(https?|blob|data|captured|cordova):|^\w+:\/\//i;

/**
 * Returns true when `path` is already a scheme-URL (http, blob, capacitor://,
 * etc.) that the WebView can load directly as a media src.
 */
export function isRemoteOrSchemeUrl(path: string): boolean {
  if (path == null) return false;
  if (REMOTE_PATTERN.test(path)) return true;
  return path.startsWith("capacitor://") || path.startsWith("http://localhost/_capacitor_file_");
}

/**
 * Converts an app-sandbox relative path (e.g. `imported/foo.mp3`) into a
 * WebView-loadable src for use by <audio>/<video> elements and react-sound.
 *
 * - Capacitor native: resolves `Filesystem.getUri({path, directory: Directory.Data})`
 *   and applies `Capacitor.convertFileSrc`, mirroring the image pipeline
 *   (SourceScraper.loadLocalDirectoryCapacitor).
 * - Web / remote: returned unchanged.
 */
export async function toWebViewUrl(path: string): Promise<string> {
  if (!path) return path;
  if (isRemoteOrSchemeUrl(path)) return path;
  if (!isCapacitor()) return path;

  try {
    const { Filesystem, Directory } = await import("@capacitor/filesystem");
    const uri = await Filesystem.getUri({ path, directory: Directory.Data });
    const { Capacitor } = await import("@capacitor/core");
    const conv = Capacitor.convertFileSrc(uri.uri);
    return conv;
  } catch (e) {
    console.warn("[media-urls] getUri failed for", path, "falling back to direct conversion, error:", e);
    try {
      const { Capacitor } = await import("@capacitor/core");
      return Capacitor.convertFileSrc(path);
    } catch (err) {
      console.warn("[media-urls] direct conversion failed for", path, err);
      return path;
    }
  }
}

/**
 * Resolves a sandbox-relative media path to a src usable by <video>/<audio>.
 * On Android/Capacitor the WebView media stack cannot reliably range-read
 * moov-at-end containers through Capacitor's local interceptor (the EOF tail
 * read fails with net::ERR_FAILED / PIPELINE_ERROR_READ), so audio/video was
 * served from the native loopback HTTP server instead. Images and non-capacitor
 * platforms keep using the plain converted src.
 *
 * EXPERIMENT: LOOPBACK_ENABLED=false routes previews back through the original
 * convertFileSrc form (https://localhost/_capacitor_file_...) now that Media3
 * emits proper moov-at-start fMP4. Flip to true to restore the loopback path.
 */
const LOOPBACK_ENABLED = false;

export async function toPlaybackUrl(path: string): Promise<string> {
  if (!path) return path;
  if (isRemoteOrSchemeUrl(path)) return path;
  if (isCapacitor() && LOOPBACK_ENABLED) {
    try {
      const { Capacitor } = await import("@capacitor/core");
      if (Capacitor.getPlatform() === "android") {
        const { FlipTranscoder } = await import("flipflip-transcoder");
        const { url } = await FlipTranscoder.resolveMediaUrl({ path });
        if (url) return url;
      }
    } catch (e) {
      console.warn("[media-urls] media server resolution failed for", path, "falling back to webview url:", e);
    }
  }
  return toWebViewUrl(path);
}