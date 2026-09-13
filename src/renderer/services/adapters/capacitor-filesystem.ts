import { Filesystem, Directory, Encoding } from "@capacitor/filesystem";
import { FileEntry, FileSystem } from "../filesystem";
import { rememberPath, forgetPath, rememberDirectory } from "../local-paths";

function fileExists(path: string): Promise<boolean> {
  return Filesystem.stat({ path, directory: Directory.Data }).then(
    () => true,
    () => false
  );
}

function normalizePath(p: string): string {
  if (p == null) return "";
  let result = p.replace(/\\/g, "/").replace(/^\.\/+/, "");
  if (result === ".") result = "";
  return result;
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunkSize)));
  }
  return btoa(binary);
}

async function readAsArrayBuffer(path: string): Promise<ArrayBuffer> {
  const result = await Filesystem.readFile({ path: normalizePath(path), directory: Directory.Data });
  if (result.data instanceof Blob) {
    return await result.data.arrayBuffer();
  }
  return base64ToArrayBuffer(result.data);
}

async function readAsText(path: string): Promise<string> {
  const result = await Filesystem.readFile({
    path: normalizePath(path),
    directory: Directory.Data,
    encoding: Encoding.UTF8,
  });
  if (typeof result.data === "string") return result.data;
  return await result.data.text();
}

async function writeData(path: string, data: string | ArrayBuffer): Promise<void> {
  if (typeof data === "string") {
    await Filesystem.writeFile({
      path: normalizePath(path),
      data,
      directory: Directory.Data,
      encoding: Encoding.UTF8,
      recursive: true,
    });
  } else {
    await Filesystem.writeFile({
      path: normalizePath(path),
      data: arrayBufferToBase64(data),
      directory: Directory.Data,
      recursive: true,
    });
  }
  rememberPath(normalizePath(path));
}

async function directorySize(dir: string): Promise<number> {
  const result = await Filesystem.readdir({ path: normalizePath(dir), directory: Directory.Data });
  let total = 0;
  for (const file of result.files) {
    if (file.type === "directory") {
      total += await directorySize(dir + "/" + file.name);
    } else {
      total += file.size || 0;
    }
  }
  return total;
}

function joinPath(dir: string, name: string): string {
  const base = normalizePath(dir);
  return base === "" ? name : base + "/" + name;
}

export const capacitorFilesystem: FileSystem = {
  readDirectory: async (dir: string): Promise<FileEntry[]> => {
    const result = await Filesystem.readdir({ path: normalizePath(dir), directory: Directory.Data });
    return result.files.map((f) => ({
      name: f.name,
      path: joinPath(dir, f.name),
      isDirectory: f.type === "directory",
      size: f.size || 0,
    }));
  },

  readFile: async (path: string): Promise<ArrayBuffer> => {
    return readAsArrayBuffer(path);
  },

  readFileText: async (path: string): Promise<string> => {
    return readAsText(path);
  },

  fileExists: async (path: string): Promise<boolean> => {
    return fileExists(path);
  },

  makeDirectory: async (dirPath: string): Promise<void> => {
    await Filesystem.mkdir({
      path: normalizePath(dirPath),
      directory: Directory.Data,
      recursive: true,
    });
    rememberDirectory(normalizePath(dirPath));
  },

  writeFile: async (path: string, data: string | ArrayBuffer): Promise<void> => {
    await writeData(path, data);
  },

  deleteFile: async (path: string): Promise<void> => {
    await Filesystem.deleteFile({ path: normalizePath(path), directory: Directory.Data });
    forgetPath(normalizePath(path));
  },

  deleteDirectory: async (dirPath: string): Promise<void> => {
    await Filesystem.rmdir({
      path: normalizePath(dirPath),
      directory: Directory.Data,
      recursive: true,
    });
    forgetPath(normalizePath(dirPath));
  },

  getCachePath: (url: string): string => {
    if (!url) return "flipflip/ImageCache";
    const hash = hashUrl(url);
    return "flipflip/ImageCache/" + hash;
  },

  getDirectorySize: async (dirPath: string): Promise<number> => {
    try {
      return await directorySize(dirPath);
    } catch (e) {
      return 0;
    }
  },

  stat: async (itemPath: string): Promise<{ size: number, isDirectory: boolean, isFile: boolean }> => {
    const result = await Filesystem.stat({ path: normalizePath(itemPath), directory: Directory.Data });
    return {
      size: result.size || 0,
      isDirectory: result.type === "directory",
      isFile: result.type !== "directory",
    };
  },
};

function hashUrl(url: string): string {
  let hash = 0;
  for (let i = 0; i < url.length; i++) {
    hash = ((hash << 5) - hash + url.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}