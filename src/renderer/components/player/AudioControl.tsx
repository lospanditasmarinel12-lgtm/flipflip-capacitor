import * as React from "react";
import SoundBase from "react-sound";
const Sound = SoundBase as any;
import Timeout = NodeJS.Timeout;

import { Collapse, Grid, IconButton, Slider, Tooltip, Typography } from "@mui/material";

import { styled } from "@mui/material/styles";

import Forward10Icon from '@mui/icons-material/Forward10';
import Forward5Icon from '@mui/icons-material/Forward5';
import Replay10Icon from '@mui/icons-material/Replay10';
import Replay5Icon from '@mui/icons-material/Replay5';
import PauseIcon from '@mui/icons-material/Pause';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import SkipNextIcon from '@mui/icons-material/SkipNext';
import SkipPreviousIcon from '@mui/icons-material/SkipPrevious';
import VolumeDownIcon from '@mui/icons-material/VolumeDown';
import VolumeUpIcon from '@mui/icons-material/VolumeUp';

import {getMsRemainder, getTimestamp} from "../../data/utils";
import {RP, TF} from "../../data/const";
import Audio from "../../data/Audio";
import SoundTick from "./SoundTick";
import { HapticService } from '../../data/haptics';
import { toWebViewUrl } from "../../services/media-urls";
import { createNativeAudioService } from "../../services/native-audio";
import { useStore } from "../../stores/flipflipStore";

const isCapacitorNative = typeof window !== 'undefined' && !!(window as any).Capacitor;

const NoTransitionSlider = styled(Slider)({
  '& .MuiSlider-thumb': { transition: 'unset' },
  '& .MuiSlider-track': { transition: 'unset' },
});

function getTimestampFromMs(ms: number): string {
  const secs = Math.floor(ms / 1000);
  return getTimestamp(secs);
}

class AudioControl extends React.Component {
  readonly props: {
    audio: Audio,
    audioEnabled: boolean,
    singleTrack: boolean,
    lastTrack: boolean,
    repeat: string,
    scenePaths: Array<any>,
    startPlaying: boolean,
    shorterSeek?: boolean,
    showMsTimestamp?: boolean,
    onAudioSliderChange(e: MouseEvent, value: number): void,
    nextTrack?(): void,
    prevTrack?(): void,
    goBack?(): void,
    onPlaying?(position: number, duration: number): void,
    playTrack?(url: string): void,
    playNextScene?(): void,
  };

  readonly state = {
    playing: this.props.startPlaying,
    position: 0,
    duration: 0,
    tick: false,
  };

  private _playUrl: string | null = null;
  private _audioElement: HTMLAudioElement | null = null;
  private _lastAnalysisTrigger: number | null = null;

  // Native (background-safe) playback engine — enabled via
  // config.generalSettings.nativeAudioPlayback. Default OFF (unchanged behavior).
  private _nativeMode = false;
  private _nativeSvc: ReturnType<typeof createNativeAudioService> | null = null;
  private _nativeCleanup: Array<() => void> = [];
  private _nativeLoadedUrl: string | null = null;
  private _nativeMeterSubscribed = false;
  // While a track is being (re)loaded the plugin legitimately reports a
  // not-playing state; a "playing:false" report in this window is NOT a user
  // pause and must not cancel a pending autoplay.
  private _nativeLoading = false;

