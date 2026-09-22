import * as React from "react";

import {syncPathExists} from "../../services/local-paths";
import {openExternal, revealFile} from "../../services/links";

import {
  Avatar,
  Badge,
  Box,
  Chip,
  Divider,
  Fab,
  IconButton,
  List,
  ListItem,
  ListItemAvatar,
  ListItemIcon,
  ListItemSecondaryAction,
  ListItemText,
  Menu,
  MenuItem,
  Tooltip,
  Typography,
} from "@mui/material";

import { styled } from "@mui/material/styles";

import AddIcon from "@mui/icons-material/Add";
import AudiotrackIcon from "@mui/icons-material/Audiotrack";
import ClearIcon from "@mui/icons-material/Clear";
import MoreVertIcon from '@mui/icons-material/MoreVert';
import RepeatIcon from '@mui/icons-material/Repeat';
import RepeatOneIcon from '@mui/icons-material/RepeatOne';
import ShuffleIcon from '@mui/icons-material/Shuffle';

import {abbreviateName, arrayMove, getTimestamp, randomizeList} from "../../data/utils";
import {RP} from "../../data/const";
import AudioControl from "./AudioControl";
import Audio from "../../data/Audio";
import Scene from "../../data/Scene";
import Tag from "../../data/Tag";
import SourceIcon from "../library/SourceIcon";
import MediaPreviewDialog from "../library/MediaPreviewDialog";
import MoveToIndexDialog from "../library/MoveToIndexDialog";

const AudioList = styled('div')({
  paddingLeft: 0,
});

const MediaIcon = styled(AudiotrackIcon)({
  width: '100%',
  height: 'auto',
});

const ThumbAvatar = styled(Avatar)(({ theme }) => ({
  width: theme.spacing(6),
  height: theme.spacing(6),
}));

const PlaylistAction = styled('div')({
  textAlign: 'center',
});

const LeftFloat = styled('div')(({ theme }) => ({
  float: 'left',
  paddingLeft: theme.spacing(2),
}));

const RightFloat = styled('div')(({ theme }) => ({
  float: 'right',
  paddingRight: theme.spacing(2),
}));

const TrackThumb = styled('div')({
  height: 40,
  width: 40,
  overflow: 'hidden',
  display: 'flex',
  justifyContent: 'center',
  cursor: 'pointer',
  userSelect: 'none',
});

const ThumbImage = styled('img')({
  height: '100%',
});

const ListAvatar = styled(ListItemAvatar)({
  width: 56,
});

const BigTooltip = styled(Tooltip)({
  '& .MuiTooltip-tooltip': {
    fontSize: "medium",
    maxWidth: 500,
  },
});

const TagChips = styled('div')({
  textAlign: 'center',
});

const AvatarFab = styled(Fab)(({ theme }) => ({
  backgroundColor: theme.palette.primary.main,
  boxShadow: 'none',
}));

const SourceIconStyled = styled(SourceIcon)<{ url?: string }>(({ theme }) => ({
  color: theme.palette.primary.contrastText,
}));

class AudioPlaylist extends React.Component {
  readonly props: {
    playlistIndex: number,
    playlist: { audios: Array<Audio>, shuffle: boolean, repeat: string },
    scene: Scene,
    sidebar: boolean,
    startPlaying: boolean,
    onAddTracks(playlistIndex: number): void,
    onSourceOptions(playlistIndex: number, audio: Audio): void,
    onUpdateScene(scene: Scene, fn: (scene: Scene) => void): void,
    persist?: boolean,
    shorterSeek?: boolean,
    showMsTimestamp?: boolean,
    scenePaths?: Array<any>,
    goBack?(): void,
    orderAudioTags?(audio: Audio): void,
    onPlay?(source: Audio, displaySources: Array<Audio>): void,
    onPlaying?(position: number, duration: number): void,
    playTrack?(url: string): void,
    playNextScene?(): void,
    setCurrentAudio?(audio: Audio): void,
    systemMessage?(message: string): void,
  };

  readonly state = {
    currentIndex: this.props.playlistIndex == 0 ? this.props.scene.audioStartIndex : 0,
    playingAudios: Array<Audio>(),
    menu: null as { trackIndex: number, anchorEl: any } | null,
    previewIndex: null as number,
    moveIndex: null as number,
  }

