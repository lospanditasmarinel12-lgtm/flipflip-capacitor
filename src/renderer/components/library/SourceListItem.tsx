import * as React from "react";
import * as path from "../../services/path";

import {syncPathExists} from "../../services/local-paths";
import {openExternal, revealFile} from "../../services/links";

import {
  Badge,
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
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";

import { styled } from "@mui/material/styles";

import OfflineBoltIcon from '@mui/icons-material/OfflineBolt';
import MoreVertIcon from '@mui/icons-material/MoreVert';

import {abbreviateName, getCachePath, urlToPath} from "../../data/utils";
import {getFileName, getSourceType} from "../player/Scrapers";
import {SDT, ST} from "../../data/const";
import SourceIcon from "./SourceIcon";
import LibrarySource from "../../data/LibrarySource";
import Config from "../../data/Config";
import {grey} from "@mui/material/colors";
import MediaPreviewDialog, {isPreviewableUrl} from "./MediaPreviewDialog";
import MoveToIndexDialog from "./MoveToIndexDialog";

const RootRow = styled('div', { shouldForwardProp: (prop) => prop !== '$index' })<{ $index?: number }>(({ theme, $index }) => ({
  display: 'flex',
  ...($index !== undefined && $index % 2 !== 0
    ? {
        backgroundColor: theme.palette.mode == 'light' ? (theme.palette.primary as any)["100"] : grey[900],
        '&:hover': {
          backgroundColor: theme.palette.mode == 'light' ? (theme.palette.primary as any)["200"] : '#080808',
        },
      }
    : {
        backgroundColor: theme.palette.mode == 'light' ? (theme.palette.primary as any)["50"] : theme.palette.background.default,
        '&:hover': {
          backgroundColor: theme.palette.mode == 'light' ? (theme.palette.primary as any)["200"] : '#080808',
        },
      }),
}));

const StyledFab = styled(Fab, { shouldForwardProp: (prop) => prop !== '$marked' })<{ $marked?: boolean }>(({ theme, $marked }) => ({
  backgroundColor: $marked ? theme.palette.secondary.main : theme.palette.primary.main,
  boxShadow: 'none',
}));

const StyledSourceIcon = styled(SourceIcon, { shouldForwardProp: (prop) => prop !== '$marked' })<{ url?: string; $marked?: boolean }>(({ theme, $marked }) => ({
  fontSize: 20,
  color: $marked ? theme.palette.secondary.contrastText : theme.palette.primary.contrastText,
}));

const StyledErrorIcon = styled(OfflineBoltIcon)(({ theme }) => ({
  color: theme.palette.error.main,
  backgroundColor: theme.palette.error.contrastText,
  borderRadius: '50%',
}));

const StyledForm = styled('form')({
  width: '100%',
  margin: 0,
});

const NoSelectTypography = styled(Typography)({
  userSelect: 'none',
});

class SourceListItem extends React.Component {
  readonly props: {
    checked: boolean,
    config: Config,
    index: number,
    isEditing: number,
    isLibrary: boolean,
    isSelect: boolean,
    source: LibrarySource,
    sources: Array<LibrarySource>,
    style: any,
    tutorial: string,
    useWeights?: boolean,
    onClean(source: LibrarySource): void,
    onClearBlacklist(sourceURL: string): void,
    onClip(source: LibrarySource, displaySources: Array<LibrarySource>): void,
    onDelete(source: LibrarySource): void;
    onDownload(source: LibrarySource): void;
    onEditBlacklist(source: LibrarySource): void,
    onEndEdit(newURL: string): void,
    onOpenClipMenu(source: LibrarySource): void,
    onOpenWeightMenu(source: LibrarySource): void,
    onPlay(source: LibrarySource, displaySources: Array<LibrarySource>): void,
    onRemove(source: LibrarySource): void,
    onSourceOptions(source: LibrarySource): void,
    onStartEdit(id: number): void,
    onToggleSelect(): void,
    savePosition(): void,
    systemMessage(message: string): void,
    onMoveUp?(source: LibrarySource): void,
    onMoveDown?(source: LibrarySource): void,
    onMoveToIndex?(source: LibrarySource, targetIndex: number): void,
    isFirst?: boolean,
    isLast?: boolean,
  };

  readonly state = {
    urlInput: this.props.source.name || getFileName(this.props.source.url),
    menuAnchor: null as any,
    previewOpen: false,
    moveIndexOpen: false,
  };

  render() {
    const sourceType = getSourceType(this.props.source.url);
    const fullName = this.props.source.name || getFileName(this.props.source.url);
    const hasClip = !this.props.isLibrary && this.props.source.clips && this.props.source.clips.length > 0 && sourceType == ST.video;
    const hasBlacklist = this.props.source.blacklist && this.props.source.blacklist.length > 0;
    const showCleanCache = this.props.config.caching.enabled && sourceType != ST.local &&
      ((sourceType != ST.video && sourceType != ST.playlist)
        || /^https?:\/\//g.exec(this.props.source.url) != null);
    const showSourceOptions = sourceType == ST.local || sourceType == ST.video || sourceType == ST.twitter || sourceType == ST.reddit;

    return (
      <RootRow style={this.props.style} $index={this.props.index}
               sx={[
                 this.props.tutorial == SDT.source && { border: '2px solid', borderColor: 'secondary.main', borderStyle: 'solid' },
                 this.props.tutorial && { pointerEvents: 'none' },
               ]}>
        <ListItem>
          {this.props.isSelect && (
            <Checkbox value={this.props.source.url} onChange={this.props.onToggleSelect.bind(this)}
                      checked={this.props.checked}/>
          )}
          <ListItemAvatar>
            <Badge
              sx={(theme) => ({ '& .MuiBadge-badge': { zIndex: theme.zIndex.fab + 1 } })}
              invisible={!this.props.source.offline}
              overlap="circular"
              anchorOrigin={{
                vertical: 'top',
                horizontal: 'left',
              }}
              badgeContent={<StyledErrorIcon />}>
              <Tooltip disableInteractive title={
                <div>
                  &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Click: Library Tagging
                  <br/>
                  Shift+Click: Open Source
                  <br/>
                  &nbsp;&nbsp;Ctrl+Click: {sourceType == ST.video ? 'Reveal File' : 'Open Cache'}
                  {(sourceType != ST.local && sourceType != ST.video && sourceType != ST.piwigo && sourceType != ST.hydrus && sourceType != ST.nimja) &&
                    <React.Fragment>
                      <br/>
                      &nbsp;&nbsp;&nbsp;Alt+Click: Download Source
                    </React.Fragment>
                  }
                </div>
              }>
                <StyledFab
                  size="small"
                  $marked={this.props.source.marked}
                  onClick={this.onSourceIconClick.bind(this)}
                  sx={[this.props.tutorial == SDT.sourceAvatar && { border: '2px solid', borderColor: 'secondary.main', borderStyle: 'solid' }]}>
                  <StyledSourceIcon url={this.props.source.url} $marked={this.props.source.marked} />
                </StyledFab>
                </Tooltip>
            </Badge>
          </ListItemAvatar>

          <ListItemText disableTypography
                        sx={{ display: 'flex', alignItems: 'center', gap: 1, overflow: 'hidden', minWidth: 0 }}>
            {this.props.isEditing == this.props.source.id && (
              <StyledForm onSubmit={this.onEndEdit.bind(this)}>
                <TextField
                  variant="standard"
                  autoFocus
                  fullWidth
                  value={this.state.urlInput}
                  margin="none"
                  onBlur={this.onEndEdit.bind(this)}
                  onChange={this.onEditSource.bind(this)} />
              </StyledForm>
            )}
            {this.props.isEditing != this.props.source.id && (
              <React.Fragment>
                <NoSelectTypography color="textSecondary" sx={{ flex: '0 0 auto' }}>
                  {this.props.index + 1}.
                </NoSelectTypography>
                <NoSelectTypography
                  noWrap
                  title={fullName}
                  onClick={this.onStartEdit.bind(this, this.props.source)}
                  sx={[{ flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }, this.props.tutorial == SDT.sourceTitle && { border: '2px solid', borderColor: 'secondary.main', borderStyle: 'solid' }]}>
                  {abbreviateName(fullName)}
                </NoSelectTypography>
              </React.Fragment>
            )}
          </ListItemText>

          {this.props.isEditing != this.props.source.id && (
            <ListItemSecondaryAction
              sx={[this.props.tutorial == SDT.sourceButtons && { border: '2px solid', borderColor: 'secondary.main', borderStyle: 'solid' }]}>
              <IconButton
                edge="end"
                size="small"
                aria-label="options"
                onClick={this.openMenu.bind(this)}>
                <MoreVertIcon/>
              </IconButton>
            </ListItemSecondaryAction>
          )}
        </ListItem>

        <Menu
          anchorEl={this.state.menuAnchor}
          keepMounted
          open={this.state.menuAnchor != null}
          onClose={this.closeMenu.bind(this)}>
          {isPreviewableUrl(this.props.source.url) && (
            <MenuItem onClick={this.openPreview.bind(this)}>
              Preview
            </MenuItem>
          )}
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
          {(this.props.useWeights || hasClip || hasBlacklist || showCleanCache || showSourceOptions) && (
            <Divider/>
          )}
          {this.props.useWeights && (
            <MenuItem onClick={this.openWeight.bind(this)}>
              Weight
            </MenuItem>
          )}
          {hasClip && (
            <MenuItem onClick={this.openClip.bind(this)}>
              Clips
            </MenuItem>
          )}
          {hasBlacklist && (
            <MenuItem onClick={this.editBlacklist.bind(this)}>
              Blacklist…
            </MenuItem>
          )}
          {hasBlacklist && (
            <MenuItem onClick={this.clearBlacklist.bind(this)}>
              Clear Blacklist
            </MenuItem>
          )}
          {showCleanCache && (
            <MenuItem onClick={this.clean.bind(this)}>
              Clean Cache
            </MenuItem>
          )}
          {showSourceOptions && (
            <MenuItem onClick={this.options.bind(this)}>
              Source Options…
            </MenuItem>
          )}
          <Divider/>
          <MenuItem onClick={this.delete.bind(this)}>
            Delete
          </MenuItem>
        </Menu>

        {this.state.previewOpen && (
          <MediaPreviewDialog
            open={true}
            url={this.props.source.url}
            label={fullName}
            onClose={this.closePreview.bind(this)}/>
        )}
        {this.state.moveIndexOpen && (
          <MoveToIndexDialog
            open={true}
            title={"Move " + abbreviateName(fullName) + " to index"}
            max={this.props.sources.length}
            onClose={this.closeMoveIndex.bind(this)}
            onConfirm={this.confirmMoveIndex.bind(this)}/>
        )}
      </RootRow>
    );
  }

  onSourceIconClick(e: MouseEvent) {
    const sourceURL = this.props.source.url;
    const sourceType = getSourceType(sourceURL);
    if (e.shiftKey && e.ctrlKey && e.altKey) {
      this.props.onDelete(this.props.source);
    } else if (e.shiftKey && !e.ctrlKey && !e.altKey) {
      this.openExternalURL(sourceURL);
    } else if (!e.shiftKey && !e.ctrlKey && e.altKey) {
      if (sourceType != ST.local && sourceType != ST.video && sourceType != ST.piwigo && sourceType != ST.hydrus && sourceType != ST.nimja) {
        this.props.onDownload(this.props.source);
      }
    } else if (!e.shiftKey && e.ctrlKey && !e.altKey) {
      const fileType = getSourceType(sourceURL);
      let cachePath;
      if (fileType == ST.video || fileType == ST.playlist) {
        if (syncPathExists(getCachePath(sourceURL, this.props.config) + getFileName(sourceURL))) {
          cachePath = getCachePath(sourceURL, this.props.config);
        } else if (syncPathExists(sourceURL)) {
          revealFile(sourceURL);
        }
      } else {
        cachePath = getCachePath(sourceURL, this.props.config);
      }
      if (cachePath) {
        this.openDirectory(cachePath);
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

  openWeight() {
    this.closeMenu();
    this.props.onOpenWeightMenu(this.props.source);
  }

  openClip() {
    this.closeMenu();
    this.props.onOpenClipMenu(this.props.source);
  }

  editBlacklist() {
    this.closeMenu();
    this.props.onEditBlacklist(this.props.source);
  }

  clearBlacklist() {
    this.closeMenu();
    this.props.onClearBlacklist(this.props.source.url);
  }

  clean() {
    this.closeMenu();
    this.props.onClean(this.props.source);
  }

  options() {
    this.closeMenu();
    this.props.onSourceOptions(this.props.source);
  }

  delete() {
    this.closeMenu();
    if (this.props.isLibrary) {
      this.props.onDelete(this.props.source);
    } else {
      this.props.onRemove(this.props.source);
    }
  }

  onStartEdit(s: LibrarySource) {
    this.props.onStartEdit(s.id);
  }

  onEditSource(e: MouseEvent) {
    const input = (e.target as HTMLInputElement);
    this.setState({urlInput: input.value});
  }

  onEndEdit() {
    this.props.onEndEdit(this.state.urlInput);
  }

  openDirectory(cachePath: string) {
    this.openExternalURL(urlToPath(cachePath));
  }

  openExternalURL(url: string) {
    openExternal(url);
  }
}

(SourceListItem as any).displayName="SourceListItem";
export default SourceListItem;