  render() {
    const audio = this.props.audio;
    const playing = this.state.playing
      ? (Sound as any).status.PLAYING
      : (Sound as any).status.PAUSED;

    const audioVolume = typeof audio.volume === 'number' ? audio.volume : 0;
    let msRemainder = undefined;
    if (this.props.showMsTimestamp) {
      msRemainder = getMsRemainder(this.state.position);
      if (msRemainder == ".000") {
        msRemainder = undefined;
      }
    }
    return (
      <React.Fragment key={audio.id}>
        <div style={{ display: 'none' }}>
        {!this._nativeMode && this.props.audioEnabled && this.props.audio.tick && this.state.playing && (
          <SoundTick
            url={this._playUrl || this.props.audio.url}
            playing={playing}
            speed={this.props.audio.speed / 10}
            volume={this.props.audio.volume}
            tick={this.state.tick}
            onPlaying={this.onPlaying.bind(this)}
            onError={this.onError.bind(this)}
            onFinishedPlaying={this.onFinishedPlaying.bind(this)}
          />
        )}
        {!this._nativeMode && this.props.audioEnabled && !this.props.audio.tick && (
          <Sound
            url={this._playUrl || this.props.audio.url}
            playStatus={playing}
            playbackRate={this.props.audio.speed / 10}
            volume={this.props.audio.volume}
            position={this.state.position}
            onPlaying={this.onPlaying.bind(this)}
            onError={this.onError.bind(this)}
            onFinishedPlaying={this.onFinishedPlaying.bind(this)}
          />
        )}
        </div>
        <Grid item xs={12} sx={!this.props.audioEnabled ? { padding: '0 !important' } : undefined}>
          <Collapse in={this.props.audioEnabled} sx={{ width: '100%' }}>
            <Grid container spacing={2} alignItems="center">
              <Grid item xs={12}>
                <Grid container spacing={1} alignItems="center" justifyContent="center">
                  <Grid item xs={12} sm={12}>
                    <Grid container spacing={1} alignItems="center">
                      <Grid item>
                        <Typography variant="caption" component="div" color="textSecondary">
                          {getTimestampFromMs(this.state.position)}
                        </Typography>
                      </Grid>
                      <Grid item xs>
                        <NoTransitionSlider
                          valueLabelDisplay={msRemainder ? "auto" : "off"}
                          valueLabelFormat={msRemainder}
                          value={this.state.position}
                          max={this.state.duration}
                          onChange={this.onChangePosition.bind(this)}/>
                      </Grid>
                      <Grid item>
                        <Typography variant="caption" component="div" color="textSecondary">
                          {getTimestampFromMs(this.state.duration)}
                        </Typography>
                      </Grid>
                    </Grid>
                  </Grid>
                  <Grid item>
                    {this.props.prevTrack && (
                      <Tooltip disableInteractive title="Prev Track">
                        <IconButton onClick={this.props.prevTrack.bind(this)} size="large">
                          <SkipPreviousIcon />
                        </IconButton>
                      </Tooltip>
                    )}
                    <Tooltip disableInteractive title="Jump Back">
                      <IconButton onClick={this.onBack.bind(this)} size="large">
                        {this.props.shorterSeek ? <Replay5Icon /> : <Replay10Icon />}
                      </IconButton>
                    </Tooltip>
                    <Tooltip disableInteractive title={this.state.playing ? "Pause" : "Play"}>
                      <IconButton
                        onClick={this.state.playing ? this.onPause.bind(this) : this.onPlay.bind(this)}
                        size="large">
                        {this.state.playing ? <PauseIcon/> : <PlayArrowIcon/>}
                      </IconButton>
                    </Tooltip>
                    <Tooltip disableInteractive title="Jump Forward">
                      <IconButton onClick={this.onForward.bind(this)} size="large">
                        {this.props.shorterSeek ? <Forward5Icon /> : <Forward10Icon />}
                      </IconButton>
                    </Tooltip>
                    {this.props.nextTrack && (
                      <Tooltip disableInteractive title="Next Track">
                        <IconButton onClick={this.props.nextTrack.bind(this)} size="large">
                          <SkipNextIcon />
                        </IconButton>
                      </Tooltip>
                    )}
                  </Grid>
                </Grid>
              </Grid>
              <Grid item xs={12}>
                <Grid container spacing={1} alignItems="center">
                  <Grid item>
                    <VolumeDownIcon />
                  </Grid>
                  <Grid item xs>
                    <Slider value={audioVolume}
                            onChange={this.onAudioSliderChange.bind(this)}
                            aria-labelledby="audio-volume-slider" />
                  </Grid>
                  <Grid item>
                    <VolumeUpIcon />
                  </Grid>
                </Grid>
              </Grid>
            </Grid>
          </Collapse>
        </Grid>
      </React.Fragment>
    );
  }