  render() {
    if (this.props.startPlaying) {
      let audio = this.state.playingAudios[this.state.currentIndex];
      if (!audio) audio = this.props.playlist.audios[this.state.currentIndex];
      if (!audio) return <div/>;
      return (
        <React.Fragment>
          <ListItem disableGutters>
            <ListItemIcon>
              <ThumbAvatar alt={audio.name} src={audio.thumb}>
                {audio.thumb == null && (
                  <MediaIcon/>
                )}
              </ThumbAvatar>
            </ListItemIcon>
            <ListItemText primary={audio.name} />
          </ListItem>
          <AudioControl
            audio={audio}
            audioEnabled={this.props.scene.audioEnabled || this.props.persist}
            singleTrack={this.state.playingAudios.length == 1}
            lastTrack={this.state.currentIndex == this.state.playingAudios.length - 1}
            repeat={this.props.playlist.repeat}
            scenePaths={this.props.scenePaths}
            shorterSeek={this.props.shorterSeek}
            showMsTimestamp={this.props.showMsTimestamp}
            startPlaying={this.props.startPlaying}
            playTrack={this.props.playTrack}
            nextTrack={this.nextTrack.bind(this)}
            prevTrack={this.prevTrack.bind(this)}
            onPlaying={this.props.onPlaying}
            onAudioSliderChange={this.onAudioSliderChange.bind(this)}
            goBack={this.props.goBack}
            playNextScene={this.props.playNextScene}/>
          <PlaylistAction>
            <Tooltip disableInteractive title={"Shuffle " + (this.props.playlist.shuffle ? "(On)" : "(Off)")}>
              <IconButton onClick={this.toggleShuffle.bind(this)} size="large">
                <ShuffleIcon color={this.props.playlist.shuffle ? "primary" : undefined}/>
              </IconButton>
            </Tooltip>
            <Tooltip disableInteractive title={"Repeat " + (this.props.playlist.repeat == RP.none ? "(Off)" : this.props.playlist.repeat == RP.all ? "(All)" : "(One)")}>
              <IconButton onClick={this.changeRepeat.bind(this)} size="large">
                {this.props.playlist.repeat == RP.none && (
                  <RepeatIcon />
                )}
                {this.props.playlist.repeat == RP.all && (
                  <RepeatIcon color={"primary"}/>
                )}
                {this.props.playlist.repeat == RP.one && (
                  <RepeatOneIcon color={"primary"} />
                )}
              </IconButton>
            </Tooltip>
          </PlaylistAction>
        </React.Fragment>
      );
    } else {
      return (
        <List disablePadding>
          <div className="audioList">
            {this.props.playlist && this.props.playlist.audios && this.props.playlist.audios.map((a, i) =>
              <ListItem key={i}>
                <ListAvatar>
                  <Badge
                    invisible={!a.trackNum}
                    max={999}
                    overlap="rectangular"
                    color="primary"
                    badgeContent={a.trackNum}>
                    {a.comment ? (
                      <BigTooltip disableInteractive placement={a.comment ? 'right' : 'bottom'}
                                  arrow={!!a.comment || (a.tags && a.tags.length > 0)}
                                  title={
                                    <div>
                                      {a.comment}
                                      {a.comment && a.tags && a.tags.length > 0 && (<br/>)}
                                      <TagChips>
                                        {a.tags && a.tags.map((tag: Tag) =>
                                          <React.Fragment key={tag.id}>
                                            <Chip
                                              label={tag.name}
                                              color="primary"
                                              size="small"/>
                                          </React.Fragment>
                                        )}
                                      </TagChips>
                                    </div>
                                  }>
                        <TrackThumb onClick={this.onSourceIconClick.bind(this, a)}>
                          {a.thumb != null && (
                            <ThumbImage src={a.thumb}/>
                          )}
                          {a.thumb == null && (
                            <AvatarFab
                              size="small">
                              <SourceIconStyled url={a.url}/>
                            </AvatarFab>
                          )}
                        </TrackThumb>
                      </BigTooltip>
                    ) : (
                      <Tooltip disableInteractive placement={'bottom'}
                               arrow={!!a.comment || (a.tags && a.tags.length > 0)}
                               title={
                                 <div>
                                   &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Click: Preview
                                   <br/>
                                   Shift+Click: Open Source
                                   <br/>
                                   &nbsp;&nbsp;Ctrl+Click: Reveal File
                                 </div>
                               }>
                        <TrackThumb onClick={this.onSourceIconClick.bind(this, a)}>
                          {a.thumb != null && (
                            <ThumbImage src={a.thumb}/>
                          )}
                          {a.thumb == null && (
                            <AvatarFab
                              size="small">
                              <SourceIconStyled url={a.url}/>
                            </AvatarFab>
                          )}
                        </TrackThumb>
                      </Tooltip>
                    )}
                  </Badge>
                </ListAvatar>
                <ListItemText
                  primary={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, width: '100%', overflow: 'hidden', minWidth: 0 }}>
                      <Typography color="textSecondary" sx={{ userSelect: 'none', flex: '0 0 auto' }}>
                        {i + 1}.
                      </Typography>
                      <Typography noWrap sx={{ flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', userSelect: 'none' }} title={a.name}>
                        {abbreviateName(a.name)}
                      </Typography>
                    </Box>
                  }/>
                <ListItemSecondaryAction>
                  <IconButton
                    edge="end"
                    size="large"
                    aria-label="options"
                    onClick={this.openMenu.bind(this, i)}>
                    <MoreVertIcon/>
                  </IconButton>
                </ListItemSecondaryAction>
              </ListItem>
            )}
          </div>
          {this.state.menu && (
            <Menu
              anchorEl={this.state.menu.anchorEl}
              keepMounted
              open={true}
              onClose={this.closeMenu.bind(this)}>
              <MenuItem onClick={this.play.bind(this, this.state.menu.trackIndex)}>
                Play
              </MenuItem>
              <MenuItem onClick={this.preview.bind(this, this.state.menu.trackIndex)}>
                Preview
              </MenuItem>
              <MenuItem
                disabled={this.state.menu.trackIndex <= 0}
                onClick={this.moveDelta.bind(this, this.state.menu.trackIndex, -1)}>
                Move Up
              </MenuItem>
              <MenuItem
                disabled={this.state.menu.trackIndex >= this.props.playlist.audios.length - 1}
                onClick={this.moveDelta.bind(this, this.state.menu.trackIndex, 1)}>
                Move Down
              </MenuItem>
              <MenuItem
                disabled={this.state.menu.trackIndex <= 0}
                onClick={this.moveToTop.bind(this, this.state.menu.trackIndex)}>
                Move to Top
              </MenuItem>
              <MenuItem
                disabled={this.state.menu.trackIndex >= this.props.playlist.audios.length - 1}
                onClick={this.moveToBottom.bind(this, this.state.menu.trackIndex)}>
                Move to Bottom
              </MenuItem>
              <MenuItem onClick={this.openMoveIndex.bind(this, this.state.menu.trackIndex)}>
                Move to a Index
              </MenuItem>
              <Divider/>
              <MenuItem onClick={this.options.bind(this, this.state.menu.trackIndex)}>
                Source Options…
              </MenuItem>
              <Divider/>
              <MenuItem onClick={this.remove.bind(this, this.state.menu.trackIndex)}>
                Delete
              </MenuItem>
            </Menu>
          )}
          {this.state.moveIndex != null && (
            <MoveToIndexDialog
              open={true}
              title="Move track to index"
              max={this.props.playlist.audios.length}
              onClose={this.closeMoveIndex.bind(this)}
              onConfirm={this.confirmMoveIndex.bind(this)}/>
          )}
          {this.state.previewIndex != null && this.props.playlist.audios[this.state.previewIndex] && (
            <MediaPreviewDialog
              open={true}
              url={this.props.playlist.audios[this.state.previewIndex].url}
              label={this.props.playlist.audios[this.state.previewIndex].name}
              onClose={this.closePreview.bind(this)}/>
          )}
          <PlaylistAction>
            <LeftFloat>
              <Tooltip disableInteractive title={"Shuffle " + (this.props.playlist.shuffle ? "(On)" : "(Off)")}>
                <IconButton onClick={this.toggleShuffle.bind(this)} size="large">
                  <ShuffleIcon color={this.props.playlist.shuffle ? "primary" : undefined}/>
                </IconButton>
              </Tooltip>
              <Tooltip disableInteractive title={"Repeat " + (this.props.playlist.repeat == RP.none ? "(Off)" : this.props.playlist.repeat == RP.all ? "(All)" : "(One)")}>
                <IconButton onClick={this.changeRepeat.bind(this)} size="large">
                  {this.props.playlist.repeat == RP.none && (
                    <RepeatIcon />
                  )}
                  {this.props.playlist.repeat == RP.all && (
                    <RepeatIcon color={"primary"}/>
                  )}
                  {this.props.playlist.repeat == RP.one && (
                    <RepeatOneIcon color={"primary"} />
                  )}
                </IconButton>
              </Tooltip>
            </LeftFloat>
            <Tooltip disableInteractive title="Add Tracks">
              <IconButton
                onClick={this.props.onAddTracks.bind(this, this.props.playlistIndex)}
                size="large">
                <AddIcon/>
              </IconButton>
            </Tooltip>
            <RightFloat>
              <Chip
                label={getTimestamp(this.props.playlist.audios.reduce((total, a) => total + a.duration, 0))}
                color='default'
                size='small'
                variant='outlined'/>
              <Tooltip disableInteractive title="Remove Playlist">
                <IconButton onClick={this.removePlaylist.bind(this)} size="large">
                  <ClearIcon color={"error"}/>
                </IconButton>
              </Tooltip>
            </RightFloat>
          </PlaylistAction>
        </List>
      );
    }
  }

