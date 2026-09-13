import * as React from "react";
import clsx from "clsx";
import wretch from "wretch";
import {openExternal, openFile, revealFile} from "../../services/links";
import {copyText, copyBlob, copyPath} from "../../services/clipboard";
import {getFilesystem} from "../../services/filesystem";
import {syncPathExists} from "../../services/local-paths";
import {isFullscreen, requestFullscreen, exitFullscreen} from "../../services/window";

// Touch-opened bars/drawers hide this long after the LAST interaction inside
// them (each tap re-arms the timer), instead of closing while still in use.
const DRAWER_TOUCH_CLOSE_MS = 4000;
const APP_BAR_TOUCH_CLOSE_MS = 4000;

import {
  AppBar,
  Box,
  Button,
  Card,
  CardActionArea,
  CardContent,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Divider,
  Drawer,
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Grid,
  IconButton,
  Link,
  Toolbar,
  Tooltip,
  Typography,
  Fab,
} from "@mui/material";

import { styled } from "@mui/material/styles";

import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import CloseIcon from '@mui/icons-material/Close';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ForwardIcon from '@mui/icons-material/Forward';
import FullscreenIcon from '@mui/icons-material/Fullscreen';
import PauseIcon from '@mui/icons-material/Pause';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import SystemUpdateAltIcon from "@mui/icons-material/SystemUpdateAlt";
import VibrationIcon from '@mui/icons-material/Vibration';

import {PT, ST} from "../../data/const";
import {getCachePath, urlToPath} from "../../data/utils";
import {getSourceType} from "./Scrapers";
import Config from "../../data/Config";
import LibrarySource from "../../data/LibrarySource";
import Scene from "../../data/Scene";
import Tag from "../../data/Tag";
import ChildCallbackHack from "./ChildCallbackHack";
import SceneOptionCard from "../configGroups/SceneOptionCard";
import ImageVideoCard from "../configGroups/ImageVideoCard";
import ZoomMoveCard from "../configGroups/ZoomMoveCard";
import CrossFadeCard from "../configGroups/CrossFadeCard";
import SlideCard from "../configGroups/SlideCard";
import StrobeCard from "../configGroups/StrobeCard";
import AudioCard from "../configGroups/AudioCard";
import HapticCard from "../configGroups/HapticCard";
import TextCard from "../configGroups/TextCard";
import VideoCard from "../configGroups/VideoCard";
import VideoControl from "./VideoControl";
import HapticIndicator from "./HapticIndicator";
import FadeIOCard from "../configGroups/FadeIOCard";
import PanningCard from "../configGroups/PanningCard";
import Audio from "../../data/Audio";
import SceneGrid from "../../data/SceneGrid";

// Designed for the desktop player; on phones it must never exceed the viewport.
const drawerWidth = Math.min(380, 400);

const hexToRGB = (h: string) => {
  let r = "0", g = "0", b = "0";

  if (h.length == 4) {
    r = "0x" + h[1] + h[1];
    g = "0x" + h[2] + h[2];
    b = "0x" + h[3] + h[3];
  } else if (h.length == 7) {
    r = "0x" + h[1] + h[2];
    g = "0x" + h[3] + h[4];
    b = "0x" + h[5] + h[6];
  }

  return "rgb("+ +r + "," + +g + "," + +b + ", 0.6)";
}

const HoverBar = styled('div')(({ theme }) => ({
  zIndex: theme.zIndex.drawer + 1,
  position: 'absolute',
  opacity: 0,
  height: theme.spacing(5),
  width: '100%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-end',
  padding: '0 8px',
  minHeight: 64,
  paddingTop: 'var(--safe-area-inset-top, env(safe-area-inset-top, 0px))',
}));

const AppBarStyled = styled(AppBar, { shouldForwardProp: (prop) => prop !== 'hovered' })<{ hovered?: boolean }>(
  ({ theme, hovered }) => ({
    zIndex: theme.zIndex.drawer + 1,
    height: `calc(${theme.spacing(8)} + var(--safe-area-inset-top, env(safe-area-inset-top, 0px)))`,
    marginTop: hovered ? 0 : `calc(${theme.spacing(-8.5)} - var(--safe-area-inset-top, env(safe-area-inset-top, 0px)))`,
    transition: theme.transitions.create('margin', {
      easing: theme.transitions.easing.sharp,
      duration: hovered
        ? theme.transitions.duration.enteringScreen
        : theme.transitions.duration.leavingScreen,
    }),
    paddingTop: 'var(--safe-area-inset-top, env(safe-area-inset-top, 0px))',
  })
);

const HeaderBar = styled(Toolbar)({
  display: 'flex',
  alignItems: 'center',
  whiteSpace: 'nowrap',
  flexWrap: 'nowrap',
});

// Left/right icon clusters: reserve 20% on desktop, pack to content on phones
// so the single-row bar fits without squeezing the title to nothing. Shrink is
// allowed on phones so the cluster yields instead of overflowing the right edge
// (which previously pushed the transport buttons off-screen).
const HeaderCluster = styled('div')(({ theme }) => ({
  flexBasis: '20%',
  flexShrink: 0,
  minWidth: 0,
  [theme.breakpoints.down('sm')]: {
    flexBasis: 'auto',
    flexShrink: 1,
    minWidth: 0,
  },
}));

const HoverDrawer = styled('div')(({ theme }) => ({
  zIndex: theme.zIndex.drawer,
  position: 'absolute',
  opacity: 0,
  width: theme.spacing(5),
  height: '100%',
}));

const DrawerStyled = styled(Drawer, { shouldForwardProp: (prop) => prop !== 'hovered' })<{ hovered?: boolean }>(
  ({ theme, hovered }) => ({
    zIndex: theme.zIndex.drawer,
    width: `min(${drawerWidth}px, 100vw)`,
    marginLeft: hovered ? 0 : `calc(min(${drawerWidth}px, 100vw) * -1 - 3px)`,
    transition: theme.transitions.create('margin', {
      easing: theme.transitions.easing.sharp,
      duration: hovered
        ? theme.transitions.duration.enteringScreen
        : theme.transitions.duration.leavingScreen,
    }),
    '& .MuiDrawer-paper': {
      position: 'relative',
      whiteSpace: 'nowrap',
      overflowX: 'hidden',
      height: 'var(--app-height, 100vh)',
      width: hovered ? `min(${drawerWidth}px, 100vw)` : 0,
      maxWidth: 'calc(100vw - 16px)',
      backgroundColor: theme.palette.background.default,
      transition: theme.transitions.create('width', {
        easing: theme.transitions.easing.sharp,
        duration: hovered
          ? theme.transitions.duration.leavingScreen
          : theme.transitions.duration.enteringScreen,
      }),
    },
  })
);

