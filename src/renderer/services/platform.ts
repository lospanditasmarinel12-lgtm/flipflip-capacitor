import { Capacitor } from "@capacitor/core";
import { setFilesystem } from "./filesystem";
import { capacitorFilesystem } from "./adapters/capacitor-filesystem";
import { initSafeArea } from "./safe-area";

export function isCapacitor(): boolean {
  return typeof (window as any).Capacitor !== "undefined";
}

export function getPlatform(): string {
  return Capacitor.getPlatform();
}

export function isNativePlatform(): boolean {
  return Capacitor.isNativePlatform();
}

export function initPlatform() {
  (Capacitor as any).isLoggingEnabled = false;
  setFilesystem(capacitorFilesystem);
  initSafeArea();
}