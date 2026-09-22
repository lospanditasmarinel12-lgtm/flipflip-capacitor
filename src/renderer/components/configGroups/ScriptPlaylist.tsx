import * as React from "react";

import {syncPathExists} from "../../services/local-paths";
import {openExternal, revealFile} from "../../services/links";

import {
  Box,
  Divider,
  Fab,
  IconButton,
  List,
  ListItem,
  ListItemAvatar,
  ListItemSecondaryAction,
  ListItemText,
  Menu,
  MenuItem,
  Tooltip,
  Typography,
} from "@mui/material";
import { styled } from "@mui/material/styles";

import AddIcon from "@mui/icons-material/Add";
import ClearIcon from "@mui/icons-material/Clear";
import MoreVertIcon from '@mui/icons-material/MoreVert';
import RepeatIcon from '@mui/icons-material/Repeat';
import RepeatOneIcon from '@mui/icons-material/RepeatOne';
import ShuffleIcon from '@mui/icons-material/Shuffle';

import {abbreviateName, arrayMove} from "../../data/utils";
import {RP} from "../../data/const";
import Scene from "../../data/Scene";
import SourceIcon from "../library/SourceIcon";
import CaptionScript from "../../data/CaptionScript";
import MoveToIndexDialog from "../library/MoveToIndexDialog";

const ScriptUl = styled('ul')({
  paddingLeft: 0,
});

const PlaylistAction = styled('div')({
  textAlign: 'center',
});

const LeftDiv = styled('div')(({theme}) => ({
  float: 'left',
  paddingLeft: theme.spacing(2),
}));

const RightDiv = styled('div')(({theme}) => ({
  float: 'right',
  paddingRight: theme.spacing(2),
}));

const ScriptThumb = styled('div')({
  height: 40,
  width: 40,
  overflow: 'hidden',
  display: 'flex',
  justifyContent: 'center',
  cursor: 'pointer',
  userSelect: 'none',
});

const StyledListItemAvatar = styled(ListItemAvatar)({
  width: 56,
});

const StyledFab = styled(Fab)(({theme}) => ({
  backgroundColor: theme.palette.primary.main,
  boxShadow: 'none',
}));

const StyledSourceIcon = styled(SourceIcon)<{ url?: string }>(({theme}) => ({
  color: theme.palette.primary.contrastText,
}));

class ScriptPlaylist extends React.Component {
  readonly props: {
    playlistIndex: number,
    playlist: { scripts: Array<CaptionScript>, shuffle: boolean, repeat: string },
    scene: Scene,
    onAddScript(playlistIndex: number): void,
    onPlay(source: CaptionScript, sceneID: number, displaySources: Array<CaptionScript>): void,
    onSourceOptions(playlistIndex: number, script: CaptionScript): void,
    onUpdateScene(scene: Scene, fn: (scene: Scene) => void): void,
    systemMessage(message: string): void,
  };

  readonly state = {
    menu: null as { scriptIndex: number, anchorEl: any } | null,
    moveIndex: null as number,
  };

