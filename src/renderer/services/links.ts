import { Browser } from "@capacitor/browser";
import { Capacitor } from "@capacitor/core";
import { Filesystem, Directory } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";

export async function openExternal(url: string): Promise<void> {
  if (!url) return;
  if (Capacitor.isNativePlatform()) {
    try {
      await Browser.open({ url });
      return;
    } catch (e) {
      console.error("Browser.open failed", e);
    }
  }
  const win = window.open(url, "_blank", "noopener,noreferrer");
  if (win == null) {
    window.location.href = url;
  }
}

/**
 * Launches an external app to view the given sandboxed file.
 * The mobile translation of Electron's "reveal in folder" / "open path":
 * share the file so the user can open it with another app.
 */
export async function openFile(path: string, displayName?: string): Promise<void> {
  try {
    const result = await Filesystem.getUri({ path, directory: Directory.Data });
    await Share.share({
      title: displayName || path.split("/").pop() || "File",
      files: [result.uri],
    });
    return;
  } catch (e) {
    console.error("openFile failed", e);
  }
}

export async function revealFile(path: string, displayName?: string): Promise<void> {
  await openFile(path, displayName);
}