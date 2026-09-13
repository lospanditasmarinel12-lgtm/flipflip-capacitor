export async function clearAppCache(): Promise<void> {
  if (window.caches) {
    try {
      const keys = await window.caches.keys();
      await Promise.all(keys.map((key) => window.caches.delete(key)));
    } catch (e) {
      console.error("clearAppCache failed", e);
    }
  }
}