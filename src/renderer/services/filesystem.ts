export interface FileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
}

export interface FileSystem {
  readDirectory(path: string): Promise<FileEntry[]>;
  readFile(path: string): Promise<ArrayBuffer>;
  readFileText(path: string): Promise<string>;
  fileExists(path: string): Promise<boolean>;
  makeDirectory(path: string): Promise<void>;
  writeFile(path: string, data: ArrayBuffer | string): Promise<void>;
  deleteFile(path: string): Promise<void>;
  deleteDirectory(path: string): Promise<void>;
  getCachePath(url: string): string;
  getDirectorySize(path: string): Promise<number>;
  stat(path: string): Promise<{size: number, isDirectory: boolean, isFile: boolean}>;
}

let _filesystem: FileSystem | null = null;

export function setFilesystem(fs: FileSystem) {
  _filesystem = fs;
}

export function getFilesystem(): FileSystem {
  if (!_filesystem) {
    throw new Error("Filesystem not initialized. Call setFilesystem() first.");
  }
  return _filesystem;
}
