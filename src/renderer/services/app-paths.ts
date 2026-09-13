/**
 * Application save paths inside the Capacitor sandbox (Directory.Data).
 *
 * Replaces the old Electron-derived `appData/flipflip` location. Paths are
 * relative to the app's data directory, exactly what the Capacitor Filesystem
 * plugin expects when combined with `directory: Directory.Data`.
 */
export const saveDir = "flipflip";
export const savePath = "flipflip/data.json";