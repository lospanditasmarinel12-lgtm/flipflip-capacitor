import * as React from 'react';
import { produce } from "immer";

import {
  Alert,
  Box,
  createTheme,
  CssBaseline,
  Dialog,
  DialogContent,
  DialogContentText,
  GlobalStyles,
  Slide,
  Snackbar,
} from "@mui/material";
import { StyledEngineProvider, ThemeProvider } from '@mui/material/styles';

import {SP} from "../data/const";
import {getCachePath} from "../data/utils";
import * as actions from '../data/actions';
import ErrorBoundary from "./ErrorBoundary";
import AppStorage from '../data/AppStorage';
import ScenePicker from './ScenePicker';
import ConfigForm from './config/ConfigForm';
import Library from './library/Library';
import TagManager from "./library/TagManager";
import GridSetup from "./config/GridSetup";
import VideoClipper from "./config/VideoClipper";
import Player from './player/Player';
import SceneDetail from './sceneDetail/SceneDetail';
import Tutorial from "./Tutorial";
import AudioLibrary from "./library/AudioLibrary";
import CaptionScriptor from "./sceneDetail/CaptionScriptor";
import ScriptLibrary from "./library/ScriptLibrary";
import { useStore } from "../stores/flipflipStore";
import { restoreAppStateIfNeeded } from "../services/filepicker";
import { isCapacitor } from "../services/platform";
import { initLogging, applyLogSettings, isLogEnabled } from "../data/logging";
import { SplashScreen } from "@capacitor/splash-screen";
import { MediaBudget } from "../data/MediaBudget";
import { getMemoryGovernor } from "../data/MemoryMonitor";
import initMemoryDebug from "../data/MemoryDebug";
import { computeDisplayAutoConfig } from "../data/AutoConfig";
import { getSystemCapabilities } from "../services/system-capabilities";
import { recoverInterruptedOptimization, reconcileMissingReferences } from "../services/optimize-library";
import { buildLocalPathIndex } from "../services/local-paths";

const appStorage = new AppStorage();

function TransitionUp(props: any) {
  return <Slide {...props} direction="up" />;
}

export default class Meta extends React.Component {
  readonly state = appStorage.initialState;
  _queueSave = false;
  _lastSave: Date = null;
  private _prevState: any = null;
  private _unsub: (() => void) | null = null;

  _operationalInit = false;

  componentDidMount() {
    // Safety: never let the (launchAutoHide: false) splash stick. Hide it at
    // the latest after a few seconds even if appStorage init stalls.
    setTimeout(() => { try { SplashScreen.hide(); } catch (e) {} }, 4000);
    appStorage.initialize().then((initial) => {
      useStore.setState(initial);
      // A picker launch snapshots the live store to localStorage (filepicker.ts
      // saveAppState), and launching the OS picker can reload the whole WebView
      // faster than the debounced disk save. The snapshot is fresher than the
      // disk data.json, so apply it AFTER the (stale) disk load rather than
      // before it — otherwise the disk state clobbers the restore.
      if (isCapacitor()) {
        const savedState = restoreAppStateIfNeeded();
        if (savedState) {
          useStore.setState(savedState);
        }
      }
      this.forceUpdate();
      this.initOperationalFeatures();
      // If a previous library-optimization sweep was killed mid-run, re-apply
      // the from->to rewrites it finished so references keep pointing at the
      // optimized copies (recovery then deletes the state file itself).
      recoverInterruptedOptimization().catch((e) =>
        console.warn("[FlipFlip] recovery skipped:", e));
      // The local path index powers syncPathExists() everywhere (offline badges,
      // source option hints). Build it so those answers reflect real disk state
      // immediately, then re-point any reference whose file is gone but has an
      // optimized copy sitting on disk.
      buildLocalPathIndex()
        .then(() => reconcileMissingReferences())
        .catch((e) => console.warn("[FlipFlip] path reconciliation skipped:", e));
      // The native splash is held (launchAutoHide: false) until the app is
      // actually ready — hide it now that the store is loaded and first paint
      // has been scheduled, so the black gap is covered by the launch screen.
      try { SplashScreen.hide(); } catch (e) {}
    });

    this._prevState = { ...useStore.getState() };
    this._unsub = useStore.subscribe(() => {
      (window as any).__ZUSTAND_STATE__ = useStore.getState();
      this.forceUpdate();
    });
    try { (window as any).soundManager?.setup({debugMode: false}); } catch(e) {}
    setInterval(this.queueSave.bind(this), 500);
  }

