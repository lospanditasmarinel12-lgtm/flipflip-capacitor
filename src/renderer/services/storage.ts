import { getFilesystem } from "./filesystem";
import { savePath } from "./app-paths";

export async function loadAppState(): Promise<any | null> {
  const fs = getFilesystem();
  try {
    const text = await fs.readFileText(savePath);
    return JSON.parse(text);
  } catch (e) {
    return null;
  }
}

export async function appStateExists(): Promise<boolean> {
  const fs = getFilesystem();
  return fs.fileExists(savePath);
}

export async function archiveSaveFile(): Promise<void> {
  const fs = getFilesystem();
  try {
    const text = await fs.readFileText(savePath);
    await fs.writeFile(savePath + "." + Date.now(), text);
  } catch (e) {}
}

export async function writeAppState(state: any): Promise<void> {
  const fs = getFilesystem();
  await fs.writeFile(savePath, JSON.stringify(state));
}

export async function deleteAppState(): Promise<void> {
  const fs = getFilesystem();
  try {
    await fs.deleteFile(savePath);
  } catch (e) {}
}