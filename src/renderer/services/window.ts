// On native (Capacitor) the WebView already fills the screen, and the browser
// Fullscreen API drags the WebView into a separate system overlay (with its own
// exit control and status-bar/safe-area toggling) on some platforms — so it is
// disabled entirely there. Desktop/Electron keeps the DOM fullscreen behavior.
import { isCapacitor } from "./platform";

export function supportsFullscreen(): boolean {
  if (isCapacitor()) return false;
  return typeof document.documentElement.requestFullscreen === "function";
}

export function isFullscreen(): boolean {
  if (isCapacitor()) return false;
  return !!document.fullscreenElement;
}

export async function requestFullscreen(): Promise<void> {
  if (isCapacitor()) return;
  if (!document.fullscreenElement && supportsFullscreen()) {
    try {
      await document.documentElement.requestFullscreen();
    } catch (e) {
      console.error("requestFullscreen failed", e);
    }
  }
}

export async function exitFullscreen(): Promise<void> {
  if (isCapacitor()) return;
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