  componentWillUnmount() {
    if (this._unsub) this._unsub();
  }

  /**
   * Operational feature bootstrap (desktop parity, mobile-safe):
   * gated logging, memory governor, shared decoded-media budget, and display
   * auto-configuration from device capabilities.
   */
  initOperationalFeatures() {
    if (this._operationalInit) return;
    this._operationalInit = true;

    const state = useStore.getState();
    const config = state?.config;

    try {
      initLogging();
      if (config?.logSettings) {
        applyLogSettings(config.logSettings);
      }
    } catch (e) { console.error('Failed to init logging', e); }

    try {
      initMemoryDebug();
    } catch (e) { console.error('Failed to init memory debugger', e); }

    if (config?.displaySettings) {
      MediaBudget.setBudget(Math.max(4, config.displaySettings.maxInMemory * 2));
    }

    getSystemCapabilities().then((caps) => {
      try {
        const totalRAM_MB = caps.systemRAM_MB || 4096;
        getMemoryGovernor(totalRAM_MB).start();
        if (isLogEnabled('memory')) {
          console.log('[FFDEBUG] MemoryGovernor started (RAM:', totalRAM_MB, 'MB)');
        }
      } catch (e) { console.error('Failed to start memory governor', e); }

      if (config && config.displaySettings && config.displaySettings.autoConfigEnabled) {
        const auto = computeDisplayAutoConfig(
          caps.systemRAM_MB,
          caps.vramMB,
          caps.isDedicatedGPU,
          false,
          caps.isRemoteSession,
        );
        const nextConfig = produce(config, (draft: any) => {
          draft.displaySettings.maxInMemory = auto.maxInMemory;
          draft.displaySettings.maxInHistory = auto.maxInHistory;
          draft.displaySettings.maxLoadingAtOnce = auto.maxLoadingAtOnce;
          draft.displaySettings.maxDecodedImages = auto.maxDecodedImages;
          draft.caching.maxSize = auto.cacheMaxSizeMB;
        });
        useStore.setState({ config: nextConfig });
        MediaBudget.setBudget(Math.max(4, auto.maxInMemory * 2));
        if (isLogEnabled('meta')) {
          console.log('[FlipFlip] Auto-config applied', auto);
        }
      }
    }).catch((e) => {
      console.warn('System capabilities unavailable, skipping auto-config', e);
      try {
        getMemoryGovernor(4096).start();
      } catch (e2) {}
    });
  }

  get storeState() { return useStore.getState(); }

  isRoute(kind: string): Boolean {
    return actions.isRoute(this.storeState, kind);
  }

  applyAction(fn: any, ...args: any[]) {
    const originalState = this.storeState as any;
    if (!originalState) return;
    const nextState = produce(originalState, (draft: any) => {
      (draft as any)._setState = (next: any) => useStore.setState(next);
      const result = fn(draft, ...args);
      if (result) {
        const keys = Object.keys(result);
        for (let i = 0; i < keys.length; i++) {
          const k = keys[i];
          if (result[k] !== (draft as any)[k]) {
            (draft as any)[k] = result[k];
          }
        }
      }
    });
    if ((window as any).logStateChanges) {
      console.log(nextState);
    }
    useStore.setState(nextState);
    (window as any).__ZUSTAND_STATE__ = useStore.getState();
  }