const DrawerToolbar = styled('div')(({ theme }) => ({
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'center',
  position: 'relative',
  backgroundColor: theme.palette.background.default,
  padding: '0 8px',
  paddingTop: 'var(--safe-area-inset-top, env(safe-area-inset-top, 0px))',
  minHeight: 'calc(64px + var(--safe-area-inset-top, env(safe-area-inset-top, 0px)))',
}));

const HoverTagDrawer = styled('div')(({ theme }) => ({
  zIndex: theme.zIndex.drawer + 1,
  position: 'absolute',
  bottom: 0,
  opacity: 0,
  width: '100%',
  height: theme.spacing(5),
}));

const TagDrawerStyled = styled(Drawer, { shouldForwardProp: (prop) => prop !== 'hovered' })<{ hovered?: boolean }>(
  ({ theme, hovered }) => ({
    zIndex: theme.zIndex.drawer + 1,
    position: 'absolute',
    '& .MuiDrawer-paper': {
      overflow: 'hidden',
      transform: hovered ? 'scale(1)' : 'scale(0)',
      transformOrigin: 'bottom left',
      backgroundColor: hexToRGB(theme.palette.background.default),
      transition: theme.transitions.create('transform', {
        easing: theme.transitions.easing.sharp,
        duration: hovered
          ? theme.transitions.duration.leavingScreen
          : theme.transitions.duration.enteringScreen,
      }),
    },
  })
);

const TagListDiv = styled('div')(({ theme }) => ({
  padding: theme.spacing(1),
  display: 'flex',
  flexWrap: 'wrap',
  justifyContent: 'center',
  width: '100%',
}));

class PlayerBars extends React.Component {
  readonly props: {
    config: Config,
    hasStarted: boolean,
    historyPaths: Array<any>,
    historyOffset: number,
    imagePlayerAdvanceHacks: Array<Array<ChildCallbackHack>>,
    imagePlayerDeleteHack: ChildCallbackHack,
    isEmpty: boolean,
    isPlaying: boolean,
    mainVideo: HTMLVideoElement,
    overlayVideos: Array<Array<HTMLVideoElement>>,
    persistAudio: boolean,
    persistText: boolean,
    hapticDevices: Array<{ index: number; name: string }>,
    hapticActive: boolean,
    scene: Scene,
    scenes: Array<Scene>,
    sceneGrids: Array<SceneGrid>,
    title: string,
    tutorial: string,
    goBack(): void,
    historyBack(): void,
    historyForward(): void,
    navigateTagging(offset: number): void,
    onGenerate(scene: Scene | SceneGrid, children?: boolean, force?: boolean): void,
    onHapticsEnabledChange(enabled: boolean): void,
    onUpdateScene(scene: Scene, fn: (scene: Scene) => void): void,
    playNextScene(): void,
    play(): void,
    pause(): void,
    setCurrentAudio(audio: Audio): void,
    allTags?: Array<Tag>,
    tags?: Array<Tag>,
    blacklistFile?(sourceURL: string, fileToBlacklist: string): void,
    goToTagSource?(source: LibrarySource): void,
    goToClipSource?(source: LibrarySource): void,
    playTrack?(url: string): void,
    onPlaying?(position: number, duration: number): void,
    toggleTag?(sourceID: number, tag: Tag): void,
    inheritTags?(sourceID: number): void,
  };

  readonly state = {
    appBarHover: false,
    drawerHover: false,
    tagDrawerHover: false,
    blacklistSource: null as string,
    blacklistFile: null as string,
    deletePath: null as string,
    deleteError: null as string,
    contextMenu: null as {x: number, y: number, items: Array<{label: string, action: () => void}>} | null,
  };

  _interval: ReturnType<typeof setInterval> | null = null;
  _appBarTimeout: any = null;
  _drawerTimeout: any = null;
  _tagDrawerTimeout: any = null;
  _showVideoControls = false;
  // Touch-initiated drawer/appbar opens must keep their auto-close timer; on
  // touch devices tapping controls inside the open surface fires a synthetic
  // mouseenter that would otherwise disarm the close timeout and leave it
  // stuck open.
  _drawerTouchOpened = false;
  _appBarTouchOpened = false;