  render() {
    return (
      <List disablePadding>
          <ScriptUl>
            {this.props.playlist.scripts.map((s, i) =>
              <ListItem key={i}>
                <StyledListItemAvatar>
                    <Tooltip disableInteractive placement={'bottom'}
                             title={
                                 <div>
                                   &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Click: Library Tagging
                                   <br/>
                                   Shift+Click: Open Source
                                   <br/>
                                   &nbsp;&nbsp;Ctrl+Click: Reveal File
                                 </div>
                             }>
                      <div onClick={this.onSourceIconClick.bind(this, s)}>
                        <ScriptThumb>
                          <StyledFab
                            size="small">
                            <StyledSourceIcon url={s.url}/>
                          </StyledFab>
                        </ScriptThumb>
                      </div>
                    </Tooltip>
                </StyledListItemAvatar>
                <ListItemText disableTypography
                              sx={{ display: 'flex', alignItems: 'center', gap: 0.75, overflow: 'hidden', minWidth: 0 }}>
                  <Typography color="textSecondary" sx={{ userSelect: 'none', flex: '0 0 auto' }}>
                    {i + 1}.
                  </Typography>
                  <Typography noWrap sx={{ flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', userSelect: 'none' }} title={s.url}>
                    {abbreviateName(s.url)}
                  </Typography>
                </ListItemText>
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
          </ScriptUl>
        {this.state.menu && (
          <Menu
            anchorEl={this.state.menu.anchorEl}
            keepMounted
            open={true}
            onClose={this.closeMenu.bind(this)}>
            <MenuItem
              disabled={this.state.menu.scriptIndex <= 0}
              onClick={this.moveDelta.bind(this, this.state.menu.scriptIndex, -1)}>
              Move Up
            </MenuItem>
            <MenuItem
              disabled={this.state.menu.scriptIndex >= this.props.playlist.scripts.length - 1}
              onClick={this.moveDelta.bind(this, this.state.menu.scriptIndex, 1)}>
              Move Down
            </MenuItem>
            <MenuItem
              disabled={this.state.menu.scriptIndex <= 0}
              onClick={this.moveToTop.bind(this, this.state.menu.scriptIndex)}>
              Move to Top
            </MenuItem>
            <MenuItem
              disabled={this.state.menu.scriptIndex >= this.props.playlist.scripts.length - 1}
              onClick={this.moveToBottom.bind(this, this.state.menu.scriptIndex)}>
              Move to Bottom
            </MenuItem>
            <MenuItem onClick={this.openMoveIndex.bind(this, this.state.menu.scriptIndex)}>
              Move to a Index
            </MenuItem>
            <Divider/>
            <MenuItem onClick={this.options.bind(this, this.state.menu.scriptIndex)}>
              Source Options…
            </MenuItem>
            <Divider/>
            <MenuItem onClick={this.remove.bind(this, this.state.menu.scriptIndex)}>
              Delete
            </MenuItem>
          </Menu>
        )}
        {this.state.moveIndex != null && (
          <MoveToIndexDialog
            open={true}
            title="Move script to index"
            max={this.props.playlist.scripts.length}
            onClose={this.closeMoveIndex.bind(this)}
            onConfirm={this.confirmMoveIndex.bind(this)}/>
        )}
        <PlaylistAction>
          <LeftDiv>
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
          </LeftDiv>
          <Tooltip disableInteractive title="Add Tracks">
            <IconButton
              onClick={this.props.onAddScript.bind(this, this.props.playlistIndex)}
              size="large">
              <AddIcon/>
            </IconButton>
          </Tooltip>
          <RightDiv>
            <Tooltip disableInteractive title="Remove Playlist">
              <IconButton onClick={this.removePlaylist.bind(this)} size="large">
                <ClearIcon color={"error"}/>
              </IconButton>
            </Tooltip>
          </RightDiv>
        </PlaylistAction>
      </List>
    );
  }

  onSourceIconClick(script: CaptionScript, e: MouseEvent) {
    const sourceURL = script.url;
    if (e.shiftKey && !e.ctrlKey) {
      this.openExternalURL(sourceURL);
    } else if (!e.shiftKey && e.ctrlKey) {
      if (syncPathExists(sourceURL)) {
        revealFile(sourceURL);
      }
    } else if (!e.shiftKey && !e.ctrlKey && this.props.systemMessage) {
      try {
        this.props.onPlay(script, this.props.scene.id, this.props.playlist.scripts);
      } catch (e) {
        this.props.systemMessage("The source " + sourceURL + " isn't in your Library");
      }
    }
  }

  openExternalURL(url: string) {
    openExternal(url);
  }

  toggleShuffle() {
    this.props.onUpdateScene(this.props.scene, (s) => {
      const playlist = s.scriptPlaylists[this.props.playlistIndex];
      playlist.shuffle = !playlist.shuffle;
    });
  }

  changeRepeat() {
    this.props.onUpdateScene(this.props.scene, (s) => {
      const playlist = s.scriptPlaylists[this.props.playlistIndex];
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
      s.scriptPlaylists.splice(this.props.playlistIndex, 1);
    });
  }

  removeScript(scriptIndex: number) {
    this.props.onUpdateScene(this.props.scene, (s) => {
      const playlist = s.scriptPlaylists[this.props.playlistIndex];
      playlist.scripts.splice(scriptIndex, 1);
    });
  }

  moveScript(scriptIndex: number, delta: number) {
    this.moveScriptTo(scriptIndex, scriptIndex + delta);
  }

  moveScriptTo(scriptIndex: number, targetIndex: number) {
    const scripts = this.props.playlist.scripts;
    const to = Math.max(0, Math.min(scripts.length - 1, targetIndex));
    if (to === scriptIndex) return;
    const newScripts = Array.from(scripts);
    arrayMove(newScripts, scriptIndex, to);
    this.props.onUpdateScene(this.props.scene, (s) => {
      s.scriptPlaylists[this.props.playlistIndex].scripts = newScripts;
    });
  }

  openMenu(scriptIndex: number, e: MouseEvent) {
    this.setState({menu: {scriptIndex, anchorEl: e.currentTarget}});
  }

  closeMenu() {
    this.setState({menu: null});
  }

  moveDelta(scriptIndex: number, delta: number) {
    this.closeMenu();
    this.moveScript(scriptIndex, delta);
  }

  moveToTop(scriptIndex: number) {
    this.closeMenu();
    this.moveScriptTo(scriptIndex, 0);
  }

  moveToBottom(scriptIndex: number) {
    this.closeMenu();
    this.moveScriptTo(scriptIndex, this.props.playlist.scripts.length - 1);
  }

  openMoveIndex(scriptIndex: number) {
    this.closeMenu();
    this.setState({moveIndex: scriptIndex});
  }

  closeMoveIndex() {
    this.setState({moveIndex: null});
  }

  confirmMoveIndex(index: number) {
    const scriptIndex = this.state.moveIndex;
    this.closeMoveIndex();
    if (scriptIndex != null) {
      this.moveScriptTo(scriptIndex, index - 1);
    }
  }

  options(scriptIndex: number) {
    this.closeMenu();
    this.props.onSourceOptions(this.props.playlistIndex, this.props.playlist.scripts[scriptIndex]);
  }

  remove(scriptIndex: number) {
    this.closeMenu();
    this.removeScript(scriptIndex);
  }
}

(ScriptPlaylist as any).displayName="ScriptPlaylist";
export default ScriptPlaylist;