  progressAction(fn: any, ...args: any[]) {
    const getState = () => this.storeState;
    fn(getState, (next: any) => useStore.setState(next), ...args);
  }

  queueSave() {
    try {
      const state = this.storeState;
      // Persist quickly (imports, deletes, edits) so a WebView reload triggered
      // by opening the OS picker can't race the write away. 700ms is short
      // enough to settle bursts but still coalesces rapid-fire mutations.
      if (this._queueSave && (this._lastSave == null || new Date().getTime() - this._lastSave.getTime() > 700)) {
        appStorage.save(state);
        this._lastSave = new Date();
        this._queueSave = false;
      }
    } catch(e) {}
  }

  componentDidUpdate(prevProps: any, prevState: any) {
    const current = this.storeState;
    const prev = this._prevState;
    this._prevState = { ...current };

    if (prev.version !== current.version ||
      prev.config !== current.config ||
      prev.scenes !== current.scenes ||
      prev.sceneGroups !== current.sceneGroups ||
      prev.grids !== current.grids ||
      prev.library !== current.library ||
      prev.audios !== current.audios ||
      prev.scripts !== current.scripts ||
      prev.playlists !== current.playlists ||
      prev.tags !== current.tags ||
      prev.route !== current.route ||
      prev.specialMode !== current.specialMode ||
      prev.openTab !== current.openTab ||
      prev.displayedSources !== current.displayedSources ||
      prev.libraryYOffset !== current.libraryYOffset ||
      prev.libraryFilters !== current.libraryFilters ||
      prev.librarySelected !== current.librarySelected ||
      prev.audioOpenTab !== current.audioOpenTab ||
      prev.audioYOffset !== current.audioYOffset ||
      prev.audioFilters !== current.audioFilters ||
      prev.audioSelected !== current.audioSelected ||
      prev.scriptYOffset !== current.scriptYOffset ||
      prev.scriptFilters !== current.scriptFilters ||
      prev.scriptSelected !== current.scriptSelected ||
      prev.progressMode !== current.progressMode ||
      prev.progressTitle !== current.progressTitle ||
      prev.progressCurrent !== current.progressCurrent ||
      prev.progressTotal !== current.progressTotal ||
      prev.progressNext !== current.progressNext ||
      prev.systemMessage !== current.systemMessage ||
      prev.systemSnackOpen !== current.systemSnackOpen ||
      prev.systemSnack !== current.systemSnack ||
      prev.tutorial !== current.tutorial ||
      prev.theme !== current.theme) {
      this._queueSave = true;
    }
  }

  startScene(sceneName: string) {
    this.applyAction(actions.startFromScene, sceneName);
  }