  componentDidUpdate(props: any, state: any) {
    if (!this.props.persist && this.props.scene !== props.scene) {
      this.restart();
    }
  }

  componentDidMount() {
    if (this.props.playlistIndex == 0 && this.props.scene.audioScene) {
      window.addEventListener('keydown', this.onKeyDown, false);
    }
    this.restart();
  }

  restart() {
    let audios = this.props.playlist.audios;
    if (this.props.startPlaying && this.state.playingAudios.length == 0) {
      if (this.props.playlist.shuffle) {
        audios = randomizeList(Array.from(audios));
      }
      this.setState({playingAudios: audios});
    }
    if (this.props.setCurrentAudio) {
      let audio = audios[this.state.currentIndex];
      if (!audio) audio = this.props.playlist.audios[this.state.currentIndex];
      this.props.setCurrentAudio(audio);
    }
  }

  componentWillUnmount() {
    if (this.props.playlistIndex == 0 && this.props.scene.audioScene) {
      window.removeEventListener('keydown', this.onKeyDown);
    }
  }

  onKeyDown = (e: KeyboardEvent) => {
    switch (e.key) {
      case '[':
        e.preventDefault();
        this.props.orderAudioTags(this.props.playlist.audios[this.state.currentIndex]);
        this.prevTrack();
        break;
      case ']':
        e.preventDefault();
        this.props.orderAudioTags(this.props.playlist.audios[this.state.currentIndex]);
        this.nextTrack();
        break;
    }
  }

