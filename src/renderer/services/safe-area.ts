import { Capacitor } from "@capacitor/core";
import { SafeArea, SafeAreaInsets } from "capacitor-plugin-safe-area";

function applyInsets(insets: SafeAreaInsets["insets"]) {
  for (const [key, value] of Object.entries(insets)) {
    document.documentElement.style.setProperty(
      `--safe-area-inset-${key}`,
      `${value}px`,
    );
  }
}

export function initSafeArea() {
  if (!Capacitor.isNativePlatform()) {
    return;
  }
  SafeArea.getSafeAreaInsets().then(({ insets }) => applyInsets(insets));
  SafeArea.addListener("safeAreaChanged", ({ insets }) => applyInsets(insets));
}