  _timeout: Timeout = null;
  _queueNextTrack = false;

  _resolvePlayUrl() {
    const url = this.props.audio.url;
    toWebViewUrl(url).then((resolved) => {
      this._playUrl = resolved;
      this.forceUpdate();
    });
  }

  componentDidMount() {
    this._nativeMode = isCapacitorNative && !!useStore.getState()?.config?.generalSettings?.nativeAudioPlayback && !this.props.audio.tick;
    this.initNativePlayback();
    if (this.state.playing) {
      this.tickLoop(true);
    }
    this._queueNextTrack = false;
    this._resolvePlayUrl();
    if (this._audioElement) {
      HapticService.getInstance().startAnalysis(this._audioElement);
    }
  }

  async initNativePlayback() {
    if (!this._nativeMode || this._nativeSvc) return;
    this._nativeSvc = createNativeAudioService();
    this._nativeCleanup = [];
    try {
      const un = await this._nativeSvc.onState((st) => this.onNativeState(st));
      this._nativeCleanup.push(un);
    } catch (e) {}
    this._nativeSvc.onMeter((frame) => this.onNativeMeter(frame)).then((un) => this._nativeCleanup.push(un)).catch(() => {});
    await this.nativeLoad(this._playUrl || this.props.audio.url);
    if (this.state.playing) {
      this._nativeSvc?.play().catch(() => {});
    }
  }

  async nativeLoad(url: string) {
    if (!this._nativeSvc || !this._nativeMode || !url) return;
    if (this._nativeLoadedUrl === url) return;
    this._nativeLoadedUrl = url;
    this._nativeMeterSubscribed = false;
    const volume = typeof this.props.audio.volume === 'number' ? this.props.audio.volume : 1;
    this._nativeLoading = true;
    try {
      await this._nativeSvc.load(url, false, volume);
    } catch (e) {
      console.warn('[NativeAudio] load failed:', e);
      this._nativeLoadedUrl = null;
    } finally {
      this._nativeLoading = false;
    }
  }

  applyNativeVolume() {
    const volume = typeof this.props.audio.volume === 'number' ? this.props.audio.volume : 1;
    this._nativeSvc?.setVolume(volume).catch(() => {});
  }

  onNativeState(st: any) {
    if (!this._nativeMode) return;
    const prevPlaying = this.state.playing;
    if (st.ended) {
      this.setState({ playing: false, position: 0, duration: st.duration || this.state.duration });
      this.onFinishedPlaying();
      return;
    }
    this.setState({
      playing: !!st.playing,
      position: st.position || 0,
      duration: st.duration > 0 ? st.duration : this.state.duration,
    });
    if (this.props.onPlaying) {
      this.props.onPlaying(st.position || 0, st.duration || 0);
    }
    if (prevPlaying && !st.playing && !this._nativeLoading) {
      this.onPause();
    }
  }

  onNativeMeter(frame: any) {
    if (!this._nativeMode || this._nativeMeterSubscribed) return;
    const svc = HapticService.getInstance();
    if (!svc.isConnected() || !svc.hasDevices()) return;
    this._nativeMeterSubscribed = true;
    HapticService.getInstance().startAnalysisFromPlayback((cb) => {
      let unsub = () => {};
      this._nativeSvc?.onMeter((f: any) => cb({
        rms: f.rms,
        rmsRaw: f.rmsRaw,
        spectrum: f.spectrum || [],
        sampleRate: f.sampleRate || 44100,
        waveform: undefined,
      })).then((u) => { unsub = u; }).catch(() => {});
      return () => { try { unsub(); } catch (_) {} };
    });
  }