  onSourceIconClick(audio: Audio, e: MouseEvent) {
    const sourceURL = audio.url;
    if (e.shiftKey && !e.ctrlKey) {
      this.openExternalURL(sourceURL);
    } else if (!e.shiftKey && e.ctrlKey) {
      if (syncPathExists(sourceURL)) {
        revealFile(sourceURL);
      }
    } else if (!e.shiftKey && !e.ctrlKey) {
      this.preview(this.props.playlist.audios.indexOf(audio));
    }
  }

  openExternalURL(url: string) {
    openExternal(url);
  }

  prevTrack() {
    let prevTrack = this.state.currentIndex - 1;
    if (prevTrack < 0) {
      prevTrack = this.state.playingAudios.length - 1;
    }
    if (this.props.setCurrentAudio) {
      this.props.setCurrentAudio(this.state.playingAudios[prevTrack]);
    }
    this.setState({currentIndex: prevTrack});
  }

  nextTrack() {
    let nextTrack = this.state.currentIndex + 1;
    if (nextTrack >= this.state.playingAudios.length) {
      nextTrack = 0;
    }
    if (this.props.setCurrentAudio) {
      this.props.setCurrentAudio(this.state.playingAudios[nextTrack]);
    }
    this.setState({currentIndex: nextTrack});
  }

