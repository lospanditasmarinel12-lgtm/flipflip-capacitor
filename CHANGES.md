# Change Log — FlipFlip+ Mobile

Scope: full working tree vs base commit `c7a2100` (*FlipFlip+ 6.0.0 (mobile) — Capacitor iOS/Android port of ififfy/flipflip v3.2.2*).
Date: 2026-09-22.

Source-only diff (**43 files**, +3,519 / −931). The huge line counts in the overall `git diff` come from generated bundles under `android/app/src/main/assets/public/` (e.g. `renderer.bundle.js`) and are excluded from this summary.

---

## 1. Local media preview over the WebView (playing local/Optimized files)

**Files:**
- `node_modules/@capacitor/android/capacitor/.../WebViewLocalServer.java` (patched in place)
- `patches/capacitor-android/WebViewLocalServer.java` (versioned copy so `cap sync`/reinstall keeps the fix)

**Problem:** local files (`/_capacitor_file_/…`) were served with `206 + Content-Range`, which makes Chromium's media loader treat the resource as *seekable* and switch to range-following fetches (`bytes=N-` continuation reads). Those continuation reads failed on the WebView interceptor (unreliable byte-range bodies, tail reads `net::ERR_FAILED`), so:
- transformed fMP4 clips stopped after the first fragment (~4 s previews),
- raw moov-at-end MP4s exposed no metadata at all.

**Fix:** every request for a real local file (with or without `Range`) is now answered as a single **`200` full-body progressive stream** with `Content-Length` (and `Accept-Ranges: none`). Chromium streams one request to EOF, no range requests, no continuation failures.

**Verified on device (Samsung S9+ / Android WebView Chrome 151):**
- fMP4 `REBOOT_LOOP__sdr1080.mp4` — plays the full 18.45 s (was 3.5 s), no errors.
- raw moov-at-end `VID_20250411_…941.mp4` — plays to the end (8.82 s, `ended`), no errors.
- Works for images, original files and transcoded/Optimized files alike; no loopback media server required.

Trade-off: with `Accept-Ranges: none`, a seek beyond buffered data rebuffers from scratch instead of issuing a byte-range fetch (fine for previews).

---

## 2. Scene playback — no more white flash between media

**File:** `src/renderer/components/player/LiveShowPlayer.tsx`

**Problem:** on transition, `advance()` set `current: null` immediately and only committed the next media after it had loaded and (for video) reached `playing`. The gap rendered an empty transparent div over the white Android window (`AppCompat.Light` theme) → a white flash between every image/video, longer for videos (never preloaded; decode latency on the old Snapdragon 845).

**Fix:** `advance()` no longer nulls `current`. The previously committed media stays on screen until the next one commits; the same mounted `ImageView` swaps the DOM child via `componentDidUpdate` → `_applyImage` (the new media is already decoded/playing at commit). Transitions become an opaque swap — no white frame on any transition, and slower video decode is hidden behind the still-shown previous frame.

---

## 3. Drag-and-drop code removal (all lists)

**Files:** `src/renderer/components/library/SourceList.tsx`, `AudioSourceList.tsx`, `ScriptSourceList.tsx`, `TagManager.tsx`, `src/renderer/components/ScenePicker.tsx`, `src/renderer/components/sceneDetail/PiwigoDialog.tsx`, `src/renderer/components/configGroups/ScriptPlaylist.tsx`, `src/renderer/components/player/AudioPlaylist.tsx`, `src/declarations.d.ts`

- Removed `react-sortable-hoc` and `react-sortablejs` usage; lists/playlists/tag rows render as plain containers (with a `StyledSortable`-style wrapper that ignores sort props where the original API was kept).
- `VirtualList` in the three list components converted from a prototype method to an arrow class field — this fixes a `TypeError: Cannot read properties of undefined (reading 'props')` crash: React invoked the old bound method as a function component, so `this` was undefined.
- Dropped the now-unused `react-sortable-hoc` / `react-sortablejs` declaration stubs.

---

## 4. List item UX — icon-click preview + Play menu

**Files:** `src/renderer/components/library/SourceListItem.tsx`, `AudioSourceListItem.tsx`, `src/renderer/components/player/AudioPlaylist.tsx`

- Adding a new "Play" item to the ⋮ menu of source/audio list rows, before "Preview".
- Clicking the item's icon now opens the media preview instead of the old behavior:
  - `SourceListItem`: icon-click → `openPreview()` for previewable URLs (keeps legacy play fallback otherwise).
  - `AudioSourceListItem`: icon-click → `savePosition(); openPreview()`.
  - `AudioPlaylist`: icon-click → preview of the clicked track; new `play(trackIndex)` method for the menu.
- Tooltips updated (e.g. "Click: Preview").

---

## 5. Media optimization / transcoding pipeline

**Files:**
- `plugins/flipflip-transcoder/android/.../FlipTranscoderPlugin.java` (+1,644 lines) and new `MediaOptimizationService.java`
- `plugins/flipflip-transcoder/ios/Sources/.../FlipTranscoderPlugin.swift`
- `plugins/flipflip-transcoder/index.d.ts`, `web.js`
- `src/renderer/components/configGroups/MediaOptimizationCard.tsx`
- `src/renderer/services/optimize-library.ts`, `convert.ts`, `convert-state.ts`
- `src/renderer/services/media-urls.ts` (new `LOOPBACK_ENABLED` path + media serving URLs)
- `src/renderer/components/ConversionDialog.tsx`

The transcoder plugin (Android + iOS) encodes library media into Optimized (fMP4, portrait/landscape sd1080 etc.) files; includes progress/state reporting, file validation, and a durable optimization service. The renderer side drives the optimization card, per-source settings, conversion state and the conversion dialog.