  componentDidUpdate(props: any, state: any) {
    if (this.props.audio.url != props.audio.url) {
      this.setState({position: 0, duration: 0});
      this._resolvePlayUrl();
      if (this._nativeMode) {
        this._nativeLoadedUrl = null;
        this.nativeLoad(this._playUrl || this.props.audio.url);
        // Autoplay the new track once it's loaded (pendingPlay in the native
        // service replays this if `load` is still resolving the URL).
        if (this.state.playing) {
          this._nativeSvc?.play().catch(() => {});
        }
      }
    }
    if ((this.props.audio.tick && !props.audio.tick) ||
      (this.props.audio.tick && props.audio.tickMode == TF.scene && this.props.audio.tickMode != TF.scene)){
      this.tickLoop(true);
    }
    if (this.state.playing != state.playing) {
      if (this.state.playing && this.props.audio.tick && this.props.audio.tickMode != TF.scene) {
        this.tickLoop(true)
      } else {
        clearTimeout(this._timeout);
      }
    }
    if (this.props.audio.tick && this.props.audio.tickMode == TF.scene && props.scenePaths && props.scenePaths.length > 0 && props.scenePaths !== this.props.scenePaths) {
      if (this._queueNextTrack) {
        this._queueNextTrack = false;
        this.props.nextTrack();
        this.setState({tick: !this.state.tick, position: 0, duration: 0});
      } else {
        this.setState({tick: !this.state.tick});
      }
    }
  }

  componentWillUnmount() {
    if(this._timeout != null) {
      clearTimeout(this._timeout);
    }
    this._queueNextTrack = null;
    this._audioElement = null;
    if (this._nativeSvc) {
      this._nativeCleanup.forEach((fn) => { try { fn(); } catch (_) {} });
      this._nativeCleanup = [];
      this._nativeSvc.dispose().catch(() => {});
      this._nativeSvc = null;
    }
    HapticService.getInstance().stopAnalysis();
  }

  tickLoop(starting: boolean = false) {
    if (!starting) {
      if (this._queueNextTrack) {
        this._queueNextTrack = false;
        this.props.nextTrack();
        this.setState({tick: !this.state.tick, position: 0, duration: 0});
      } else {
        this.setState({tick: !this.state.tick});
      }
    }
    if (this.props.audio.tick) {
      let timeout: number = null;
      switch (this.props.audio.tickMode) {
        case TF.random:
          timeout = Math.floor(Math.random() * (this.props.audio.tickMaxDelay - this.props.audio.tickMinDelay + 1)) + this.props.audio.tickMinDelay;
          break;
        case TF.sin:
          const sinRate = (Math.abs(this.props.audio.tickSinRate - 100) + 2) * 1000;
          timeout = Math.floor(Math.abs(Math.sin(Date.now() / sinRate)) * (this.props.audio.tickMaxDelay - this.props.audio.tickMinDelay + 1)) + this.props.audio.tickMinDelay;
          break;
        case TF.constant:
          timeout = this.props.audio.tickDelay;
          break;
        case TF.bpm:
          const bpmMulti = this.props.audio.tickBPMMulti / 10;
          timeout = 60000 / (this.props.audio.bpm * bpmMulti);
          if (!timeout) {
            timeout = 1000;
          }
          break;
      }
      if (timeout != null) {
        this._timeout = setTimeout(this.tickLoop.bind(this), timeout);
        return
      }
    }
    this._timeout = null;
  }

  onChangePosition(e: MouseEvent, value: number) {
    this.setState({position: value});
    if (this._nativeMode) {
      this._nativeSvc?.seekTo(value).catch(() => {});
    }
  }

  onAudioSliderChange(e: MouseEvent, value: number) {
    this.props.audio.volume = value;
    if (this._nativeMode) {
      this._nativeSvc?.setVolume(value).catch(() => {});
    }
    this.props.onAudioSliderChange(e, value);
  }

