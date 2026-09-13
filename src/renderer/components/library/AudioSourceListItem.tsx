import * as React from "react";

import {syncPathExists} from "../../services/local-paths";
import {openExternal, revealFile} from "../../services/links";

import {
  Badge,
  Box,
  Checkbox,
  Divider,
  Fab,
  IconButton,
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

import MoreVertIcon from '@mui/icons-material/MoreVert';

import {abbreviateName} from "../../data/utils";
import {getFileName} from "../player/Scrapers";
import Tag from "../../data/Tag";
import {grey} from "@mui/material/colors";
import Audio from "../../data/Audio";
import SourceIcon from "./SourceIcon";
import MediaPreviewDialog from "./MediaPreviewDialog";
import MoveToIndexDialog from "./MoveToIndexDialog";

const Outer = styled('div', {
  shouldForwardProp: (prop) => prop !== 'isOdd' && prop !== 'isLastSelected',
})<{ isOdd: boolean; isLastSelected: boolean }>(({ theme, isOdd, isLastSelected }) => ({
  backgroundColor: isOdd
    ? (theme.palette.mode == 'light' ? (theme.palette.primary as any)["100"] : grey[900])
    : (theme.palette.mode == 'light' ? (theme.palette.primary as any)["50"] : theme.palette.background.default),
  '&:hover': {
    backgroundColor: theme.palette.mode == 'light' ? (theme.palette.primary as any)["200"] : '#080808',
  },
  ...(isLastSelected && {
    backgroundColor: theme.palette.mode == 'light' ? (theme.palette.primary as any)["200"] : '#0F0F0F',
  }),
}));

const StyledSourceIcon = styled(SourceIcon, {
  shouldForwardProp: (prop) => prop !== 'marked',
})<{ url?: string; marked: boolean }>(({ theme, marked }) => ({
  color: marked ? theme.palette.secondary.contrastText : theme.palette.primary.contrastText,
}));

class AudioSourceListItem extends React.Component {
  readonly props: {
    checked: boolean,
    index: number,
    isSelect: boolean,
    isPlaylist: boolean,
    lastSelected: boolean,
    source: Audio,
    sources: Array<Audio>,
    style: any,
    onClickAlbum(album: string): void,
    onClickArtist(artist: string): void,
    onDelete(source: Audio): void;
    onEditSource(source: Audio): void;
    onPlay(source: Audio, displaySources: Array<Audio>): void,
    onRemove(source: Audio): void,
    onSourceOptions(source: Audio): void,
    onToggleSelect(): void,
    savePosition(): void,
    systemMessage(message: string): void,
    onMoveUp?(source: Audio): void,
    onMoveDown?(source: Audio): void,
    onMoveToIndex?(source: Audio, targetIndex: number): void,
    isFirst?: boolean,
    isLast?: boolean,
  };

  readonly state = {
    menuAnchor: null as any,
    previewOpen: false,
    moveIndexOpen: false,
  };

  render() {
    return(
      <Outer style={this.props.style} isOdd={this.props.index % 2 !== 0} isLastSelected={this.props.lastSelected}>
        <ListItem>
          {this.props.isSelect && (
            <Checkbox value={this.props.source.url} onChange={this.props.onToggleSelect.bind(this)}
                      checked={this.props.checked}/>
          )}
          <Badge
            anchorOrigin={{vertical: 'top', horizontal: 'left'}}
            variant={"dot"}
            invisible={!this.props.source.marked}
            overlap="rectangular"
            color="secondary">
            <ListItemAvatar sx={{ width: 56 }}>
              <Badge
                invisible={!this.props.source.trackNum}
                max={999}
                overlap="rectangular"
                color="primary"
                badgeContent={this.props.source.trackNum}>
                <Tooltip disableInteractive placement={this.props.source.comment ? 'right' : 'bottom'}
                         slotProps={this.props.source.comment ? { tooltip: { sx: { fontSize: "medium", maxWidth: 500 } } } : undefined}
                         arrow={!!this.props.source.comment || this.props.source.tags.length > 0}
                         title={
                  this.props.source.comment || this.props.source.tags.length > 0 ?
                    <Box sx={{ whiteSpace: 'pre-line' }}>
                      {this.props.source.comment}
                      {this.props.source.comment && this.props.source.tags.length > 0 && (<br/>)}
                      <Box sx={{ textAlign: 'center' }}>
                        {this.props.source.tags && this.props.source.tags.map((tag: Tag) =>
                          <Box key={tag.id} sx={{ display: 'inline-block', padding: 0.25, color: 'inherit' }}>
                            {tag.name}
                          </Box>
                        )}
                      </Box>
                    </Box>
                      :
                    <Box>
                      &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Click: Library Tagging
                      <br/>
                      Shift+Click: Open Source
                      <br/>
                      &nbsp;&nbsp;Ctrl+Click: Reveal File
                    </Box>
                }>
                  <Box onClick={this.onSourceIconClick.bind(this)}
                       sx={{ height: 40, width: 40, overflow: 'hidden', display: 'flex', justifyContent: 'center', cursor: 'pointer', userSelect: 'none' }}>
                    {this.props.source.thumb != null && (
                      <Box component="img" sx={{ height: '100%' }} src={this.props.source.thumb}/>
                    )}
                    {this.props.source.thumb == null && (
                      <Fab
                        size="small"
                        sx={(theme) => ({
                          backgroundColor: this.props.source.marked ? theme.palette.secondary.main : theme.palette.primary.main,
                          boxShadow: 'none',
                        })}>
                        <StyledSourceIcon url={this.props.source.url} marked={this.props.source.marked}/>
                      </Fab>
                    )}
                  </Box>
                </Tooltip>
              </Badge>
            </ListItemAvatar>
          </Badge>

          <ListItemText slotProps={{ primary: { sx: (theme) => ({ display: 'flex', flexWrap: 'wrap', alignItems: 'center', [theme.breakpoints.down('sm')]: { flexDirection: 'column', alignItems: 'flex-start' } }), }, }}>
            <Typography color="textSecondary" sx={{ flexShrink: 0, marginRight: 1, userSelect: 'none' }}>
              {this.props.index + 1}.
            </Typography>
            <Typography noWrap sx={{ maxWidth: 500, minWidth: 250, width: '100%', userSelect: 'none' }} title={this.props.source.name}>
              {abbreviateName(this.props.source.name || getFileName(this.props.source.url))}
            </Typography>
          </ListItemText>

          <ListItemSecondaryAction>
            <IconButton
              edge="end"
              size="small"
              aria-label="options"
              onClick={this.openMenu.bind(this)}>
              <MoreVertIcon/>
            </IconButton>
          </ListItemSecondaryAction>
        </ListItem>

        <Menu
          anchorEl={this.state.menuAnchor}
          keepMounted
          open={this.state.menuAnchor != null}
          onClose={this.closeMenu.bind(this)}>
          <MenuItem onClick={this.openPreview.bind(this)}>
            Preview
          </MenuItem>
          {this.props.onMoveUp && (
            <MenuItem onClick={this.moveUp.bind(this)}>
              Move Up
            </MenuItem>
          )}
          {this.props.onMoveDown && (
            <MenuItem onClick={this.moveDown.bind(this)}>
              Move Down
            </MenuItem>
          )}
          {this.props.onMoveUp && (
            <MenuItem disabled={this.props.isFirst} onClick={this.moveTop.bind(this)}>
              Move to Top
            </MenuItem>
          )}
          {this.props.onMoveDown && (
            <MenuItem disabled={this.props.isLast} onClick={this.moveBottom.bind(this)}>
              Move to Bottom
            </MenuItem>
          )}
          {this.props.onMoveUp && (
            <MenuItem onClick={this.openMoveIndex.bind(this)}>
              Move to a Index
            </MenuItem>
          )}
          <Divider/>
          <MenuItem onClick={this.editSource.bind(this)}>
            Edit Song Info
          </MenuItem>
          <MenuItem onClick={this.options.bind(this)}>
            Source Options…
          </MenuItem>
          <Divider/>
          <MenuItem onClick={this.delete.bind(this)}>
            Delete
          </MenuItem>
        </Menu>

        {this.state.previewOpen && (
          <MediaPreviewDialog
            open={true}
            url={this.props.source.url}
            label={this.props.source.name}
            onClose={this.closePreview.bind(this)}/>
        )}
        {this.state.moveIndexOpen && (
          <MoveToIndexDialog
            open={true}
            title={"Move " + abbreviateName(this.props.source.name) + " to index"}
            max={this.props.sources.length}
            onClose={this.closeMoveIndex.bind(this)}
            onConfirm={this.confirmMoveIndex.bind(this)}/>
        )}
      </Outer>
    );
  }

  onSourceIconClick(e: MouseEvent) {
    const sourceURL = this.props.source.url;
    if (e.shiftKey && e.ctrlKey && e.altKey) {
      this.props.onDelete(this.props.source);
    } else if (e.shiftKey && !e.ctrlKey) {
      this.openExternalURL(sourceURL);
    } else if (!e.shiftKey && e.ctrlKey) {
      if (syncPathExists(sourceURL)) {
        revealFile(sourceURL);
      }
    } else if (!e.shiftKey && !e.ctrlKey) {
      this.props.savePosition();
      try {
        this.props.onPlay(this.props.source, this.props.sources);
      } catch (e) {
        this.props.systemMessage("The source " + sourceURL + " isn't in your Library");
      }
    }
  }

  openMenu(e: MouseEvent) {
    this.setState({menuAnchor: e.currentTarget});
  }

  closeMenu() {
    this.setState({menuAnchor: null});
  }

  moveUp() {
    this.closeMenu();
    this.props.onMoveUp && this.props.onMoveUp(this.props.source);
  }

  moveDown() {
    this.closeMenu();
    this.props.onMoveDown && this.props.onMoveDown(this.props.source);
  }

  moveTop() {
    this.closeMenu();
    this.props.onMoveToIndex && this.props.onMoveToIndex(this.props.source, 0);
  }

  moveBottom() {
    this.closeMenu();
    this.props.onMoveToIndex && this.props.onMoveToIndex(this.props.source, this.props.sources.length - 1);
  }

  openMoveIndex() {
    this.closeMenu();
    this.setState({moveIndexOpen: true});
  }

  closeMoveIndex() {
    this.setState({moveIndexOpen: false});
  }

  confirmMoveIndex(index: number) {
    this.closeMoveIndex();
    this.props.onMoveToIndex && this.props.onMoveToIndex(this.props.source, index - 1);
  }

  openPreview() {
    this.closeMenu();
    this.setState({previewOpen: true});
  }

  closePreview() {
    this.setState({previewOpen: false});
  }

  editSource() {
    this.closeMenu();
    this.props.onEditSource(this.props.source);
  }

  options() {
    this.closeMenu();
    this.props.onSourceOptions(this.props.source);
  }

  delete() {
    this.closeMenu();
    if (this.props.isPlaylist) {
      this.props.onRemove(this.props.source);
    } else {
      this.props.onDelete(this.props.source);
    }
  }

  openExternalURL(url: string) {
    openExternal(url);
  }
}

(AudioSourceListItem as any).displayName="AudioSourceListItem";
export default AudioSourceListItem;