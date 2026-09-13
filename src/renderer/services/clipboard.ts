import { Filesystem, Directory } from "@capacitor/filesystem";

export async function copyText(text: string): Promise<void> {
  if (!text) return;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    await navigator.clipboard.writeText(text);
  } else {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    try {
      document.execCommand("copy");
    } catch (e) {
      console.error(e);
    }
    document.body.removeChild(textarea);
  }
}

export async function copyBlob(blob: Blob): Promise<void> {
  const ClipboardItemCtor = (window as any).ClipboardItem;
  if (!navigator.clipboard || !navigator.clipboard.write || !ClipboardItemCtor) {
    throw new Error("Image clipboard support is not available in this WebView");
  }
  const type = blob.type || "image/png";
  const item = new ClipboardItemCtor({ [type]: blob });
  await navigator.clipboard.write([item]);
}

export async function copyBase64(base64: string, mime: string): Promise<void> {
  await copyBlob(base64ToBlob(base64, mime));
}

export async function copyBuffer(buffer: ArrayBuffer, mime: string): Promise<void> {
  await copyBlob(new Blob([buffer], { type: mime }));
}

/**
 * Copies the given file to the clipboard. Image files are copied as image
 * data (when the Clipboard API supports it), everything else as text,
 * matching Electron's clipboard.writeImage behaviour.
 */
export async function copyPath(path: string): Promise<void> {
  const imageMime = imageMimeForPath(path);
  if (imageMime) {
    try {
      const result = await Filesystem.readFile({ path, directory: Directory.Data });
      if (typeof result.data === "string") {
        await copyBase64(result.data, imageMime);
      } else {
        await copyBlob(result.data);
      }
      return;
    } catch (e) {
      console.error(e);
    }
  }
  await copyText(path);
}

function base64ToBlob(base64: string, mime: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mime });
}

function imageMimeForPath(p: string): string | null {
  const lower = p.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".bmp")) return "image/bmp";
  return null;
}