  render() {
    const state = useStore.getState();
    const scene = actions.getActiveScene(state);
    const grid = actions.getActiveGrid(state);

    const a = (fn: any, ...args: any[]) => this.applyAction.bind(this, fn, ...args);
    const p = (fn: any) => this.progressAction.bind(this, fn);

    const theme = createTheme(state.theme);
    // @ts-ignore
    return (
      <StyledEngineProvider injectFirst>
        <ThemeProvider theme={theme}>
          <ErrorBoundary
            version={state.version}
            onRestore={a(actions.restoreFromBackup)}
            goBack={a(actions.goBack)}>
            <Box className="Meta">
              <CssBaseline />
              <GlobalStyles styles={(theme) => ({
                ':root': {
                  '--ff-bg': theme.palette.background.paper,
                  '--ff-text': theme.palette.text.primary,
                  '--ff-muted': theme.palette.text.secondary,
                  '--ff-border': theme.palette.divider,
                  '--ff-hover': theme.palette.action.hover,
                  '--ff-selected': theme.palette.action.selected,
                  '--ff-focus': theme.palette.primary.main,
                },
              })} />
              {state.route.length === 0 && (
                <ScenePicker
                  canGenerate={state.library.length >= 1}
                  canGrid={state.scenes.length > 0}
                  config={state.config}
                  grids={state.grids}
                  audioLibraryCount={state.audios.length}
                  scriptLibraryCount={state.scripts.length}
                  libraryCount={state.library.length}
                  openTab={state.openTab}
                  scenes={state.scenes}
                  sceneGroups={state.sceneGroups}
                  tutorial={state.tutorial}
                  version={state.version}
                  onAddGenerator={a(actions.addGenerator)}
                  onAddGrid={a(actions.addGrid)}
                  onAddGroup={a(actions.addSceneGroup)}
                  onAddScene={a(actions.addScene)}
                  onChangeTab={a(actions.changeScenePickerTab)}
                  onDeleteGroup={a(actions.deleteSceneGroup)}
                  onDeleteScenes={a(actions.deleteScenes)}
                  onImportScene={a(actions.importScene)}
                  onOpenConfig={a(actions.openConfig)}
                  onOpenAudioLibrary={a(actions.openAudios)}
                  onOpenScriptLibrary={a(actions.openScripts)}
                  onOpenCaptionScriptor={a(actions.openScriptor)}
                  onOpenLibrary={a(actions.openLibrary)}
                  onOpenScene={a(actions.goToScene)}
                  onOpenGrid={a(actions.goToGrid)}
                  onTutorial={a(actions.doneTutorial)}
                  onSort={a(actions.sortScene)}
                  onUpdateConfig={a(actions.updateConfig)}
                  onUpdateGroups={a(actions.replaceSceneGroups)}
                  onUpdateScenes={a(actions.replaceScenes)}
                  onUpdateGrids={a(actions.replaceGrids)}
                  startTutorial={a(actions.startTutorial)}
                  systemMessage={a(actions.systemMessage)}
                />
              )}

              {this.isRoute('scene') && (
                <SceneDetail
                  autoEdit={state.specialMode == SP.autoEdit}
                  allScenes={state.scenes}
                  allSceneGrids={state.grids}
                  config={state.config}
                  library={state.library}
                  scene={scene}
                  tags={state.tags}
                  tutorial={state.tutorial}
                  goBack={a(actions.goBack)}
                  onAddSource={a(actions.addSource)}
                  onAddTracks={a(actions.addTracks)}
                  onAddScript={a(actions.addScript)}
                  onClearBlacklist={a(actions.clearBlacklist)}
                  onClip={a(actions.clipVideo)}
                  onCloneScene={a(actions.cloneScene)}
                  onDelete={a(actions.deleteScene)}
                  onDownload={a(actions.downloadSource)}
                  onEditBlacklist={a(actions.editBlacklist)}
                  onExport={a(actions.exportScene)}
                  onGenerate={a(actions.generateScenes)}
                  onPlayScene={a(actions.playScene)}
                  onPlay={a(actions.playSceneFromLibrary)}
                  onPlayAudio={a(actions.playAudio)}
                  onPlayScript={a(actions.playScript)}
                  onResetScene={a(actions.resetScene)}
                  onSaveAsScene={a(actions.saveScene)}
                  onSort={a(actions.sortSources)}
                  onTutorial={a(actions.doneTutorial)}
                  onUpdateScene={a(actions.updateScene)}
                  systemMessage={a(actions.systemMessage)}
                />
              )}

              {this.isRoute('library') && (
                <Library
                  config={state.config}
                  filters={state.libraryFilters}
                  library={state.library}
                  progressCurrent={state.progressCurrent}
                  progressMode={state.progressMode}
                  progressTitle={state.progressTitle}
                  progressTotal={state.progressTotal}
                  selected={state.librarySelected}
                  specialMode={state.specialMode}
                  tags={state.tags}
                  tutorial={state.tutorial}
                  yOffset={state.libraryYOffset}
                  goBack={a(actions.goBack)}
                  onAddSource={a(actions.addSource)}
                  onBatchClip={a(actions.batchClip)}
                  onBatchTag={a(actions.batchTag)}
                  onClearBlacklist={a(actions.clearBlacklist)}
                  onClip={a(actions.clipVideo)}
                  onDownload={a(actions.downloadSource)}
                  onEditBlacklist={a(actions.editBlacklist)}
                  onExportLibrary={a(actions.exportLibrary)}
                  onImportFromLibrary={a(actions.importFromLibrary)}
                  onImportLibrary={a(actions.importLibrary, appStorage.backup.bind(appStorage, state))}
                  onManageTags={a(actions.manageTags)}
                  onMarkOffline={p(actions.markOffline)}
                  onPlay={a(actions.playSceneFromLibrary)}
                  onSort={a(actions.sortSources)}
                  onTutorial={a(actions.doneTutorial)}
                  onUpdateLibrary={a(actions.updateLibrary)}
                  onUpdateMode={a(actions.setMode)}
                  onUpdateVideoMetadata={p(actions.updateVideoMetadata)}
                  savePosition={a(actions.saveLibraryPosition)}
                  systemMessage={a(actions.systemMessage)}
                />
              )}

              {this.isRoute('audios') && (
                <AudioLibrary
                  cachePath={getCachePath(null, state.config)}
                  filters={state.audioFilters}
                  library={state.audios}
                  progressCurrent={state.progressCurrent}
                  progressMode={state.progressMode}
                  progressTitle={state.progressTitle}
                  progressTotal={state.progressTotal}
                  openTab={state.audioOpenTab}
                  playlists={state.playlists}
                  selected={state.audioSelected}
                  specialMode={state.specialMode}
                  tags={state.tags}
                  tutorial={state.tutorial}
                  yOffset={state.audioYOffset}
                  goBack={a(actions.goBack)}
                  onAddToPlaylist={a(actions.addToPlaylist)}
                  onBatchTag={a(actions.batchTag)}
                  onBatchEdit={a(actions.batchEdit)}
                  onBatchDetectBPM={p(actions.detectBPMs)}
                  onChangeTab={a(actions.changeAudioLibraryTab)}
                  onImportFromLibrary={a(actions.importAudioFromLibrary)}
                  onManageTags={a(actions.manageTags)}
                  onPlay={a(actions.playAudio)}
                  onSort={a(actions.sortAudioSources)}
                  onSortPlaylist={a(actions.sortPlaylist)}
                  onTutorial={a(actions.doneTutorial)}
                  onUpdateLibrary={a(actions.updateAudioLibrary)}
                  onUpdatePlaylists={a(actions.updatePlaylists)}
                  onUpdateMode={a(actions.setMode)}
                  savePosition={a(actions.saveAudioPosition)}
                  systemMessage={a(actions.systemMessage)}
                />
              )}

              {this.isRoute('scripts') && (
                <ScriptLibrary
                  allScenes={state.scenes}
                  filters={state.scriptFilters}
                  library={state.scripts}
                  selected={state.scriptSelected}
                  specialMode={state.specialMode}
                  tags={state.tags}
                  tutorial={state.tutorial}
                  yOffset={state.scriptYOffset}
                  goBack={a(actions.goBack)}
                  onBatchTag={a(actions.batchTag)}
                  onEditScript={a(actions.openScriptInScriptor)}
                  onImportFromLibrary={a(actions.importScriptFromLibrary)}
                  onImportToScriptor={a(actions.importScriptToScriptor)}
                  onManageTags={a(actions.manageTags)}
                  onPlay={a(actions.playScript)}
                  onSort={a(actions.sortScripts)}
                  onTutorial={a(actions.doneTutorial)}
                  onUpdateLibrary={a(actions.updateScriptLibrary)}
                  onUpdateMode={a(actions.setMode)}
                  onUpdateScript={a(actions.updateScript)}
                  savePosition={a(actions.saveScriptPosition)}
                  systemMessage={a(actions.systemMessage)}
                />
              )}

              {this.isRoute('tags') && (
                <TagManager
                  tags={state.tags}
                  goBack={a(actions.goBack)}
                  onSort={a(actions.sortTags)}
                  onUpdateTags={a(actions.updateTags)}
                />
              )}

              {this.isRoute('clip') && (
                <VideoClipper
                  allTags={state.tags}
                  source={actions.getActiveSource(state)}
                  isLibrary={!actions.getActiveScene(state)}
                  tutorial={state.tutorial}
                  videoVolume={state.config.defaultScene.videoVolume}
                  onTutorial={a(actions.doneTutorial)}
                  onStartVCTutorial={a(actions.startVCTutorial)}
                  onSetDisabledClips={a(actions.setDisabledClips)}
                  onUpdateClips={a(actions.onUpdateClips)}
                  goBack={a(actions.goBack)}
                  navigateClipping={a(actions.navigateClipping)}
                  cache={a(actions.cacheImage)}
                />
              )}

              {this.isRoute('grid') && (
                <GridSetup
                  allScenes={state.scenes}
                  autoEdit={state.specialMode == SP.autoEdit}
                  scene={grid}
                  tutorial={state.tutorial}
                  goBack={a(actions.goBack)}
                  onDelete={a(actions.deleteGrid)}
                  onGenerate={a(actions.generateScenes)}
                  onPlayGrid={a(actions.playGrid)}
                  onTutorial={a(actions.doneTutorial)}
                  onUpdateGrid={a(actions.updateGrid)}
                />
              )}

              {this.isRoute('play') && (
                <Player
                  preventSleep
                  config={state.config}
                  scene={scene}
                  scenes={state.scenes}
                  sceneGrids={state.grids}
                  theme={theme}
                  tutorial={state.tutorial}
                  onGenerate={a(actions.generateScenes)}
                  onUpdateScene={a(actions.updateScene)}
                  nextScene={a(actions.nextScene)}
                  goBack={a(actions.goBack)}
                  playTrack={a(actions.playTrack)}
                  goToTagSource={a(actions.playSceneFromLibrary)}
                  goToClipSource={a(actions.clipVideo)}
                  getTags={actions.getTags.bind(this, state.library)}
                  setCount={a(actions.setCount)}
                  cache={a(actions.cacheImage)}
                  blacklistFile={a(actions.blacklistFile)}
                  systemMessage={a(actions.systemMessage)}
                />
              )}

              {this.isRoute('libraryplay') && (
                <Player
                  preventSleep
                  config={state.config}
                  scene={scene}
                  scenes={state.scenes}
                  sceneGrids={state.grids}
                  theme={theme}
                  tutorial={state.tutorial}
                  onGenerate={a(actions.generateScenes)}
                  onUpdateScene={a(actions.updateScene)}
                  goBack={a(actions.endPlaySceneFromLibrary)}
                  playTrack={a(actions.playTrack)}
                  tags={scene.audioScene ? actions.getAudioSource(state)?.tags : scene.scriptScene ? actions.getScriptSource(state)?.tags : actions.getLibrarySource(state)?.id != -1 ? actions.getLibrarySource(state)?.tags : null}
                  allTags={state.tags}
                  toggleTag={scene.audioScene ? a(actions.toggleAudioTag) : scene.scriptScene ? a(actions.toggleScriptTag) : a(actions.toggleTag)}
                  inheritTags={scene.audioScene || scene.scriptScene ? undefined : a(actions.inheritTags)}
                  navigateTagging={a(actions.navigateDisplayedLibrary)}
                  getTags={actions.getTags.bind(this, state.library)}
                  changeAudioRoute={scene.audioScene ? a(actions.changeAudioRoute) : undefined}
                  setCount={a(actions.setCount)}
                  cache={a(actions.cacheImage)}
                  goToClipSource={a(actions.clipVideo)}
                  blacklistFile={a(actions.blacklistFile)}
                  systemMessage={a(actions.systemMessage)}
                />
              )}

              {this.isRoute('gridplay') && (
                <Player
                  preventSleep
                  config={state.config}
                  scene={scene}
                  scenes={state.scenes}
                  sceneGrids={state.grids}
                  theme={theme}
                  tutorial={state.tutorial}
                  onGenerate={a(actions.generateScenes)}
                  onUpdateScene={a(actions.updateScene)}
                  nextScene={a(actions.nextScene)}
                  goBack={a(actions.endPlaySceneGrid)}
                  playTrack={a(actions.playTrack)}
                  goToTagSource={a(actions.playSceneFromLibrary)}
                  goToClipSource={a(actions.clipVideo)}
                  getTags={actions.getTags.bind(this, state.library)}
                  setCount={a(actions.setCount)}
                  cache={a(actions.cacheImage)}
                  blacklistFile={a(actions.blacklistFile)}
                  systemMessage={a(actions.systemMessage)}
                />
              )}

              {this.isRoute('config') && (
                <ConfigForm
                  config={state.config}
                  library={state.library}
                  scenes={state.scenes}
                  sceneGrids={state.grids}
                  tags={state.tags}
                  theme={state.theme}
                  goBack={a(actions.goBack)}
                  onBackup={appStorage.backup.bind(appStorage, state)}
                  onChangeThemeColor={a(actions.changeThemeColor)}
                  onClean={async () => { try { await actions.cleanBackups(state.config); } catch(e) { console.error(e); } }}
                  onDefault={a(actions.setDefaultConfig)}
                  onRestore={a(actions.restoreFromBackup)}
                  onResetTutorials={a(actions.resetTutorials)}
                  onToggleDarkMode={a(actions.toggleDarkMode)}
                  onUpdateConfig={a(actions.updateConfig)}
                />
              )}

              {this.isRoute('scriptor') && (
                <CaptionScriptor
                  config={state.config}
                  scenes={state.scenes}
                  sceneGrids={state.grids}
                  tutorial={state.tutorial}
                  openScript={actions.getSelectScript(state)}
                  theme={theme}
                  onAddFromLibrary={a(actions.addScriptSingle)}
                  getTags={actions.getTags.bind(this, state.library)}
                  goBack={a(actions.goBack)}
                  onUpdateScene={a(actions.updateScene)}
                  onUpdateLibrary={a(actions.updateScriptLibrary)}
                />
              )}

              <Dialog
                open={!!state.systemMessage}
                onClose={a(actions.closeMessage)}
                aria-describedby="message-description">
                <DialogContent>
                  <DialogContentText id="message-description">
                    {state.systemMessage}
                  </DialogContentText>
                </DialogContent>
              </Dialog>

              <Snackbar
                open={state.systemSnackOpen}
                anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
                autoHideDuration={2000}
                key={state.systemSnack + new Date()}
                onClose={a(actions.closeMessage)}
                TransitionComponent={TransitionUp}>
                <Alert onClose={a(actions.closeMessage)} severity={state.systemSnackSeverity}>
                  {state.systemSnack}
                </Alert>
              </Snackbar>

              {state.tutorial && (
                <Tutorial
                  config={state.config}
                  route={state.route}
                  scene={!!scene ? scene : grid}
                  tutorial={state.tutorial}
                  onSetTutorial={a(actions.setTutorial)}
                  onDoneTutorial={a(actions.doneTutorial)}
                  onSkipAllTutorials={a(actions.skipTutorials)}
                />
              )}
            </Box>
          </ErrorBoundary>
        </ThemeProvider>
      </StyledEngineProvider>
    );
  }
}

(Meta as any).displayName="Meta";
