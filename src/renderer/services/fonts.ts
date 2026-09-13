/**
 * Enumerates installable fonts for the caption / watermark pickers.
 *
 * Uses the Local Font Access API when the WebView exposes it
 * (Chromium-based browsers and Capacitor Android). iOS WKWebView has no
 * font enumeration API, so a curated cross-platform safe list is returned
 * there; the picker stays fully functional.
 */
const FALLBACK_FONTS = [
  "sans-serif",
  "serif",
  "monospace",
  "Arial",
  "Helvetica",
  "Georgia",
  "Times New Roman",
  "Courier New",
  "Verdana",
  "Trebuchet MS",
  "Impact",
  "Comic Sans MS",
  "Tahoma",
  "Palatino",
  "Garamond",
  "Bookman",
  "Avant Garde",
  "Andale Mono",
  "Arial Black",
  "Arial Narrow",
];

function stripQuotes(name: string): string {
  if (name == null) return "";
  return name.replace(/^"|"$/g, "");
}

export async function getFonts(): Promise<string[]> {
  const queryLocalFonts = (window as any).queryLocalFonts;
  if (queryLocalFonts) {
    try {
      const fonts = await queryLocalFonts();
      const names = new Set<string>();
      for (const font of fonts) {
        if (font && font.family) names.add(stripQuotes(font.family));
        if (font && font.fullName) names.add(stripQuotes(font.fullName));
      }
      if (names.size > 0) {
        return Array.from(names).sort();
      }
    } catch (e) {
      console.error("queryLocalFonts failed", e);
    }
  }
  return FALLBACK_FONTS.slice();
}