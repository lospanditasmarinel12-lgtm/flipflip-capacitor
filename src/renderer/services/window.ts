export function supportsFullscreen(): boolean {
  return typeof document.documentElement.requestFullscreen === "function";
}

export function isFullscreen(): boolean {
  return !!document.fullscreenElement;
}

export async function requestFullscreen(): Promise<void> {
  if (!document.fullscreenElement && supportsFullscreen()) {
    try {
      await document.documentElement.requestFullscreen();
    } catch (e) {
      console.error("requestFullscreen failed", e);
    }
  }
}

export async function exitFullscreen(): Promise<void> {
  if (document.fullscreenElement) {
    try {
      await document.exitFullscreen();
    } catch (e) {
      console.error("exitFullscreen failed", e);
    }
  }
}

export async function toggleFullscreen(): Promise<boolean> {
  if (isFullscreen()) {
    await exitFullscreen();
    return false;
  }
  await requestFullscreen();
  return true;
}

export function setTitle(title: string): void {
  document.title = title;
}