  toggleShuffle() {
    this.props.onUpdateScene(this.props.scene, (s) => {
      const playlist = s.audioPlaylists[this.props.playlistIndex];
      playlist.shuffle = !playlist.shuffle;
    });
  }

  changeRepeat() {
    this.props.onUpdateScene(this.props.scene, (s) => {
      const playlist = s.audioPlaylists[this.props.playlistIndex];
      const repeat = playlist.repeat;
      switch (repeat) {
        case RP.none:
          playlist.repeat = RP.all;
          break;
        case RP.all:
          playlist.repeat = RP.one;
          break;
        case RP.one:
          playlist.repeat = RP.none;
          break;
      }
    });
  }

  removePlaylist() {
    this.props.onUpdateScene(this.props.scene, (s) => {
      s.audioPlaylists.splice(this.props.playlistIndex, 1);
    });
  }

  removeTrack(trackIndex: number) {
    this.props.onUpdateScene(this.props.scene, (s) => {
      const playlist = s.audioPlaylists[this.props.playlistIndex];
      playlist.audios.splice(trackIndex, 1);
    });
  }

  moveTrack(trackIndex: number, delta: number) {
    this.moveTrackTo(trackIndex, trackIndex + delta);
  }

  moveTrackTo(trackIndex: number, targetIndex: number) {
    const audios = this.props.playlist.audios;
    const to = Math.max(0, Math.min(audios.length - 1, targetIndex));
    if (to === trackIndex) return;
    const newAudios = Array.from(audios);
    arrayMove(newAudios, trackIndex, to);
    this.props.onUpdateScene(this.props.scene, (s) => {
      s.audioPlaylists[this.props.playlistIndex].audios = newAudios;
    });
  }

  openMenu(trackIndex: number, e: MouseEvent) {
    this.setState({menu: {trackIndex, anchorEl: e.currentTarget}});
  }

  closeMenu() {
    this.setState({menu: null});
  }

  moveDelta(trackIndex: number, delta: number) {
    this.closeMenu();
    this.moveTrack(trackIndex, delta);
  }

  moveToTop(trackIndex: number) {
    this.closeMenu();
    this.moveTrackTo(trackIndex, 0);
  }

  moveToBottom(trackIndex: number) {
    this.closeMenu();
    this.moveTrackTo(trackIndex, this.props.playlist.audios.length - 1);
  }

  openMoveIndex(trackIndex: number) {
    this.closeMenu();
    this.setState({moveIndex: trackIndex});
  }

  closeMoveIndex() {
    this.setState({moveIndex: null});
  }

  confirmMoveIndex(index: number) {
    const trackIndex = this.state.moveIndex;
    this.closeMoveIndex();
    if (trackIndex != null) {
      this.moveTrackTo(trackIndex, index - 1);
    }
  }

  preview(trackIndex: number) {
    this.closeMenu();
    this.setState({previewIndex: trackIndex});
  }

  play(trackIndex: number) {
    this.closeMenu();
    const audio = this.props.playlist.audios[trackIndex];
    if (this.props.onPlay && this.props.systemMessage) {
      try {
        this.props.onPlay(audio, this.props.playlist.audios);
      } catch (e) {
        this.props.systemMessage("The source " + audio.url + " isn't in your Library");
      }
    }
  }

  closePreview() {
    this.setState({previewIndex: null});
  }

  options(trackIndex: number) {
    this.closeMenu();
    this.props.onSourceOptions(this.props.playlistIndex, this.props.playlist.audios[trackIndex]);
  }

  remove(trackIndex: number) {
    this.closeMenu();
    this.removeTrack(trackIndex);
  }

  onAudioSliderChange(e: MouseEvent, value: number) {
  }
}

(AudioPlaylist as any).displayName="AudioPlaylist";
export default AudioPlaylist;
