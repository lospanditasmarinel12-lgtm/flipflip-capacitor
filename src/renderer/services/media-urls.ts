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