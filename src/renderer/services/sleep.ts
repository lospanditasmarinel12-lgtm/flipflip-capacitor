type WakeLockSentinel = { release(): Promise<void> };

let _sentinel: WakeLockSentinel | null = null;

export async function preventSleep(): Promise<boolean> {
  const wakeLock = (navigator as any).wakeLock;
  if (!wakeLock || !wakeLock.request) return false;
  try {
    if (document.visibilityState === "visible") {
      _sentinel = (await wakeLock.request("screen")) as WakeLockSentinel;
      return true;
    }
  } catch (e) {
    console.error("Wake Lock request failed", e);
  }
  return false;
}

export async function allowSleep(): Promise<void> {
  try {
    if (_sentinel) {
      await _sentinel.release();
    }
  } catch (e) {
    console.error("Wake Lock release failed", e);
  }
  _sentinel = null;
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && _sentinel) {
    preventSleep();
  }
});