---

## 6. Audio, meta and misc UI

**Files:** `src/renderer/components/library/AudioLibrary.tsx`, `AudioEdit.tsx`, `AudioOptions.tsx`, `src/renderer/services/audio-metadata.ts`, `src/renderer/components/Meta.tsx`, `src/renderer/data/actions.ts`, `src/renderer/services/window.ts`, `src/renderer/components/player/GridPlayer.tsx`

Audio loading/metadata handling refinements, meta tag/action plumbing and small player/grid adjustments to support the mobile flow.

---

## 7. File import plumbing

**Files:** `src/renderer/services/filepicker.ts`, `filepicker-native.ts`, `filepicker-shared.ts`

File picker integration wiring (native `@capawesome/capacitor-file-picker` path vs web fallback) for importing sources on mobile.

---

## 8. Plugin/config plumbing (Android + iOS)

**Files:**
- `capacitor.config.ts`, `android/app/src/main/AndroidManifest.xml`, `android/app/src/main/assets/capacitor.config.json`
- New `android/app/src/main/res/xml/network_security_config.xml` (cleartext/localhost policy)
- New `plugins/flipflip-transcoder/android/src/main/AndroidManifest.xml`
- `ios/App/App/AppDelegate.swift`, `Info.plist`, `capacitor.config.json`, `project.pbxproj`
- `plugins/flipflip-audio-player/ios/.../FlipAudioPlayerPlugin.swift`

App runtime configuration, network security policy and native plugin registration for both platforms.

---

## Appendix A — source-only diff stat

```
 git diff --stat -- . :(exclude)android/app/src/main/assets/public/** :(exclude)*xcschememanagement.plist

 android/app/src/main/AndroidManifest.xml              |    3 +-
 android/app/src/main/assets/capacitor.config.json     |    3 +
 capacitor.config.ts                                   |    8 +
 ios/App/App.xcodeproj/project.pbxproj                 |   73 +-
 ios/App/App/AppDelegate.swift                         |   52 +-
 ios/App/App/Info.plist                                |    5 +
 ios/App/App/capacitor.config.json                     |    3 +
 plugins/flipflip-audio-player/ios/FlipAudioPlayerPlugin.swift |   32 +
 plugins/flipflip-transcoder/android/build.gradle      |    3 +
 plugins/flipflip-transcoder/android/FlipTranscoderPlugin.java | 1644 ++++++-----
 plugins/flipflip-transcoder/index.d.ts                |   55 +-
 plugins/flipflip-transcoder/ios/FlipTranscoderPlugin.swift | 1287 ++++----
 plugins/flipflip-transcoder/web.js                    |   17 +-
 src/declarations.d.ts                                 |    2 -
 src/renderer/components/ConversionDialog.tsx          |   86 +-
 src/renderer/components/Meta.tsx                      |   37 +-
 src/renderer/components/ScenePicker.tsx               |   15 +-
 src/renderer/components/configGroups/MediaOptimizationCard.tsx |   23 +-
 src/renderer/components/configGroups/ScriptPlaylist.tsx |   17 -
 src/renderer/components/library/AudioEdit.tsx         |    2 +-
 src/renderer/components/library/AudioLibrary.tsx      |  118 +-
 src/renderer/components/library/AudioOptions.tsx      |    2 +-
 src/renderer/components/library/AudioSourceList.tsx   |   42 +-
 src/renderer/components/library/AudioSourceListItem.tsx |   68 +-
 src/renderer/components/library/MediaPreviewDialog.tsx |   31 +-
 src/renderer/components/library/ScriptSourceList.tsx  |   31 +-
 src/renderer/components/library/SourceList.tsx        |   37 +-
 src/renderer/components/library/SourceListItem.tsx    |   69 +-
 src/renderer/components/library/TagManager.tsx         |    7 +-
 src/renderer/components/player/AudioPlaylist.tsx       |   43 +-
 src/renderer/components/player/GridPlayer.tsx          |    2 +-
 src/renderer/components/player/LiveShowPlayer.tsx      |    2 +-
 src/renderer/components/sceneDetail/PiwigoDialog.tsx   |   17 +-
 src/renderer/data/actions.ts                           |   15 +-
 src/renderer/services/audio-metadata.ts                |   23 +-
 src/renderer/services/convert-state.ts                 |   89 +-
 src/renderer/services/convert.ts                       |  120 +-
 src/renderer/services/filepicker-native.ts            |   12 +-
 src/renderer/services/filepicker-shared.ts            |   37 +-
 src/renderer/services/filepicker.ts                   |   50 +-
 src/renderer/services/media-urls.ts                   |   32 +
 src/renderer/services/optimize-library.ts             |  226 ++-
 src/renderer/services/window.ts                       |   10 +
 43 files changed, 3519 insertions(+), 931 deletions(-)
```

Not shown in `git diff` (untracked):
- `patches/capacitor-android/WebViewLocalServer.java` (Section 1 fix)
- `plugins/flipflip-transcoder/android/src/main/java/.../MediaOptimizationService.java`
- `plugins/flipflip-transcoder/android/src/main/AndroidManifest.xml`
- `android/app/src/main/res/xml/network_security_config.xml`

---

## Appendix B — inspecting the diff

```sh
# tracked source changes (excludes generated bundles + Xcode scheme metadata)
git diff -- . ':(exclude)android/app/src/main/assets/public/**' ':(exclude)*xcschememanagement.plist'

# per-file line stats
git diff --stat -- . ':(exclude)android/app/src/main/assets/public/**' ':(exclude)*xcschememanagement.plist'
```