  onFinishedPlaying() {
    if (this.props.playTrack) {
      this.props.playTrack(this.props.audio.url);
    }

    if (this.props.audio.stopAtEnd && this.props.goBack) {
      this.props.goBack();
    } else if (this.props.audio.nextSceneAtEnd && this.props.playNextScene) {
      this.props.playNextScene();
      this.setState({position: 0, duration: 0});
    } else {
      if (this.props.repeat == RP.all) {
        if (this.props.audio.tick) {
          this._queueNextTrack = true;
        } else {
          if (this.props.singleTrack) {
            this.setState({position: 1});
          } else {
            this.props.nextTrack();
            this.setState({position: 0, duration: 0});
          }
        }
      } else if (this.props.repeat == RP.one) {
        this.setState({position: 1});
      } else if (this.props.repeat == RP.none) {
        if (!this.props.lastTrack) {
          if (this.props.audio.tick) {
            this._queueNextTrack = true;
          } else {
            this.props.nextTrack();
            this.setState({position: 0, duration: 0});
          }
        } else {
          this.setState({playing: false});
        }
      }
    }
  }

  onPlaying(soundData: any) {
    let position = this.state.position;
    let duration = this.state.duration;
    if (soundData.position) {
      position = soundData.position;
    }
    if (soundData.duration) {
      duration = soundData.duration;
    }
    if (this.props.onPlaying) {
      this.props.onPlaying(position, duration)
    }
    this.setState({position: position , duration: duration});

    const audioEl = (soundData?._a ?? soundData?._s ?? soundData) as any;
    if (audioEl && audioEl instanceof HTMLMediaElement) {
      const elementChanged = audioEl !== this._audioElement;
      if (elementChanged) {
        this._audioElement = audioEl as HTMLAudioElement;
        console.log('[Haptic] onPlaying element captured:', (audioEl as HTMLAudioElement).src?.slice(-60));
      }
      const svc = HapticService.getInstance();
      // Always record the element so a later toy connect can start analysis on
      // the already-playing track.
      svc.recordElement(audioEl as HTMLAudioElement);
      const now = Date.now();
      // In system-audio mode the native capture runs independently of the scene
      // element; re-invoking startAnalysis every `>1000ms` tick was tearing the
      // capture down and rebuilding it each second (source status never LATched
      // LIVE). Only (re)start on an actual element change here; the capture is
      // otherwise managed by the System Audio toggle.
      const systemAudio = svc.isSystemAudioEnabled();
      if (svc.hasDevices() && (elementChanged || (!systemAudio && (!this._lastAnalysisTrigger || now - this._lastAnalysisTrigger > 1000)))) {
        this._lastAnalysisTrigger = now;
        svc.startAnalysis(audioEl as HTMLAudioElement);
      }
    } else {
      console.warn('[Haptic] onPlaying: no HTMLMediaElement found in soundData', Object.keys(soundData || {})?.slice(0, 10));
    }
  }

  onError(errorCode: number, description: string) {
    console.error(errorCode + " - " + description);
  }

  onPlay() {
    this.setState({playing: true});
    if (this._nativeMode) {
      this._nativeSvc?.play().catch(() => {});
    }
  }

  onPause() {
    this.setState({playing: false});
    if (this._nativeMode) {
      this._nativeSvc?.pause().catch(() => {});
    }
  }

  onBack() {
    const amount = this.props.shorterSeek ? 5000 : 10000;
    let position = this.state.position - amount;
    if (position < 0) {
      position = 0;
    }
    this.setState({position: position});
    if (this._nativeMode) {
      this._nativeSvc?.seekTo(position).catch(() => {});
    }
  }

  onForward() {
    const amount = this.props.shorterSeek ? 5000 : 10000;
    let position = this.state.position + amount;
    if (position > this.state.duration) {
      position = this.state.duration;
    }
    this.setState({position: position});
    if (this._nativeMode) {
      this._nativeSvc?.seekTo(position).catch(() => {});
    }
  }
}

(AudioControl as any).displayName="AudioControl";
export default AudioControl;