  render() {
    const canGoBack = this.props.historyOffset > -(this.props.historyPaths.length - 1);
    const canGoForward = this.props.historyOffset < 0;
    const tagNames = this.props.tags ? this.props.tags.map((t) => t.name) : [];
    let clipValue = null;
    let clipID: number = null;
    let source = null;
    if (this.props.mainVideo && this.props.mainVideo.hasAttribute("start") && this.props.mainVideo.hasAttribute("end")) {
      const clipStart = parseFloat(this.props.mainVideo.getAttribute("start"));
      const clipEnd = parseFloat(this.props.mainVideo.getAttribute("end"));
      if (!isNaN(clipStart) && !isNaN(clipEnd)) {
        clipValue = [clipStart, clipEnd];
      }
      clipID = parseInt(this.props.mainVideo.getAttribute("clip"));
      const sourceURL = this.props.mainVideo.getAttribute("source");
      source = this.props.scene.sources.find((s) => s.url == sourceURL);
    }

    if (!this._showVideoControls) {
      this._showVideoControls = this.props.mainVideo != null || this.props.overlayVideos.find((a) => a != null) != null;
    }

    const appBarHovered = this.props.tutorial == PT.toolbar || !this.props.hasStarted || this.props.isEmpty || this.state.appBarHover;

    return (
      <React.Fragment>
        <HoverBar
          onMouseEnter={this.onMouseEnterAppBar.bind(this)}
          onMouseLeave={this.onMouseLeaveAppBar.bind(this)}
          onTouchStart={this.onTouchAppBarToggle.bind(this)}/>    

        <AppBarStyled
         
          position="absolute"
          hovered={appBarHovered}
          onMouseEnter={this.onMouseEnterAppBar.bind(this)}
          onMouseLeave={this.onMouseLeaveAppBar.bind(this)}
          onTouchStart={this.onTouchAppBarKeep.bind(this)}
          sx={this.props.tutorial == PT.toolbar ? {
            zIndex: 'calc(1300 + 1)',
            borderWidth: 2,
            borderColor: 'secondary.main',
            borderStyle: 'solid',
          } : undefined}>
          <HeaderBar ref={(el) => (this.refs as any).headerBar = el}>
            <HeaderCluster>
              <Tooltip disableInteractive title="Back" placement="right-end">
                <IconButton
                  edge="start"
                  color="inherit"
                  aria-label="Back"
                  onClick={this.navigateBack.bind(this)}
                  size="large"
                  sx={(theme) => ({ [theme.breakpoints.down('sm')]: { padding: 4, '& svg': { fontSize: 22 } } })}>
                  <ArrowBackIcon />
                </IconButton>
              </Tooltip>
            </HeaderCluster>

            <Box sx={{ flexGrow: 1, minWidth: 0, overflow: 'hidden', display: 'flex', justifyContent: 'center' }}>
              <Tooltip disableInteractive title={this.props.title}>
                <Typography
                  component="h1"
                  variant="h4"
                  color="inherit"
                  noWrap
                  sx={(theme) => ({
                    textAlign: 'center',
                    flexGrow: 1,
                    flexShrink: 1,
                    minWidth: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    [theme.breakpoints.down('sm')]: {
                      // Single-row: the title ellipsizes instead of wrapping so the
                      // fixed-height bar still slides off-screen on play.
                      fontSize: '1.1rem',
                      whiteSpace: 'nowrap',
                    },
                  })}>
                  {this.props.title}
                </Typography>
              </Tooltip>
            </Box>

            <HeaderCluster ref={(el) => (this.refs as any).rightCluster = el} sx={{ justifyContent: 'flex-end', display: 'flex', alignItems: 'center' }}>
              <Tooltip disableInteractive title="Toggle Fullscreen">
                <IconButton
                  edge="start"
                  color="inherit"
                  aria-label="FullScreen"
                  onClick={this.toggleFull.bind(this)}
                  size="large"
                  sx={(theme) => ({ [theme.breakpoints.down('sm')]: { padding: 4, '& svg': { fontSize: 22 } } })}>
                  <FullscreenIcon fontSize="large"/>
                </IconButton>
              </Tooltip>
              <Box sx={(theme) => ({ display: 'flex', [theme.breakpoints.down('sm')]: { display: 'none' } })}>
                <HapticIndicator
                  active={this.props.hapticActive}
                  connected={this.props.hapticDevices?.length > 0}
                  deviceName={this.props.hapticDevices?.[0]?.name}
                />
              </Box>
              {!this.props.scene.gridScene && (
                <React.Fragment>
                  <Divider component="div" orientation="vertical" sx={(theme) => ({ height: 48, margin: '0 14px 0 3px', [theme.breakpoints.down('sm')]: { display: 'none' } })}/>
                  <IconButton
                    disabled={!canGoBack}
                    edge="start"
                    color="inherit"
                    aria-label="Backward"
                    onClick={this.historyBack.bind(this)}
                    size="large"
                    sx={(theme) => ({ [theme.breakpoints.down('sm')]: { padding: 4, '& svg': { fontSize: 22 } } })}>
                    <ForwardIcon fontSize="large" style={{transform: 'rotate(180deg)'}}/>
                  </IconButton>
                  <IconButton
                    edge="start"
                    color="inherit"
                    aria-label={this.props.isPlaying ? "Pause" : "Play"}
                    onClick={this.setPlayPause.bind(this, !this.props.isPlaying)}
                    size="large"
                    sx={(theme) => ({ [theme.breakpoints.down('sm')]: { padding: 4, '& svg': { fontSize: 22 } } })}>
                    {this.props.isPlaying ? <PauseIcon fontSize="large"/> : <PlayArrowIcon fontSize="large"/>}
                  </IconButton>
                  <IconButton
                    edge="start"
                    color="inherit"
                    aria-label="Forward"
                    onClick={this.historyForward.bind(this)}
                    size="large"
                    sx={(theme) => ({ [theme.breakpoints.down('sm')]: { padding: 4, '& svg': { fontSize: 22 } } })}>
                    <ForwardIcon fontSize="large" style={canGoForward ? {} : {color: 'rgba(255, 255, 255, 0.3)', backgroundColor: 'transparent'}}/>
                  </IconButton>
                </React.Fragment>
              )}
            </HeaderCluster>
          </HeaderBar>
        </AppBarStyled>

        {this.props.hasStarted && !this.props.isEmpty && !this.props.scene.downloadScene && (
          <React.Fragment>
            <HoverDrawer
              onMouseEnter={this.onMouseEnterDrawer.bind(this)}
              onMouseLeave={this.onMouseLeaveDrawer.bind(this)}
              onTouchStart={this.onTouchDrawerToggle.bind(this)}/>    

            <DrawerStyled
              variant="permanent"
              hovered={this.props.tutorial == PT.sidebar || this.state.drawerHover}
              sx={this.props.tutorial == PT.toolbar ? {
                '& .MuiDrawer-paper': {
                  zIndex: 'calc(1300 + 1)',
                  borderWidth: 2,
                  borderColor: 'secondary.main',
                  borderStyle: 'solid',
                },
              } : undefined}
              open={this.props.tutorial == PT.sidebar || this.state.drawerHover}
              onMouseEnter={this.onMouseEnterDrawer.bind(this)}
              onMouseLeave={this.onMouseLeaveDrawer.bind(this)}>
              <DrawerToolbar>
                <Typography variant="h4">
                  Settings
                </Typography>
                <IconButton
                  aria-label="Close Settings"
                  onClick={this.closeDrawer.bind(this)}
                  size="small"
                  sx={{
                    position: 'absolute',
                    right: 4,
                    top: '50%',
                    transform: 'translateY(-50%)',
                  }}>
                  <CloseIcon />
                </IconButton>
              </DrawerToolbar>

              {!this.props.scene.audioScene && this._showVideoControls && (
                <Accordion TransitionProps={{ unmountOnExit: false }}>
                  <AccordionSummary
                    expandIcon={<ExpandMoreIcon />}
                  >
                    <Typography>Video Controls</Typography>
                  </AccordionSummary>
                  <AccordionDetails>
                    <VideoCard
                      scene={this.props.scene}
                      otherScenes={this.props.scene.overlays.map((o) => this.getScene(o.sceneID))}
                      isPlaying={this.props.isPlaying}
                      mainVideo={this.props.mainVideo}
                      mainClip={source ? source.clips.find((c) => c.id == clipID) : null}
                      mainClipValue={clipValue ? clipValue : null}
                      otherVideos={this.props.overlayVideos}
                      imagePlayerAdvanceHacks={this.props.imagePlayerAdvanceHacks}
                      onUpdateScene={this.props.onUpdateScene.bind(this)}/>
                  </AccordionDetails>
                </Accordion>
              )}

              {!this.props.scene.audioScene && !this.props.scene.gridScene && (
                <React.Fragment>
                  <Accordion TransitionProps={{ unmountOnExit: true }}>
                    <AccordionSummary
                      expandIcon={<ExpandMoreIcon />}
                    >
                      <Typography>Scene Options</Typography>
                    </AccordionSummary>
                    <AccordionDetails>
                      <SceneOptionCard
                        sidebar
                        allScenes={this.props.scenes}
                        allSceneGrids={this.props.sceneGrids}
                        isTagging={this.props.allTags != null}
                        scene={this.props.scene}
                        onUpdateScene={this.props.onUpdateScene.bind(this)}
                        onGenerate={this.props.onGenerate}/>
                    </AccordionDetails>
                  </Accordion>

                  <Accordion TransitionProps={{ unmountOnExit: true }}>
                    <AccordionSummary
                      expandIcon={<ExpandMoreIcon />}
                    >
                      <Typography>Image/Video Options</Typography>
                    </AccordionSummary>
                    <AccordionDetails>
                      <ImageVideoCard
                        sidebar
                        isPlayer
                        isConfig={false}
                        scene={this.props.scene}
                        onUpdateScene={this.props.onUpdateScene.bind(this)}/>
                    </AccordionDetails>
                  </Accordion>

                  <Accordion TransitionProps={{ unmountOnExit: true }}>
                    <AccordionSummary
                      expandIcon={<ExpandMoreIcon />}
                    >
                      <Typography>Zoom/Move</Typography>
                    </AccordionSummary>
                    <AccordionDetails>
                      <ZoomMoveCard
                        sidebar
                        scene={this.props.scene}
                        easingControls={this.props.config.displaySettings.easingControls}
                        onUpdateScene={this.props.onUpdateScene.bind(this)} />
                    </AccordionDetails>
                  </Accordion>

                  <Accordion TransitionProps={{ unmountOnExit: true }}>
                    <AccordionSummary
                      expandIcon={<ExpandMoreIcon />}
                    >
                      <Typography>Cross-Fade</Typography>
                    </AccordionSummary>
                    <AccordionDetails>
                      <CrossFadeCard
                        sidebar
                        scene={this.props.scene}
                        easingControls={this.props.config.displaySettings.easingControls}
                        onUpdateScene={this.props.onUpdateScene.bind(this)} />
                    </AccordionDetails>
                  </Accordion>

                  <Accordion TransitionProps={{ unmountOnExit: true }}>
                    <AccordionSummary
                      expandIcon={<ExpandMoreIcon />}
                    >
                      <Typography>Slide</Typography>
                    </AccordionSummary>
                    <AccordionDetails>
                      <SlideCard
                        sidebar
                        scene={this.props.scene}
                        easingControls={this.props.config.displaySettings.easingControls}
                        onUpdateScene={this.props.onUpdateScene.bind(this)} />
                    </AccordionDetails>
                  </Accordion>

                  <Accordion TransitionProps={{ unmountOnExit: true }}>
                    <AccordionSummary
                      expandIcon={<ExpandMoreIcon />}
                    >
                      <Typography>Strobe</Typography>
                    </AccordionSummary>
                    <AccordionDetails>
                      <StrobeCard
                        sidebar
                        scene={this.props.scene}
                        easingControls={this.props.config.displaySettings.easingControls}
                        onUpdateScene={this.props.onUpdateScene.bind(this)} />
                    </AccordionDetails>
                  </Accordion>

                  <Accordion TransitionProps={{ unmountOnExit: true }}>
                    <AccordionSummary
                      expandIcon={<ExpandMoreIcon />}
                    >
                      <Typography>Fade In/Out</Typography>
                    </AccordionSummary>
                    <AccordionDetails>
                      <FadeIOCard
                        sidebar
                        scene={this.props.scene}
                        easingControls={this.props.config.displaySettings.easingControls}
                        onUpdateScene={this.props.onUpdateScene.bind(this)}/>
                    </AccordionDetails>
                  </Accordion>

                  <Accordion TransitionProps={{ unmountOnExit: true }}>
                    <AccordionSummary
                      expandIcon={<ExpandMoreIcon />}
                    >
                      <Typography>Panning</Typography>
                    </AccordionSummary>
                    <AccordionDetails>
                      <PanningCard
                        sidebar
                        scene={this.props.scene}
                        easingControls={this.props.config.displaySettings.easingControls}
                        onUpdateScene={this.props.onUpdateScene.bind(this)}/>
                    </AccordionDetails>
                  </Accordion>
                </React.Fragment>
              )}

              {!this.props.scene.gridScene && (
                <Accordion defaultExpanded={this.props.scene.audioScene} TransitionProps={{ unmountOnExit: !this.props.scene.audioEnabled && this.props.scene.nextSceneID === 0 }}>
                  <AccordionSummary
                    expandIcon={<ExpandMoreIcon />}
                  >
                    <Typography>Audio Tracks</Typography>
                  </AccordionSummary>
                  <AccordionDetails>
                    <AudioCard
                      sidebar
                      scene={this.props.scene}
                      scenePaths={this.props.historyPaths}
                      startPlaying
                      persist={this.props.persistAudio}
                      onUpdateScene={this.props.onUpdateScene.bind(this)}
                      goBack={this.navigateBack.bind(this)}
                      orderAudioTags={this.orderAudioTags.bind(this)}
                      onPlaying={this.props.onPlaying}
                      playTrack={this.props.playTrack}
                      playNextScene={this.props.playNextScene}
                      setCurrentAudio={this.props.setCurrentAudio.bind(this)}/>
                  </AccordionDetails>
                </Accordion>
              )}

              {!this.props.scene.audioScene && !this.props.scene.gridScene && (
                <Accordion TransitionProps={{ unmountOnExit: true }}>
                  <AccordionSummary
                    expandIcon={<ExpandMoreIcon />}
                  >
                    <Typography>
                      <VibrationIcon fontSize="small" style={{ verticalAlign: 'middle', marginRight: 8 }} />
                      Haptic Feedback
                    </Typography>
                  </AccordionSummary>
                  <AccordionDetails>
                    <HapticCard
                      sidebar
                      hapticsEnabled={this.props.scene.hapticsEnabled}
                      hapticIntensity={this.props.scene.hapticIntensity}
                      hapticPattern={this.props.scene.hapticPattern as any}
                      connectedDevices={this.props.hapticDevices ?? []}
                      activeDeviceIndex={this.props.scene.hapticActiveDevice}
                      onHapticsEnabledChange={this.props.onHapticsEnabledChange}
                      onChange={(changes) => {
                        this.props.onUpdateScene(this.props.scene, (s) => {
                          Object.assign(s, changes);
                        });
                      }}
                    />
                  </AccordionDetails>
                </Accordion>
              )}

              {!this.props.scene.audioScene && !this.props.scene.gridScene && !this.props.persistText && (
                <Accordion TransitionProps={{ unmountOnExit: true }}>
                  <AccordionSummary
                    expandIcon={<ExpandMoreIcon />}
                  >
                    <Typography>Text Overlay</Typography>
                  </AccordionSummary>
                  <AccordionDetails>
                    <TextCard
                      sidebar
                      scene={this.props.scene}
                      onAddScript={() => {}}
                      onPlay={() => {}}
                      onUpdateScene={this.props.onUpdateScene.bind(this)}
                      systemMessage={() => {}}/>
                  </AccordionDetails>
                </Accordion>
              )}
            </DrawerStyled>
          </React.Fragment>
        )}

        {!this.props.scene.downloadScene && this.props.hasStarted && this.props.allTags && (
          <React.Fragment>
            <HoverTagDrawer
              onMouseEnter={this.onMouseEnterTagDrawer.bind(this)}
              onMouseLeave={this.onMouseLeaveTagDrawer.bind(this)}
              onTouchStart={this.onTouchTagDrawerToggle.bind(this)}/>    

            <TagDrawerStyled
              variant="permanent"
              anchor="bottom"
              hovered={this.state.tagDrawerHover}
              open={this.state.tagDrawerHover}
              onMouseEnter={this.onMouseEnterTagDrawer.bind(this)}
              onMouseLeave={this.onMouseLeaveTagDrawer.bind(this)}>
              <Grid container alignItems="center">
                {this.props.tags != null && (
                  <React.Fragment>
                    <Grid item xs>
                      <TagListDiv>
                        {this.props.allTags.map((tag) =>
                          <Card
                            sx={[
                              { mr: 1, mb: 1 },
                              tagNames && tagNames.includes(tag.name) && {
                                backgroundColor: 'primary.light',
                                color: 'primary.contrastText',
                              },
                            ]}
                            key={tag.id}>
                            <CardActionArea onClick={this.props.toggleTag.bind(this, this.props.scene.libraryID, tag)}>
                              <CardContent sx={{ p: 1 }}>
                                <Typography component="h6" variant="body2">
                                  {tag.name}
                                </Typography>
                              </CardContent>
                            </CardActionArea>
                          </Card>
                        )}
                      </TagListDiv>
                    </Grid>
                    {(this.props.inheritTags && (!tagNames || tagNames.length == 0) && this.props.scene.sources[0].clips && this.props.scene.sources[0].clips.find((c) => c.tags && c.tags.length > 0) != null) && (
                      <Grid item>
                        <Tooltip disableInteractive title="Inherit Clip Tags">
                          <Fab
                            color="primary"
                            size="small"
                            onClick={this.props.inheritTags.bind(this, this.props.scene.libraryID)}>
                            <SystemUpdateAltIcon/>
                          </Fab>
                        </Tooltip>
                      </Grid>
                    )}
                  </React.Fragment>
                )}
                <Grid item xs={12}>
                  {this.props.scene.sources.length == 1 && getSourceType(this.props.scene.sources[0].url) == ST.video && (
                    <VideoControl
                      video={this.props.mainVideo}
                      clip={source ? source.clips.find((c) => c.id == clipID) : null}
                      clipValue={clipValue ? clipValue : null}
                      useHotkeys
                      skip={this.props.scene.videoSkip}
                      onChangeVolume={() => {}}/>
                  )}
                </Grid>
              </Grid>

            </TagDrawerStyled>
          </React.Fragment>
        )}

        <Dialog
          open={!!this.state.blacklistFile}
          onClose={this.onCloseDialog.bind(this)}
          aria-labelledby="blacklist-title"
          aria-describedby="blacklist-description">
          <DialogTitle id="blacklist-title">Blacklist File</DialogTitle>
          <DialogContent>
            <DialogContentText id="blacklist-description">
              Are you sure you want to blacklist <Link
              sx={{ wordWrap: 'break-word' }}
              href="#"
              onClick={this.openLink.bind(this, this.state.blacklistFile)}
              underline="hover">{this.state.blacklistFile}</Link> ?
            </DialogContentText>
          </DialogContent>
          <DialogActions>
            <Button onClick={this.onCloseDialog.bind(this)} color="secondary">
              Cancel
            </Button>
            <Button onClick={this.onFinishBlacklistFile.bind(this)} color="primary">
              Yes
            </Button>
          </DialogActions>
        </Dialog>

        <Dialog
          open={!!this.state.deletePath}
          onClose={this.onCloseDialog.bind(this)}
          aria-labelledby="delete-title"
          aria-describedby="delete-description">
          <DialogTitle id="delete-title">Delete File</DialogTitle>
          <DialogContent>
            {this.state.deletePath && (
              <DialogContentText id="delete-description">
                Are you sure you want to delete <Link
                sx={{ wordWrap: 'break-word' }}
                href="#"
                onClick={this.openLink.bind(this, this.state.deletePath)}
                underline="hover">{this.state.deletePath}</Link>
              </DialogContentText>
            )}
          </DialogContent>
          <DialogActions>
            <Button onClick={this.onCloseDialog.bind(this)} color="secondary">
              Cancel
            </Button>
            <Button onClick={this.onFinishDeletePath.bind(this)} color="primary">
              Yes
            </Button>
          </DialogActions>
        </Dialog>

        <Dialog
          open={!!this.state.deleteError}
          onClose={this.onCloseDialog.bind(this)}
          aria-describedby="delete-error-description">
          <DialogContent>
            <DialogContentText sx={{ wordWrap: 'break-word' }} id="delete-error-description">
              {this.state.deleteError}
            </DialogContentText>
          </DialogContent>
        </Dialog>

        {this.state.contextMenu && (
          <div
            style={{position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 20000}}
            onContextMenu={(e) => e.preventDefault()}
            onClick={this.closeContextMenu.bind(this)}
            onScroll={this.closeContextMenu.bind(this)}>
            <div
              style={{position: 'absolute', top: Math.min(this.state.contextMenu.y, window.innerHeight - 40), left: Math.min(this.state.contextMenu.x, window.innerWidth - 240), background: '#303030', color: '#fff', boxShadow: '2px 2px 10px rgba(0,0,0,0.5)', borderRadius: 4, padding: 6, minWidth: 180, maxWidth: 'calc(100vw - 32px)', zIndex: 20001, maxHeight: '80vh', overflow: 'auto'}}
              onClick={(e) => e.stopPropagation()}>
              {this.state.contextMenu.items.map((item, i) => (
                <div key={i}
                  onClick={() => { item.action(); this.closeContextMenu(); }}
                  style={{padding: '6px 12px', cursor: 'pointer', borderRadius: 2, fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}
                  onMouseEnter={(e) => (e.target as any).style.background = '#505050'}
                  onMouseLeave={(e) => (e.target as any).style.background = 'transparent'}>
                  {item.label}
                </div>
              ))}
            </div>
          </div>
        )}
      </React.Fragment>
    );
  }

  closeContextMenu() {
    this.setState({contextMenu: null});
  }

  componentDidMount() {
    this.setAlwaysOnTop(this.props.config.displaySettings.alwaysOnTop);
    this.setMenuBarVisibility(this.props.config.displaySettings.showMenu);
    this.setFullscreen(this.props.config.displaySettings.fullScreen);

    window.addEventListener('contextmenu', this.showContextMenu, false);
    window.addEventListener('keydown', this.onKeyDown, false);
    window.addEventListener('wheel', this.onScroll, false);
    if (this.props.config.displaySettings.clickToProgress) {
      window.addEventListener('click', this.onClick, false);
    }

    // One-shot layout diagnostic: confirm the top-right cluster fits inside the
    // viewport on phones (pause/next visibility regression).
    requestAnimationFrame(() => {
      try {
        const bar = (this.refs as any).headerBar?.getBoundingClientRect?.();
        const cluster = (this.refs as any).rightCluster?.getBoundingClientRect?.();
        console.log('[PlayerBars:layout]', JSON.stringify({
          innerW: window.innerWidth,
          bar: bar ? { left: bar.left, right: bar.right, w: bar.width } : null,
          rightCluster: cluster ? { left: cluster.left, right: cluster.right, w: cluster.width } : null,
        }));
      } catch (e) {}
    });
  }

  componentWillUnmount() {
    clearInterval(this._interval);
    this._interval = null;
    clearTimeout(this._appBarTimeout);
    clearTimeout(this._drawerTimeout);
    clearTimeout(this._tagDrawerTimeout);
    this._appBarTimeout = null;
    this._drawerTimeout = null;
    this._tagDrawerTimeout = null;
    window.removeEventListener('contextmenu', this.showContextMenu);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('wheel', this.onScroll);
    if (this.props.config.displaySettings.clickToProgress) {
      window.removeEventListener('click', this.onClick);
    }
  }

  onClick = (e: MouseEvent) => {
    if (this.state.contextMenu) return;
    if (this.props.scene.audioScene || this.state.drawerHover || this.state.tagDrawerHover || this.state.appBarHover) return;
    if ((!this.props.isPlaying || this.props.config.displaySettings.clickToProgressWhilePlaying) && this.props.hasStarted) {
      this.props.imagePlayerAdvanceHacks[0][0].fire();
    }
  }

  onScroll = (e: WheelEvent) => {
    if (!this.props.onUpdateScene || this.state.drawerHover) return;
    const volumeChange = (e.deltaY / 100) * -2;
    let newVolume = parseInt(this.props.scene.videoVolume as any) + volumeChange;
    if (newVolume < 0) {
      newVolume = 0;
    } else if (newVolume > 100) {
      newVolume = 100;
    }
    if (this.props.mainVideo) {
      this.props.mainVideo.volume = newVolume / 100;
    }
    this.props.onUpdateScene(this.props.scene, (s) => s.videoVolume = newVolume);
  }

  getScene(id: number): Scene | SceneGrid {
    if (id == null) return null;
    if (id.toString().startsWith('999')) {
      return this.props.sceneGrids.find((s) => s.id.toString() == id.toString().replace('999',''));
    } else {
      return this.props.scenes.find((s) => s.id == id);
    }
  }

  openLink(url: string) {
    openExternal(url);
  }

  onMouseEnterAppBar() {
    // Any interaction (including a synthetic mouseenter from a tap inside)
    // re-arms the auto-close timer when the bar was touch-opened, so it stays
    // visible while being used and hides only after the surface is idle.
    if (this._appBarTouchOpened) {
      this.setState({appBarHover: true});
      clearTimeout(this._appBarTimeout);
      this._appBarTimeout = setTimeout(this.closeAppBar.bind(this), APP_BAR_TOUCH_CLOSE_MS);
      return;
    }
    clearTimeout(this._appBarTimeout);
    this.setState({appBarHover: true});
  }

  closeAppBar() {
    this._appBarTouchOpened = false;
    this.setState({appBarHover: false});
  }

  onMouseLeaveAppBar() {
    if (this._appBarTouchOpened) return;
    clearTimeout(this._appBarTimeout);
    this._appBarTimeout = setTimeout(this.closeAppBar.bind(this), 1000);
  }

  onTouchAppBarToggle() {
    clearTimeout(this._appBarTimeout);
    if (this.state.appBarHover) {
      this.closeAppBar();
    } else {
      this._appBarTouchOpened = true;
      this.setState({appBarHover: true});
      this._appBarTimeout = setTimeout(this.closeAppBar.bind(this), APP_BAR_TOUCH_CLOSE_MS);
    }
  }

  onTouchAppBarKeep() {
    this._appBarTouchOpened = true;
    clearTimeout(this._appBarTimeout);
    this._appBarTimeout = setTimeout(this.closeAppBar.bind(this), APP_BAR_TOUCH_CLOSE_MS);
  }

  onMouseEnterDrawer() {
    // Desktop hover opens the drawer; a touch-opened drawer simply stays open
    // (no auto-close timer — the X button in its header closes it).
    if (this._drawerTouchOpened) {
      this.setState({drawerHover: true});
      return;
    }
    clearTimeout(this._drawerTimeout);
    this.setState({drawerHover: true});
  }

  closeDrawer() {
    this._drawerTouchOpened = false;
    this.setState({drawerHover: false});
  }

  onMouseLeaveDrawer() {
    if (this._drawerTouchOpened) return;
    clearTimeout(this._drawerTimeout);
    this._drawerTimeout = setTimeout(this.closeDrawer.bind(this), 1000);
  }

  onTouchDrawerToggle() {
    if (this.state.drawerHover) {
      // Open-only: the drawer stays open until the X button closes it
      // (a swipe/tap-to-close here conflicted with scrolling the drawer).
      return;
    }
    // Touch: keep the drawer open until the user closes it (X button). No
    // auto-close timeout — a playing scene shouldn't hide the controls mid-use.
    this._drawerTouchOpened = true;
    this.setState({drawerHover: true});
  }

  onMouseEnterTagDrawer() {
    clearTimeout(this._tagDrawerTimeout);
    this.setState({tagDrawerHover: true});
  }

  closeTagDrawer() {
    this.setState({tagDrawerHover: false});
  }

  onMouseLeaveTagDrawer() {
    clearTimeout(this._tagDrawerTimeout);
    this._tagDrawerTimeout = setTimeout(this.closeTagDrawer.bind(this), 500);
  }

  onTouchTagDrawerToggle() {
    clearTimeout(this._tagDrawerTimeout);
    if (this.state.tagDrawerHover) {
      this.closeTagDrawer();
    } else {
      this.setState({tagDrawerHover: true});
      this._tagDrawerTimeout = setTimeout(this.closeTagDrawer.bind(this), 3000);
    }
  }

  onCloseDialog() {
    this.setState({blacklistSource: null, blacklistFile: null, deletePath: null, deleteError: null});
  }

  onBlacklistFile(source: string, fileToBlacklist: string) {
    if (this.props.config.generalSettings.confirmBlacklist) {
      this.setState({blacklistSource: source, blacklistFile: fileToBlacklist});
    } else {
      this.props.blacklistFile(source, fileToBlacklist);
    }
  }

  onFinishBlacklistFile() {
    this.props.blacklistFile(this.state.blacklistSource, this.state.blacklistFile);
    this.onCloseDialog();
  }

  onDeletePath(path: string) {
    if (syncPathExists(path)) {
      if (this.props.config.generalSettings.confirmFileDeletion) {
        this.setState({deletePath: path});
      } else {
        this.doDelete(path);
      }
    } else {
      this.setState({deletePath: null, deleteError: "This file doesn't exist, cannot delete"});
    }
  }

  async doDelete(path: string) {
    try {
      await getFilesystem().deleteFile(path);
      this.props.imagePlayerDeleteHack.fire();
      this.onCloseDialog();
    } catch (err) {
      this.setState({deletePath: null, deleteError: "An error occurred while deleting the file: " + (err as Error).message});
      console.error(err);
    }
  }

  onFinishDeletePath() {
    this.doDelete(this.state.deletePath);
  }

  toggleFull() {
    const full = !isFullscreen();
    this.setFullscreen(full);
    this.setMenuBarVisibility(!full);
  }

  historyBack() {
    if (!this.state.drawerHover || document.activeElement.tagName.toLocaleLowerCase() != "input") {
      if (this.props.historyOffset > -(this.props.historyPaths.length - 1)) {
        this.props.historyBack();
      }
    }
  }

  historyForward() {
    if (!this.state.drawerHover || document.activeElement.tagName.toLocaleLowerCase() != "input") {
      if (this.props.historyOffset >= 0) {
        this.props.imagePlayerAdvanceHacks[0][0].fire();
      } else {
        this.props.historyForward();
      }
    }
  }

  setMenuBarVisibility(showMenu: boolean) {
    this.props.config.displaySettings.showMenu = showMenu;
  }

  setFullscreen(fullScreen: boolean) {
    this.props.config.displaySettings.fullScreen = fullScreen;
    if (fullScreen) {
      requestFullscreen();
    } else {
      exitFullscreen();
    }
  }

  showContextMenu = (e: MouseEvent) => {
    if (this.props.tutorial != null) return;
    e.preventDefault();
    const img = this.props.historyPaths[(this.props.historyPaths.length - 1) + this.props.historyOffset];
    if (!img || !(img as any).url) return;
    // LiveShow history is a {url, source, post} record (no decoded DOM element).
    const url = (img as any).url;
    let source = (img as any).source;
    let post = (img as any).post;
    const literalSource = source;
    const isRemote = /^https?:\/\//g.exec(url) != null;
    const isBlob = url.startsWith("blob:") || url.startsWith("data:");
    const isFile = !isRemote && !isBlob;
    const path = isFile ? url : urlToPath(url);
    const type = getSourceType(source);
    const items: Array<{label: string, action: () => void}> = [];

    if (source) {
      items.push({
        label: literalSource,
        action: () => { copyText(source); }
      });
    }
    if (!!post) {
      items.push({
        label: post,
        action: () => { copyText(post); }
      });
    }
    items.push({
      label: isFile ? path : url,
      action: () => { copyText(isFile ? path : url); }
    });
    if (url.toLocaleLowerCase().endsWith(".png") || url.toLocaleLowerCase().endsWith(".jpg") || url.toLocaleLowerCase().endsWith(".jpeg")) {
      items.push({
        label: 'Copy Image',
        action: () => {
          this.copyImageToClipboard(url);
        }
      });
    }
    items.push({
      label: 'Open Source',
      action: () => { if (source) { if (/^https?:\/\//g.exec(source)) { openExternal(source); } else { openFile(source); } } }
    });
    if (!!post) {
      items.push({
        label: 'Open Post',
        action: () => { openExternal(post); }
      });
    }
    items.push({
      label: isFile ? 'Open File' : 'Open URL',
      action: () => { if (isFile) { openFile(path); } else { openExternal(url); } }
    });
    if (this.props.config.caching.enabled && type != ST.local) {
      items.push({
        label: 'Open Cached Images',
        action: () => {
          revealFile(getCachePath(source, this.props.config));
        }
      });
    }
    if ((!isFile && type != ST.video && type != ST.playlist) || type == ST.local) {
      items.push({
        label: 'Blacklist File',
        action: () => {
          this.onBlacklistFile(literalSource, isFile ? path : url);
        }
      });
    }
    if (isFile) {
      items.push({
        label: 'Reveal',
        action: () => {
          revealFile(path);
        }
      });
      items.push({
        label: 'Delete',
        action: () => {
          this.onDeletePath(path);
        }
      });
    }
    if (!this.props.allTags) {
      items.push({
        label: 'Goto Tag Source',
        action: () => {
          this.props.goToTagSource(new LibrarySource({url: source}));
        }
      });
    }
    if (type == ST.video) {
      items.push({
        label: 'Goto Clip Source',
        action: () => {
          this.props.goToClipSource(new LibrarySource({url: source}));
        }
      });
    }
    this.setState({contextMenu: {x: e.clientX, y: e.clientY, items: items}});
  };

  onKeyDown = (e: KeyboardEvent) => {
    const focus = document.activeElement.tagName.toLocaleLowerCase();
    switch (e.key) {
      case ' ':
        if ((!this.state.drawerHover || focus != "input") && !e.shiftKey) {
          e.preventDefault();
          this.playPause();
        }
        break;
      case 'ArrowLeft':
        if ((!this.state.drawerHover || focus != "input") && !e.shiftKey) {
          e.preventDefault();
          this.historyBack();
        }
        break;
      case 'ArrowRight':
        if ((!this.state.drawerHover || focus != "input") && !e.shiftKey) {
          e.preventDefault();
          this.historyForward();
        }
        break;
      case 'Escape':
        e.preventDefault();
        this.navigateBack();
        break;
      case 'c':
        if (e.ctrlKey) {
          e.preventDefault();
          this.copyImageToClipboard(null);
        }
        break;
      case 'f':
        if (e.ctrlKey) {
          e.preventDefault();
          this.toggleFullscreen();
        }
        break;
      case 't':
        if (e.ctrlKey) {
          e.preventDefault();
          this.toggleAlwaysOnTop();
        }
        break;
      case 'g':
        if (e.ctrlKey) {
          e.preventDefault();
          this.toggleMenuBarDisplay();
        }
        break;
      case 'b':
        if (e.ctrlKey) {
          e.preventDefault();
          this.onBlacklist();
        }
        break;
      case 'Delete':
        if (!this.state.drawerHover || focus != "input") {
          if (this.props.config.caching.enabled) {
            e.preventDefault();
            this.onDelete();
          }
        }
        break;
      case '[':
        if (!this.props.scene.downloadScene && !this.props.scene.audioScene && !this.props.scene.scriptScene && this.props.allTags != null) {
          e.preventDefault();
          this.prevSource();
        }
        break;
      case ']':
        if (!this.props.scene.downloadScene && !this.props.scene.audioScene && !this.props.scene.scriptScene && this.props.allTags != null) {
          e.preventDefault();
          this.nextSource();
        }
        break;
    }
  };

  orderAudioTags(audio: Audio) {
    const tagNames = this.props.allTags.map((t: Tag) => t.name);
    audio.tags = audio.tags.sort((a: Tag, b: Tag) => {
      const aIndex = tagNames.indexOf(a.name);
      const bIndex = tagNames.indexOf(b.name);
      if (aIndex < bIndex) {
        return -1;
      } else if (aIndex > bIndex) {
        return 1;
      } else {
        return 0;
      }
    });
  }

  setPlayPause(play: boolean) {
    if (play) {
      this.props.play()
    } else {
      this.props.pause()
    }
  }

  setAlwaysOnTop(alwaysOnTop: boolean){
    this.props.config.displaySettings.alwaysOnTop = alwaysOnTop;
  }

  navigateBack() {
    if (isFullscreen()) {
      exitFullscreen();
    }
    this.props.goBack();
  }

  async copyImageToClipboard(sourceURL: string) {
    let url = sourceURL;
    if (!url) {
      url = this.props.historyPaths[(this.props.historyPaths.length - 1) + this.props.historyOffset].url;
    }
    const isRemote = /^https?:\/\//g.exec(url) != null;
    const isBlob = url.startsWith("blob:") || url.startsWith("data:");
    const imagePath = isRemote || isBlob ? url : urlToPath(url);
    if (imagePath.toLocaleLowerCase().endsWith(".png") || imagePath.toLocaleLowerCase().endsWith(".jpg") || imagePath.toLocaleLowerCase().endsWith(".jpeg")) {
      if (!isRemote) {
        await copyPath(imagePath);
      } else {
        try {
          const blob = await wretch(imagePath).get().blob();
          if (blob && blob.type && blob.type.startsWith("image/")) {
            await copyBlob(blob);
          } else {
            await copyText(imagePath);
          }
        } catch (e) {
          console.error(e);
          await copyText(imagePath);
        }
      }
    } else {
      await copyText(imagePath);
    }
  }

  onDelete() {
    if (!this.state.drawerHover || document.activeElement.tagName.toLocaleLowerCase() != "input") {
      const img = this.props.historyPaths[(this.props.historyPaths.length - 1) + this.props.historyOffset];
      const url = img.url;
      const isFile = url.startsWith('file://');
      const path = urlToPath(url);
      if (isFile) {
        this.onDeletePath(path);
      }
    }
  }

  onBlacklist() {
    const img = this.props.historyPaths[(this.props.historyPaths.length - 1) + this.props.historyOffset];
    if (img == null) return;
    const source = img.source;
    const url = img.url;
    const isFile = url.startsWith('file://');
    const path = urlToPath(url);
    const type = getSourceType(source);
    if ((!isFile && type != ST.video && type != ST.playlist) || type == ST.local) {
      this.onBlacklistFile(source, isFile ? path : url);
    }
  }

  playPause() {
    if (!this.state.drawerHover || document.activeElement.tagName.toLocaleLowerCase() != "input") {
      this.setPlayPause(!this.props.isPlaying)
    }
  }

  toggleAlwaysOnTop() {
    this.setAlwaysOnTop(!this.props.config.displaySettings.alwaysOnTop);
  }

  toggleMenuBarDisplay() {
    this.setMenuBarVisibility(!this.props.config.displaySettings.showMenu);
  }

  toggleFullscreen() {
    this.setFullscreen(!this.props.config.displaySettings.fullScreen);
  }

  prevSource() {
    this.props.navigateTagging(-1);
  }

  nextSource() {
    this.props.navigateTagging(1);
  }
}

(PlayerBars as any).displayName="PlayerBars";
export default PlayerBars;
