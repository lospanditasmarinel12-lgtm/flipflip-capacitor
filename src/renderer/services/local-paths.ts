/**
 * A lightweight in-memory index of every path available inside the app's
 * sandboxed data directory (Directory.Data).
 *
 * The browser / WebView has no synchronous filesystem API, but a number of
 * existing render paths call `existsSync` synchronously to decide UI state
 * (offline badges, "reveal file" hints, cache hits). This index provides a
 * real, accurate answer for everything the app itself has created or imported,
 * which is the complete set of files a mobile app can legitimately touch.
 * It is populated once at startup and kept in sync by the filesystem adapter.
 */
import { getFilesystem } from "./filesystem";
import { FileEntry } from "./filesystem";

const known = new Set<string>();
let built = false;
let building: Promise<void> | null = null;

function norm(p: string): string {
  if (p == null) return "";
  return p.replace(/\\/g, "/").replace(/^\.\/+/, "").replace(/^\/+/, "");
}

export function isPathIndexReady(): boolean {
  return built;
}

export function buildLocalPathIndex(): Promise<void> {
  if (built) return Promise.resolve();
  if (building) return building;
  building = (async () => {
    const fs = getFilesystem();
    await walk(fs, "");
    built = true;
  })();
  return building;
}

async function walk(fs: any, dir: string): Promise<void> {
  let entries: FileEntry[] = [];
  try {
    entries = await fs.readDirectory(dir === "" ? "." : dir);
  } catch (e) {
    return;
  }
  for (const entry of entries) {
    const full = dir === "" ? entry.name : joinDirs(dir, entry.name);
    known.add(norm(full));
    if (entry.isDirectory) {
      await walk(fs, full);
    }
  }
}

function joinDirs(dir: string, name: string): string {
  return dir === "" ? name : dir + "/" + name;
}

export function syncPathExists(p: string): boolean {
  return known.has(norm(p));
}

export function rememberPath(p: string): void {
  if (p != null) known.add(norm(p));
}

export function forgetPath(p: string): void {
  const key = norm(p);
  for (const entry of Array.from(known)) {
    if (entry === key || entry.startsWith(key + "/")) {
      known.delete(entry);
    }
  }
}

export function rememberDirectory(p: string): void {
  rememberPath(p);
}