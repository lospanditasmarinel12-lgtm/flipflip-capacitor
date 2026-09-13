import * as React from "react";
import wretch from "wretch";

import {
  AppBar,
  Backdrop,
  Badge,
  Box,
  Button,
  Chip,
  Collapse,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Divider,
  Drawer,
  Fab,
  IconButton,
  InputAdornment,
  LinearProgress,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemSecondaryAction,
  ListItemText,
  ListSubheader,
  Menu,
  MenuItem,
  SvgIcon,
  TextField,
  Toolbar,
  Tooltip,
  Typography,
} from "@mui/material";

import { styled, Theme } from "@mui/material/styles";

import AddIcon from '@mui/icons-material/Add';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import CancelIcon from '@mui/icons-material/Cancel';
import ClearIcon from '@mui/icons-material/Clear';
import DeleteSweepIcon from '@mui/icons-material/DeleteSweep';
import FolderIcon from '@mui/icons-material/Folder';
import FormatListBulletedIcon from '@mui/icons-material/FormatListBulleted';
import GetAppIcon from '@mui/icons-material/GetApp';
import HttpIcon from '@mui/icons-material/Http';
import LocalOfferIcon from '@mui/icons-material/LocalOffer';
import MenuIcon from'@mui/icons-material/Menu';
import MergeTypeIcon from '@mui/icons-material/MergeType';
import MovieFilterIcon from '@mui/icons-material/MovieFilter';
import OfflineBoltIcon from '@mui/icons-material/OfflineBolt';
import PublishIcon from '@mui/icons-material/Publish';
import SelectAllIcon from '@mui/icons-material/SelectAll';
import ShuffleIcon from "@mui/icons-material/Shuffle";
import SortIcon from '@mui/icons-material/Sort';

import {AF, LT, MO, PR, SF, SP, ST} from "../../data/const";
import {filterSource, getCachePath, getLocalPath} from "../../data/utils";
import {getFileName, getSourceType} from "../player/Scrapers";
import en from "../../data/en";
import Config from "../../data/Config";
import LibrarySource from "../../data/LibrarySource";
import Scene from "../../data/Scene";
import Tag from "../../data/Tag";
import { getFilesystem } from "../../services/filesystem";
import { pickFiles } from "../../services/filepicker";
import BatchClipDialog from "./BatchClipDialog";
import LibrarySearch from "./LibrarySearch";
import SourceIcon from "./SourceIcon";
import SourceList from "./SourceList";
import PiwigoDialog from "../sceneDetail/PiwigoDialog";
import URLDialog from "../sceneDetail/URLDialog";

const StyledIconWrapper = styled('span')(({ theme }) => ({
  color: theme.palette.primary.contrastText,
  display: 'inline-flex',
}));

const drawerWidth = 240;

class Library extends React.Component {
  readonly props: {
    config: Config,
    filters: Array<string>,
    library: Array<LibrarySource>,
    progressCurrent: number,
    progressMode: string,
    progressTitle: string,
    progressTotal: number,
    selected: Array<string>,
    specialMode: string,
    tags: Array<Tag>,
    tutorial: string,
    yOffset: number,
    goBack(): void,
    onAddSource(scene: Scene, type: string, ...args: any[]): void,
    onBatchClip(): void,
    onBatchTag(): void,
    onClearBlacklist(sourceURL: string): void,
    onClip(source: LibrarySource, displayed: Array<LibrarySource>): void,
    onDownload(source: LibrarySource): void;
    onEditBlacklist(sourceURL: string, blacklist: string): void,
    onExportLibrary(): void,
    onImportFromLibrary(sources: Array<LibrarySource>): void,
    onImportLibrary(importLibrary: any): void,
    onManageTags(): void,
    onMarkOffline(): void,
    onPlay(source: LibrarySource, displayed: Array<LibrarySource>): void,
    onSort(scene: Scene, algorithm: string, ascending: boolean): void,
    onTutorial(tutorial: string): void,
    onUpdateLibrary(fn: (library: Array<LibrarySource>) => void): void,
    onUpdateMode(mode: string): void,
    onUpdateVideoMetadata(): void,
    savePosition(yOffset: number, filters:Array<string>, selected: Array<string>): void,
    systemMessage(message: string): void,
  };

  readonly state = {
    displaySources: Array<LibrarySource>(),
    drawerOpen: false,
    filters: this.props.filters,
    selected: this.props.selected,
    selectedTags: Array<string>(),
    menuAnchorEl: null as any,
    openMenu: null as string,
    moveDialog: false,
    importFile: "",
  };

  render() {
    const open = this.state.drawerOpen;

    let cancelProgressMessage;
    switch (this.props.progressMode) {
      case PR.offline:
        cancelProgressMessage = "Cancel Offline Check ( " + this.props.progressCurrent + " / " + this.props.progressTotal + " )";
        break;
      case PR.videoMetadata:
        cancelProgressMessage = "End Video MD Check ( " + this.props.progressCurrent + " / " + this.props.progressTotal + " )";
        break;
      case PR.tumblr:
        cancelProgressMessage = "Cancel Import ( " + this.props.progressCurrent + " / " + this.props.progressTotal + " )";
        break;
      case PR.reddit:
      case PR.twitter:
      case PR.instagram:
        cancelProgressMessage = "Cancel Import";
        break;
    }

    return (
      <Box sx={{ display: 'flex' }}>
        <AppBar position="absolute"
          sx={(theme) => ({
            zIndex: theme.zIndex.drawer + 1,
            paddingTop: 'var(--safe-area-inset-top, env(safe-area-inset-top, 0px))',
            ...(this.props.tutorial == LT.toolbar && {
              zIndex: theme.zIndex.modal + 1,
              pointerEvents: 'none',
            }),
          })}>
          <Toolbar sx={{ display: 'flex', alignItems: 'center', whiteSpace: 'nowrap', flexWrap: 'nowrap', minHeight: 64, height: (theme: Theme) => theme.mixins.toolbar.minHeight }}>
            <Box sx={{ flexBasis: '20%' }}>
              <Tooltip disableInteractive title={this.props.specialMode == SP.select ? "Cancel Import" : "Back"} placement="right-end">
                <IconButton
                  edge="start"
                  color="inherit"
                  aria-label="Back"
                  sx={{ float: 'left' }}
                  onClick={this.goBack.bind(this)}
                  size="large">
                  <ArrowBackIcon />
                </IconButton>
              </Tooltip>
            </Box>

            <Typography component="h1" variant="h4" color="inherit" noWrap
                        sx={(theme) => ({ textAlign: 'center', flexGrow: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', [theme.breakpoints.down('sm')]: { fontSize: '1.25rem' } })}>
              Library
            </Typography>

            <Box sx={(theme) => ({ flexBasis: '20%', flexShrink: 0, minWidth: 0, justifyContent: 'flex-end', display: 'flex', [theme.breakpoints.down('sm')]: { flexBasis: 'auto', maxWidth: '45vw' } })}>
              <Box sx={(theme) => ({
                float: 'right', display: 'flex', maxWidth: '100%',
                ...(this.props.tutorial == LT.toolbar && {
                  borderWidth: 2,
                  borderColor: theme.palette.secondary.main,
                  borderStyle: 'solid',
                }),
              })}>
                {this.props.library.length > 0 && (
                  <Chip
                    sx={(theme) => ({ color: theme.palette.primary.contrastText, marginTop: 3, marginRight: theme.spacing(1) })}
                    label={this.props.library.length}
                    size='medium'
                    variant='outlined'/>
                )}
                {this.state.filters.length > 0 && (
                  <Chip
                    sx={{ marginTop: 3, marginRight: 1 }}
                    label={this.state.displaySources.length}
                    size='medium'/>
                )}
                <LibrarySearch
                  displaySources={this.state.displaySources}
                  filters={this.state.filters}
                  tags={this.props.tags}
                  placeholder={"Search ..."}
                  isCreatable
                  onlyUsed
                  onUpdateFilters={this.onUpdateFilters.bind(this)}/>
              </Box>
            </Box>
          </Toolbar>
        </AppBar>

        <Drawer
          sx={(theme) => ({
            position: 'absolute',
            ...((this.props.tutorial == LT.sidebar1 || this.props.tutorial == LT.sidebar2 || this.state.drawerOpen) && {
              zIndex: theme.zIndex.modal + 1,
            }),
            ...(this.props.tutorial == LT.sidebar2 && {
              borderWidth: 2,
              borderColor: theme.palette.secondary.main,
              borderStyle: 'solid',
            }),
            // Phones: content gets the full width; paper becomes an overlay.
            [theme.breakpoints.down('sm')]: {
              width: 0,
            },
          })}
          variant="permanent"
          slotProps={{
            paper: {
              sx: (theme) => ({
                position: 'relative',
                whiteSpace: 'nowrap',
                overflowX: 'hidden',
                height: 'var(--app-height, 100vh)',
                width: this.props.specialMode ? 0 : (open ? drawerWidth : theme.spacing(7)),
                transition: theme.transitions.create(['width', 'transform', 'left'], {
                  easing: theme.transitions.easing.sharp,
                  duration: this.props.specialMode ? theme.transitions.duration.leavingScreen : (open ? theme.transitions.duration.enteringScreen : theme.transitions.duration.leavingScreen),
                }),
                ...(!this.props.specialMode && {
                  [theme.breakpoints.up('sm')]: {
                    width: open ? drawerWidth : theme.spacing(9),
                  },
                  // Phones: overlay when open; keep a slim rail when closed so
                  // the drawer's own menu button stays reachable.
                  [theme.breakpoints.down('sm')]: {
                    position: 'fixed',
                    top: 0,
                    bottom: 0,
                    left: 0,
                    width: open ? `min(${drawerWidth}px, 80vw)` : theme.spacing(7),
                    transform: 'translateX(0)',
                    boxShadow: theme.shadows[8],
                  },
                }),
              }),
            },
          }}
          open={this.state.drawerOpen}>
          <Box sx={!open ? { display: 'flex', alignItems: 'center', justifyContent: 'flex-end', padding: '0 8px', minHeight: 'calc(64px + var(--safe-area-inset-top, env(safe-area-inset-top, 0px)))' } : undefined}>
            <Collapse in={!open}>
              <Box sx={(theme) => ({ backgroundColor: theme.palette.primary.main, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', padding: '0 8px', minHeight: 'calc(64px + var(--safe-area-inset-top, env(safe-area-inset-top, 0px)))' })} />
            </Collapse>
          </Box>

          <ListItem sx={(theme) => ({ backgroundColor: theme.palette.primary.main, minHeight: theme.spacing(6), [theme.breakpoints.down('sm')]: { paddingLeft: 0, paddingRight: 0 } })}>
            <IconButton
              sx={(theme) => ({
                ...(this.props.tutorial == LT.sidebar1 && {
                  borderWidth: 2,
                  borderColor: theme.palette.secondary.main,
                  borderStyle: 'solid',
                }),
              })}
              onClick={this.onToggleDrawer.bind(this)}
              size="large">
              <MenuIcon sx={(theme) => ({ color: theme.palette.primary.contrastText })}/>
            </IconButton>
          </ListItem>

          <Divider />

          <Box sx={(theme) => ({
            ...(this.props.tutorial != null && { pointerEvents: 'none' }),
          })}>

            <Tooltip disableInteractive title={this.state.drawerOpen ? "" : "Manage Tags"}>
              <ListItemButton onClick={this.props.onManageTags.bind(this)}>
                <ListItemIcon>
                  <LocalOfferIcon />
                </ListItemIcon>
                <ListItemText primary="Manage Tags" />
                {this.props.tags.length > 0 && (
                  <Chip
                    sx={(theme) => ({
                      transition: theme.transitions.create(['opacity'], {
                        easing: theme.transitions.easing.sharp,
                        duration: theme.transitions.duration.enteringScreen,
                      }),
                      ...(!open && {
                        opacity: 0,
                        transition: theme.transitions.create(['opacity'], {
                          easing: theme.transitions.easing.sharp,
                          duration: theme.transitions.duration.leavingScreen,
                        }),
                      }),
                    })}
                    label={this.props.tags.length}
                    color='primary'
                    size='small'
                    variant='outlined'/>
                )}
              </ListItemButton>
            </Tooltip>
            <Tooltip disableInteractive title={this.state.drawerOpen ? "" : "Batch Tag"}>
              <ListItemButton onClick={this.onBatchTag.bind(this)}>
                <ListItemIcon>
                  <FormatListBulletedIcon />
                </ListItemIcon>
                <ListItemText primary="Batch Tag" />
              </ListItemButton>
            </Tooltip>
            <Tooltip disableInteractive title={this.state.drawerOpen ? "" : "Batch Clip"}>
              <ListItemButton onClick={this.onBatchClip.bind(this)}>
                <ListItemIcon>
                  <SvgIcon>
                    <path d="M11 21H7V19H11V21M15.5 19H17V21H13V19H13.2L11.8 12.9L9.3 13.5C9.2 14 9 14.4 8.8
                          14.8C7.9 16.3 6 16.7 4.5 15.8C3 14.9 2.6 13 3.5 11.5C4.4 10 6.3 9.6 7.8 10.5C8.2 10.7 8.5
                          11.1 8.7 11.4L11.2 10.8L10.6 8.3C10.2 8.2 9.8 8 9.4 7.8C8 6.9 7.5 5 8.4 3.5C9.3 2 11.2
                          1.6 12.7 2.5C14.2 3.4 14.6 5.3 13.7 6.8C13.5 7.2 13.1 7.5 12.8 7.7L15.5 19M7 11.8C6.3
                          11.3 5.3 11.6 4.8 12.3C4.3 13 4.6 14 5.3 14.4C6 14.9 7 14.7 7.5 13.9C7.9 13.2 7.7 12.2 7
                          11.8M12.4 6C12.9 5.3 12.6 4.3 11.9 3.8C11.2 3.3 10.2 3.6 9.7 4.3C9.3 5 9.5 6 10.3 6.5C11
                          6.9 12 6.7 12.4 6M12.8 11.3C12.6 11.2 12.4 11.2 12.3 11.4C12.2 11.6 12.2 11.8 12.4
                          11.9C12.6 12 12.8 12 12.9 11.8C13.1 11.6 13 11.4 12.8 11.3M21 8.5L14.5 10L15 12.2L22.5
                          10.4L23 9.7L21 8.5M23 19H19V21H23V19M5 19H1V21H5V19Z" />
                  </SvgIcon>
                </ListItemIcon>
                <ListItemText primary="Batch Clip" />
              </ListItemButton>
            </Tooltip>
            <Tooltip disableInteractive title={"Identify local sources which have identical tags"}>
              <ListItemButton onClick={this.onFindMerges.bind(this)}>
                <ListItemIcon>
                  <MergeTypeIcon />
                </ListItemIcon>
                <ListItemText primary="Find Mergeables" />
              </ListItemButton>
            </Tooltip>
          </Box>

          <Divider />

          <Box sx={(theme) => ({
            ...(this.props.tutorial != null && { pointerEvents: 'none' }),
          })}>
            <Tooltip disableInteractive title={"Identify sources which are not accessible"}>
              <ListItemButton disabled={this.props.progressMode != null} onClick={this.props.onMarkOffline.bind(this)}>
                <ListItemIcon>
                  <OfflineBoltIcon />
                </ListItemIcon>
                <ListItemText primary="Mark Offline" />
              </ListItemButton>
            </Tooltip>
            <Tooltip disableInteractive title={"Detect duration and resolution of video sources"}>
              <ListItemButton disabled={this.props.progressMode != null} onClick={this.props.onUpdateVideoMetadata.bind(this)}>
                <ListItemIcon>
                  <MovieFilterIcon />
                </ListItemIcon>
                <ListItemText primary="Video Metadata" />
              </ListItemButton>
            </Tooltip>
          </Box>

          {this.props.progressMode != null && (
            <React.Fragment>
              <Divider />

              <Box>
                <Tooltip disableInteractive title={this.state.drawerOpen ? "" : cancelProgressMessage}>
                  <ListItemButton onClick={this.props.onUpdateMode.bind(this, PR.cancel)}>
                    <ListItemIcon>
                      <CancelIcon color="error"/>
                    </ListItemIcon>
                    <ListItemText primary={cancelProgressMessage} />
                  </ListItemButton>
                </Tooltip>
                {(this.props.progressMode === PR.offline || this.props.progressMode === PR.tumblr || this.props.progressMode === PR.videoMetadata) && (
                  <LinearProgress variant="determinate" value={Math.round((this.props.progressCurrent / this.props.progressTotal) * 100)}/>
                )}
                {this.props.progressMode !== PR.offline && this.props.progressMode !== PR.tumblr && this.props.progressMode !== PR.videoMetadata && (
                  <LinearProgress variant={this.props.progressMode === PR.cancel ? "query" : "indeterminate"}/>
                )}
              </Box>
            </React.Fragment>
          )}

          <Box sx={{ flexGrow: 1 }}/>

          <Box sx={(theme) => ({
            ...(this.props.tutorial != null && { pointerEvents: 'none' }),
          })}>
            <Tooltip disableInteractive title={this.state.drawerOpen ? "" : "Export Library"}>
              <ListItemButton onClick={this.props.onExportLibrary.bind(this)}>
                <ListItemIcon>
                  <PublishIcon />
                </ListItemIcon>
                <ListItemText primary="Export Library" />
              </ListItemButton>
            </Tooltip>
            <Tooltip disableInteractive title={this.state.drawerOpen ? "" : "Import Library"}>
              <ListItemButton onClick={this.onImportLibrary.bind(this)}>
                <ListItemIcon>
                  <GetAppIcon />
                </ListItemIcon>
                <ListItemText primary="Import Library" />
              </ListItemButton>
            </Tooltip>
          </Box>
        </Drawer>

        <Box
          component="main"
          sx={(theme) => ({
            display: 'flex',
            flexGrow: 1,
            flexDirection: 'column',
            height: 'var(--app-height, 100vh)',
            backgroundColor: theme.palette.background.default,
          })}>
          <Box sx={(theme) => ({ backgroundColor: theme.palette.primary.main, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', padding: '0 8px', minHeight: 'calc(64px + var(--safe-area-inset-top, env(safe-area-inset-top, 0px)))' })} />
          <Box sx={{ display: 'flex', flexGrow: 1 }}>
            {!this.props.specialMode &&  (
              <Box sx={(theme) => ({
                width: theme.spacing(7),
                [theme.breakpoints.up('sm')]: {
                  width: theme.spacing(9),
                },
              })}/>
            )}
            <Container maxWidth={false} sx={(theme) => ({
              padding: theme.spacing(0),
              overflow: 'hidden',
              flexGrow: 1,
              position: 'relative',
              ...(this.state.displaySources.length > 0 && { display: 'flex' }),
            })}>
              <SourceList
                config={this.props.config}
                isSelect={!!this.props.specialMode}
                library={this.props.library}
                selected={this.state.selected}
                showHelp={!this.props.specialMode && this.state.filters.length == 0}
                tutorial={this.props.tutorial}
                sources={this.state.displaySources}
                yOffset={this.props.yOffset}
                onClearBlacklist={this.props.onClearBlacklist.bind(this)}
                onClip={this.props.onClip.bind(this)}
                onDownload={this.props.onDownload.bind(this)}
                onEditBlacklist={this.props.onEditBlacklist.bind(this)}
                onPlay={this.props.onPlay.bind(this)}
                onUpdateSelected={this.onUpdateSelected.bind(this)}
                onUpdateLibrary={this.props.onUpdateLibrary.bind(this)}
                savePosition={this.savePosition.bind(this)}
                systemMessage={this.props.systemMessage.bind(this)}/>
            </Container>
          </Box>
        </Box>

        <Backdrop
          sx={(theme) => ({ zIndex: theme.zIndex.modal, height: '100%', width: '100%' })}
          onClick={this.onCloseDialog.bind(this)}
          open={this.props.tutorial == null && (this.state.openMenu == MO.new || this.state.drawerOpen)} />

        {this.props.specialMode && (
          <React.Fragment>
            <Tooltip disableInteractive title="Clear"  placement="top-end">
              <Fab
                sx={(theme) => ({
                  backgroundColor: theme.palette.secondary.light,
                  margin: 0,
                  top: 'auto',
                  right: 180,
                  bottom: 20,
                  left: 'auto',
                  position: 'fixed',
                })}
                onClick={this.onSelectNone.bind(this)}
                size="small">
                <ClearIcon sx={(theme) => ({ color: theme.palette.primary.contrastText })} />
              </Fab>
            </Tooltip>
            <Tooltip disableInteractive title="Select All"  placement="top-end">
              <Fab
                sx={(theme) => ({
                  backgroundColor: theme.palette.secondary.dark,
                  margin: 0,
                  top: 'auto',
                  right: 130,
                  bottom: 20,
                  left: 'auto',
                  position: 'fixed',
                })}
                onClick={this.onSelectAll.bind(this)}
                size="medium">
                <SelectAllIcon sx={(theme) => ({ color: theme.palette.primary.contrastText })} />
              </Fab>
            </Tooltip>
            <Tooltip disableInteractive title={this.props.specialMode == SP.batchTag ? "Batch Tag" : this.props.specialMode == SP.batchClip ? "Batch Clip" : "Import"}  placement="top-end">
              <Badge
                slotProps={{
                  badge: {
                    sx: (theme) => ({
                      top: 'auto',
                      right: 30,
                      bottom: 50,
                      left: 'auto',
                      position: 'fixed',
                      zIndex: theme.zIndex.fab + 1,
                    }),
                  },
                }}
                overlap="circular"
                color="secondary"
                badgeContent={this.state.selected.length}
                max={999}>
                <Fab
                  sx={(theme) => ({
                    backgroundColor: theme.palette.primary.dark,
                    margin: 0,
                    top: 'auto',
                    right: 20,
                    bottom: 20,
                    left: 'auto',
                    position: 'fixed',
                  })}
                  disabled={this.state.selected.length == 0}
                  onClick={this.props.specialMode == SP.batchTag ? this.onToggleBatchTagModal.bind(this) : this.props.specialMode == SP.batchClip ? this.onToggleBatchClipModal.bind(this) : this.onImportFromLibrary.bind(this)}
                  size="large">
                  {this.props.specialMode == SP.select && (
                    <GetAppIcon sx={(theme) => ({ color: theme.palette.primary.contrastText })} />
                  )}
                  {this.props.specialMode == SP.batchTag && (
                    <LocalOfferIcon sx={(theme) => ({ color: theme.palette.primary.contrastText })} />
                  )}
                  {this.props.specialMode == SP.batchClip && (
                    <SvgIcon sx={(theme) => ({ color: theme.palette.primary.contrastText })} >
                      <path d="M11 21H7V19H11V21M15.5 19H17V21H13V19H13.2L11.8 12.9L9.3 13.5C9.2 14 9 14.4 8.8
                          14.8C7.9 16.3 6 16.7 4.5 15.8C3 14.9 2.6 13 3.5 11.5C4.4 10 6.3 9.6 7.8 10.5C8.2 10.7 8.5
                          11.1 8.7 11.4L11.2 10.8L10.6 8.3C10.2 8.2 9.8 8 9.4 7.8C8 6.9 7.5 5 8.4 3.5C9.3 2 11.2
                          1.6 12.7 2.5C14.2 3.4 14.6 5.3 13.7 6.8C13.5 7.2 13.1 7.5 12.8 7.7L15.5 19M7 11.8C6.3
                          11.3 5.3 11.6 4.8 12.3C4.3 13 4.6 14 5.3 14.4C6 14.9 7 14.7 7.5 13.9C7.9 13.2 7.7 12.2 7
                          11.8M12.4 6C12.9 5.3 12.6 4.3 11.9 3.8C11.2 3.3 10.2 3.6 9.7 4.3C9.3 5 9.5 6 10.3 6.5C11
                          6.9 12 6.7 12.4 6M12.8 11.3C12.6 11.2 12.4 11.2 12.3 11.4C12.2 11.6 12.2 11.8 12.4
                          11.9C12.6 12 12.8 12 12.9 11.8C13.1 11.6 13 11.4 12.8 11.3M21 8.5L14.5 10L15 12.2L22.5
                          10.4L23 9.7L21 8.5M23 19H19V21H23V19M5 19H1V21H5V19Z" />
                    </SvgIcon>
                  )}
                </Fab>
              </Badge>
            </Tooltip>
          </React.Fragment>
        )}

        {!this.props.specialMode && (
          <React.Fragment>
            {this.props.library.length > 0 && (
              <Tooltip disableInteractive title={this.state.filters.length == 0 ? "Delete All Sources" : "Delete These Sources"}  placement="left">
                <Fab
                  sx={(theme) => ({
                    backgroundColor: theme.palette.error.main,
                    margin: 0,
                    top: 'auto',
                    right: 130,
                    bottom: 20,
                    left: 'auto',
                    position: 'fixed',
                  })}
                  onClick={this.onRemoveAll.bind(this)}
                  size="small">
                  <DeleteSweepIcon sx={(theme) => ({ color: theme.palette.primary.contrastText })} />
                </Fab>
              </Tooltip>
            )}
            <Dialog
              open={this.state.openMenu == MO.libraryImport}
              onClose={this.onCloseDialog.bind(this)}
              aria-labelledby="import-title"
              aria-describedby="import-description">
              <DialogTitle id="import-title">Import Library</DialogTitle>
              <DialogContent>
                <DialogContentText id="import-description">
                  To import a library, enter the URL or open a local file.
                </DialogContentText>
                <TextField
                  variant="standard"
                  label="Import File"
                  fullWidth
                  placeholder="Paste URL Here"
                  margin="dense"
                  value={this.state.importFile}
                  InputProps={{
                    endAdornment:
                      <InputAdornment position="end">
                        <Tooltip disableInteractive title="Open File">
                          <IconButton onClick={this.onOpenImportFile.bind(this)} size="large">
                            <FolderIcon/>
                          </IconButton>
                        </Tooltip>
                      </InputAdornment>,
                  }}
                  onChange={this.onChangeImportFile.bind(this)} />
              </DialogContent>
              <DialogActions>
                <Button onClick={this.onCloseDialog.bind(this)}>
                  Cancel
                </Button>
                <Button color="primary"
                        disabled={this.state.importFile.length == 0}
                        onClick={this.onFinishImportLibrary.bind(this, this.state.importFile)}>
                  Import
                </Button>
              </DialogActions>
            </Dialog>
            <Dialog
              open={this.state.openMenu == MO.removeAllAlert}
              onClose={this.onCloseDialog.bind(this)}
              aria-labelledby="remove-all-title"
              aria-describedby="remove-all-description">
              {this.state.filters.length == 0 && (
                <React.Fragment>
                  <DialogTitle id="remove-all-title">Delete Library</DialogTitle>
                  <DialogContent>
                    <DialogContentText id="remove-all-description">
                      Are you sure you really wanna delete your entire library...? ಠ_ಠ
                    </DialogContentText>
                  </DialogContent>
                  <DialogActions>
                    <Button onClick={this.onCloseDialog.bind(this)} color="secondary">
                      Cancel
                    </Button>
                    <Button onClick={this.onFinishRemoveAll.bind(this)} color="primary">
                      Yea... I'm sure
                    </Button>
                  </DialogActions>
                </React.Fragment>
              )}
              {this.state.filters.length > 0 && (
                <React.Fragment>
                  <DialogTitle id="remove-all-title">Delete Sources</DialogTitle>
                  <DialogContent>
                    <DialogContentText id="remove-all-description">
                      Are you sure you want to remove these sources from your library?
                    </DialogContentText>
                  </DialogContent>
                  <DialogActions>
                    <Button onClick={this.onCloseDialog.bind(this)} color="secondary">
                      Cancel
                    </Button>
                    <Button onClick={this.onFinishRemoveVisible.bind(this)} color="primary">
                      Confirm
                    </Button>
                  </DialogActions>
                </React.Fragment>
              )}
            </Dialog>
            <Dialog
              open={this.state.openMenu == MO.deleteAlert}
              onClose={this.onCloseDialog.bind(this)}
              aria-labelledby="delete-all-title"
              aria-describedby="delete-all-description">
              {this.state.filters.length == 0 && (
                <React.Fragment>
                  <DialogTitle id="delete-all-title">PERMANENTLY Delete Library</DialogTitle>
                  <DialogContent>
                    <DialogContentText id="delete-all-description">
                      Are you sure you really wanna delete your entire library...? ಠ_ಠ
                    </DialogContentText>
                    <DialogContentText id="delete-all-description">
                      WARNING: THIS WILL DELETE ANY LOCAL FILES FROM DISK
                    </DialogContentText>
                  </DialogContent>
                  <DialogActions>
                    <Button onClick={this.onCloseDialog.bind(this)} color="secondary">
                      Cancel
                    </Button>
                    <Button onClick={this.onFinishDeleteAll.bind(this)} color="primary">
                      PERMANENTLY DELETE FROM DISK
                    </Button>
                  </DialogActions>
                </React.Fragment>
              )}
              {this.state.filters.length > 0 && (
                <React.Fragment>
                  <DialogTitle id="delete-all-title">PERMANENTLY Delete Sources</DialogTitle>
                  <DialogContent>
                    <DialogContentText id="delete-all-description">
                      Are you sure you want to remove these sources from your library?
                    </DialogContentText>
                    <DialogContentText id="delete-all-description">
                      WARNING: THIS WILL DELETE ANY LOCAL FILES FROM DISK
                    </DialogContentText>
                  </DialogContent>
                  <DialogActions>
                    <Button onClick={this.onCloseDialog.bind(this)} color="secondary">
                      Cancel
                    </Button>
                    <Button onClick={this.onFinishDeleteVisible.bind(this)} color="primary">
                      PERMANENTLY DELETE FROM DISK
                    </Button>
                  </DialogActions>
                </React.Fragment>
              )}
            </Dialog>
            {this.props.config.remoteSettings.piwigoHost != "" && (
              <Tooltip disableInteractive title={this.state.filters.length > 0 ? "" : "Piwigo"}  placement="left">
                <Fab
                  sx={(theme) => ({
                    backgroundColor: theme.palette.primary.main,
                    margin: 0,
                    top: 'auto',
                    right: 28,
                    bottom: 25,
                    left: 'auto',
                    position: 'fixed',
                    transition: theme.transitions.create('margin', {
                      easing: theme.transitions.easing.sharp,
                      duration: theme.transitions.duration.enteringScreen,
                    }),
                    marginBottom: '225px',
                    ...(this.state.openMenu != MO.new && {
                      marginBottom: 0,
                      transition: theme.transitions.create(['margin', 'opacity'], {
                        easing: theme.transitions.easing.sharp,
                        duration: theme.transitions.duration.leavingScreen + theme.transitions.duration.standard,
                      }),
                    }),
                    ...(this.state.openMenu == MO.new && {
                      zIndex: theme.zIndex.modal + 1,
                    }),
                    ...(this.state.filters.length > 0 && {
                      opacity: 0,
                      transition: theme.transitions.create(['margin', 'opacity'], {
                        easing: theme.transitions.easing.sharp,
                        duration: 100,
                      }),
                    }),
                  })}
                  disabled={this.state.filters.length > 0}
                  onClick={this.onOpenPiwigoMenu.bind(this)}
                  size="small">
                  <StyledIconWrapper><SourceIcon type={ST.piwigo}/></StyledIconWrapper>
                </Fab>
              </Tooltip>
            )}
            <Tooltip disableInteractive title={this.state.filters.length > 0 ? "" : "Local Directory"}  placement="left">
              <Fab
                sx={(theme) => ({
                  backgroundColor: theme.palette.primary.main,
                  margin: 0,
                  top: 'auto',
                  right: 28,
                  bottom: 25,
                  left: 'auto',
                  position: 'fixed',
                  transition: theme.transitions.create('margin', {
                    easing: theme.transitions.easing.sharp,
                    duration: theme.transitions.duration.enteringScreen,
                  }),
                  marginBottom: '115px',
                  ...(this.state.openMenu != MO.new && {
                    marginBottom: 0,
                    transition: theme.transitions.create(['margin', 'opacity'], {
                      easing: theme.transitions.easing.sharp,
                      duration: theme.transitions.duration.leavingScreen + theme.transitions.duration.standard,
                    }),
                  }),
                  ...(this.state.openMenu == MO.new && {
                    zIndex: theme.zIndex.modal + 1,
                  }),
                  ...(this.state.filters.length > 0 && {
                    opacity: 0,
                    transition: theme.transitions.create(['margin', 'opacity'], {
                      easing: theme.transitions.easing.sharp,
                      duration: 100,
                    }),
                  }),
                })}
                disabled={this.state.filters.length > 0}
                onClick={this.onAddSource.bind(this, AF.directory)}
                size="small">
                <FolderIcon sx={(theme) => ({ color: theme.palette.primary.contrastText })} />
              </Fab>
            </Tooltip>
            <Tooltip disableInteractive title={this.state.filters.length > 0 ? "" : "URL"}  placement="left">
              <Fab
                sx={(theme) => ({
                  backgroundColor: theme.palette.primary.main,
                  margin: 0,
                  top: 'auto',
                  right: 28,
                  bottom: 25,
                  left: 'auto',
                  position: 'fixed',
                  transition: theme.transitions.create('margin', {
                    easing: theme.transitions.easing.sharp,
                    duration: theme.transitions.duration.enteringScreen,
                  }),
                  marginBottom: '60px',
                  ...(this.state.openMenu != MO.new && {
                    marginBottom: 0,
                    transition: theme.transitions.create(['margin', 'opacity'], {
                      easing: theme.transitions.easing.sharp,
                      duration: theme.transitions.duration.leavingScreen + theme.transitions.duration.standard,
                    }),
                  }),
                  ...(this.state.openMenu == MO.new && {
                    zIndex: theme.zIndex.modal + 1,
                  }),
                  ...(this.state.filters.length > 0 && {
                    opacity: 0,
                    transition: theme.transitions.create(['margin', 'opacity'], {
                      easing: theme.transitions.easing.sharp,
                      duration: 100,
                    }),
                  }),
                })}
                disabled={this.state.filters.length > 0}
                onClick={this.onAddSource.bind(this, AF.url)}
                size="small">
                <HttpIcon sx={(theme) => ({ color: theme.palette.primary.contrastText })} />
              </Fab>
            </Tooltip>
            <Fab
              sx={(theme) => ({
                backgroundColor: theme.palette.primary.dark,
                margin: 0,
                top: 'auto',
                right: 20,
                bottom: 20,
                left: 'auto',
                position: 'fixed',
                ...(this.state.openMenu == MO.new && {
                  zIndex: theme.zIndex.modal + 1,
                }),
              })}
              disabled={this.state.filters.length > 0}
              onClick={this.onToggleNewMenu.bind(this)}
              size="large">
              <AddIcon sx={(theme) => ({ color: theme.palette.primary.contrastText })} />
            </Fab>
          </React.Fragment>
        )}

        <URLDialog
          open={this.state.openMenu == MO.urlImport}
          onClose={this.onCloseDialog.bind(this)}
          onImportURL={this.onAddSource.bind(this)}
        />

        <PiwigoDialog
          config={this.props.config}
          open={this.state.openMenu == MO.piwigo}
          onClose={this.onCloseDialog.bind(this)}
          onImportURL={this.onAddSource.bind(this)}
        />
      </Box>
    );
  }

  componentDidMount() {
    this.setState({displaySources: this.getDisplaySources()});
    window.addEventListener('keydown', this.onKeyDown, false);
  }

  componentDidUpdate(props: any, state: any) {
    if (state.filters != this.state.filters || props.library != this.props.library || props.specialMode != this.props.specialMode) {
      this.setState({displaySources: this.getDisplaySources()});
    }
    if (this.props.tutorial == LT.final && this.state.drawerOpen) {
      this.setState({drawerOpen: false});
    }
  }

  componentWillUnmount() {
    window.removeEventListener('keydown', this.onKeyDown);
  }

  // Use alt+P to access import modal
  // Use alt+M to toggle highlighting  sources
  // Use alt+L to move cached offline sources to local sources
  onKeyDown = (e: KeyboardEvent) => {
    if (!e.shiftKey && !e.ctrlKey && e.altKey && (e.key == 'm' || e.key == 'µ')) {
      this.toggleMarked();
    } else if (e.shiftKey && !e.ctrlKey && e.altKey && (e.key == 'M' || e.key == 'µ')) {
      this.addMarked();
    } else if (e.shiftKey && e.ctrlKey && e.altKey && (e.key == 'M' || e.key == 'µ')) {
      this.removeMarked();
    } else if (!e.shiftKey && !e.ctrlKey && e.altKey && (e.key == 'l' || e.key == '¬')) {
      this.moveOffline();
    } else if (e.key == 'Escape' && this.props.specialMode != null) {
      this.goBack();
    }
  };

  moveOffline() {
    this.setState({moveDialog: true});
  }

  async onFinishMove() {
    const fs = getFilesystem();
    const removedSources = new Array<LibrarySource>();
    const movedSources = new Array<{url: string, localPath: string, count: number}>();
    for (let source of this.props.library) {
      if (source.offline) {
        const cachePath = getCachePath(source.url, this.props.config);
        let files: Array<any> = [];
        try {
          files = await fs.readDirectory(cachePath);
        } catch (e) {
          files = [];
        }
        if (files.length == 0) {
          removedSources.push(source);
        } else {
          const localPath = getLocalPath(source.url, this.props.config);
          try {
            for (let file of files) {
              const data = await fs.readFile(cachePath + file.name);
              await fs.writeFile(localPath + file.name, data);
              await fs.deleteFile(cachePath + file.name);
            }
            await fs.deleteDirectory(cachePath);
          } catch (e) {
            console.error(e);
          }
          movedSources.push({url: source.url, localPath: localPath, count: files.length});
        }
      }
    }
    this.props.onUpdateLibrary((l) => {
      const removedURLs = removedSources.map((s) => s.url);
      const movedURLs = new Map(movedSources.map((m) => [m.url, m]));
      for (let i = l.length - 1; i >= 0; i--) {
        const s = l[i];
        if (removedURLs.includes(s.url)) {
          l.splice(i, 1);
        } else if (movedURLs.has(s.url)) {
          const m = movedURLs.get(s.url);
          s.url = m.localPath;
          s.offline = false;
          s.lastCheck = null;
          s.count = m.count;
          s.countComplete = true;
        }
      }
    });
    this.onCloseMoveDialog();
  }

  onCloseMoveDialog() {
    this.setState({moveDialog: false});
  }

  onBatchClip() {
    this.onCloseDialog();
    this.props.onBatchClip();
  }

  onBatchTag() {
    this.onCloseDialog();
    this.props.onBatchTag();
  }

  onFindMerges() {
    this.onUpdateFilters(["<Mergeable>"]);
  }

  getMerges() {
    let merges: Array<LibrarySource> = [];
    let remainingLibrary = this.props.library.filter((ls) => getSourceType(ls.url) == ST.local && ls.tags.length > 0);
    // While we still have sources left to check
    while (remainingLibrary.length > 0) {
      // Grab the first source in the list
      const source = remainingLibrary.splice(0, 1)[0];
      let matches = [source];

      // For the rest of the sources
      for (let rs of remainingLibrary) {
        // Compare tags
        if (rs.tags.length == source.tags.length) {
          let hasAllTags = true;
          const tagNames = source.tags.map((t) => t.name);
          for (let tag of rs.tags) {
            if (!tagNames.includes(tag.name)) {
              hasAllTags = false;
            }
          }
          // If the tags are the same, add to matches
          if (hasAllTags) {
            matches.push(rs);
          }
        }
      }
      // If we've found matches
      if (matches.length > 1) {
        for (let m of matches) {
          if (m != source) {
            // Remove them from the remaining library
            remainingLibrary.splice(remainingLibrary.indexOf(m), 1);
          }
        }
        // Add to the master lit of mergeables
        merges = merges.concat(matches);
      }
    }
    return merges;
  }

  goBack() {
    if (this.props.specialMode == SP.batchTag) {
      this.setState({selected: [], selectedTags: []});
      this.props.onBatchTag();
    } else if (this.props.specialMode == SP.batchClip) {
      this.setState({selected: [], clipOffset: [0, 0]});
      this.props.onBatchClip();
    } else {
      this.props.goBack();
    }
  }

  onUpdateFilters(filters: Array<string>) {
    this.setState({filters: filters, displaySources: this.getDisplaySources()});
  }

  onAddSource(addFunction: string, e: MouseEvent, ...args: any[]) {
    this.onCloseDialog();
    if (addFunction == AF.videos && !!e && e.shiftKey) {
      this.props.onAddSource(null, AF.videoDir, ...args);
    } else if (addFunction == AF.url && !!e && e.shiftKey) {
      this.setState({openMenu: MO.urlImport});
    } else {
      this.props.onAddSource(null, addFunction, ...args);
    }
  }

  onOpenPiwigoMenu() {
    this.setState({openMenu: MO.piwigo});
  }

  onToggleBatchClipModal() {
    if (this.state.openMenu == MO.batchClip) {
      this.setState({openMenu: null, clipOffset: [0, 0]});
    } else {
      this.setState({openMenu: MO.batchClip, clipOffset: [0, 0]});
    }
  }

  onToggleBatchTagModal() {
    if (this.state.openMenu == MO.batchTag) {
      this.setState({openMenu: null, selectedTags: []});
    } else {
      this.setState({openMenu: MO.batchTag, selectedTags: this.getSelectedTags()});
    }
  }

  onSelectTags(selectedTags: Array<string>) {
    this.setState({selectedTags: selectedTags});
  }

  onToggleDrawer() {
    if (this.props.tutorial == LT.sidebar1) {
      this.props.onTutorial(LT.sidebar1);
    }
    this.setState({drawerOpen: !this.state.drawerOpen});
  }

  onToggleNewMenu() {
    this.setState({openMenu: this.state.openMenu == MO.new ? null : MO.new});
  }

  onOpenSortMenu(e: MouseEvent) {
    this.setState({menuAnchorEl: e.currentTarget, openMenu: MO.sort});
  }

  onCloseDialog() {
    this.setState({menuAnchorEl: null, openMenu: null, drawerOpen: false, importFile: ""});
  }

  onRemoveAll(e: MouseEvent) {
    if (e.shiftKey && e.altKey && e.ctrlKey) {
      this.setState({openMenu: MO.deleteAlert});
    } else {
      this.setState({openMenu: MO.removeAllAlert});
    }
  }

  onFinishRemoveAll() {
    this.props.onUpdateLibrary((l) => {
      l.splice(0, l.length);
    });
    this.onCloseDialog();
  }

  onFinishRemoveVisible() {
    this.props.onUpdateLibrary((l) => {
      const displayIDs = this.state.displaySources.map((s) => s.id);
      for (let i = l.length -1; i >= 0 ; i--) {
        if (displayIDs.includes(l[i].id)) {
          l.splice(i, 1);
        }
      }
    });
    this.onCloseDialog();
    this.setState({filters: []});
  }

  async onFinishDeleteAll() {
    for (let l of this.props.library) {
      const fileType = getSourceType(l.url);
      try {
        if (fileType == ST.local) {
          await getFilesystem().deleteDirectory(l.url);
        } else if (fileType == ST.video || fileType == ST.playlist || fileType == ST.list) {
          await getFilesystem().deleteFile(l.url);
        }
      } catch (e) {
        console.error(e);
      }
    }
    this.props.onUpdateLibrary((l) => {
      l.splice(0, l.length);
    });
    this.onCloseDialog();
  }

  async onFinishDeleteVisible() {
    const displayIDs = this.state.displaySources.map((s) => s.id);
    const sourcesToDelete = this.props.library.filter((s) => displayIDs.includes(s.id));
    for (const source of sourcesToDelete) {
      const sourceURL = source.url;
      const fileType = getSourceType(sourceURL);
      try {
        if (fileType == ST.local) {
          await getFilesystem().deleteDirectory(sourceURL);
        } else if (fileType == ST.video || fileType == ST.playlist || fileType == ST.list) {
          await getFilesystem().deleteFile(sourceURL);
          await getFilesystem().deleteFile(getCachePath(sourceURL, this.props.config) + getFileName(sourceURL));
        } else {
          await getFilesystem().deleteDirectory(getCachePath(sourceURL, this.props.config));
        }
      } catch (e) {
        console.error(e);
      }
    }
    this.props.onUpdateLibrary((l) => {
      const currentDisplayIDs = this.state.displaySources.map((s) => s.id);
      for (let i = l.length -1; i >= 0 ; i--) {
        if (currentDisplayIDs.includes(l[i].id)) {
          l.splice(i, 1);
        }
      }
    });
    this.onCloseDialog();
    this.setState({filters: []});
  }

  onOpenImportFile() {
    pickFiles({filters: [{name:'All Files (*.*)', extensions: ['*']},{name: 'JSON Document', extensions: ['json']}]})
      .then(result => {
      if (result.canceled || !result.filePaths.length) return;
      this.setState({importFile: result.filePaths[0]});
    });
  }

  onChangeImportFile(e: MouseEvent) {
    const input = (e.target as HTMLInputElement);
    this.setState({importFile: input.value});
  }

  onImportLibrary() {
    this.setState({openMenu: MO.libraryImport});
  }

  onFinishImportLibrary() {
    if (this.state.importFile.startsWith("http")) {
      wretch(this.state.importFile)
        .get()
        .text((text) => {
          let json;
          try {
            json = JSON.parse(text);
            this.props.onImportLibrary(json);
            this.onCloseDialog();
          } catch (e) {
            this.props.systemMessage("This is not a valid JSON file");
          }
        })
        .catch((e) => {
          this.props.systemMessage("Error accessing URL");
        });
    } else {
      getFilesystem().readFileText(this.state.importFile)
        .then((text) => {
          let json;
          try {
            json = JSON.parse(text);
            this.props.onImportLibrary(json);
            this.onCloseDialog();
          } catch (e) {
            this.props.systemMessage("This is not a valid JSON file");
          }
        })
        .catch((e) => {
          this.props.systemMessage("This is not a valid JSON file");
          console.error(e);
        });
    }
  }

  onImportFromLibrary() {
    const selected = this.state.selected;
    const sources = new Array<LibrarySource>();
    for (let url of selected) {
      const source = this.props.library.find((s) => s.url == url);
      if (source) {
        sources.push(source);
      }
    }
    this.props.onImportFromLibrary(sources);
  }

  onUpdateSelected(selected: Array<string>) {
    this.setState({selected: selected});
  }

  onSelectAll() {
    const displaySources = this.state.displaySources;
    const newSelected = Array.from(this.state.selected);
    for (let source of displaySources.map((s) => s.url)) {
      if (!newSelected.includes(source)) {
        newSelected.push(source);
      }
    }
    this.setState({selected: newSelected});
  }

  onSelectNone() {
    const displaySources = this.state.displaySources;
    let newSelected = Array.from(this.state.selected);
    for (let source of displaySources.map((s) => s.url)) {
      if (newSelected.includes(source)) {
        newSelected.splice(newSelected.indexOf(source), 1)
      }
    }
    this.setState({selected: newSelected});
  }

  savePosition() {
    const sortableList = document.getElementById("sortable-list");
    if (sortableList) {
      const scrollElement = sortableList.firstElementChild;
      const scrollTop = scrollElement ? scrollElement.scrollTop : 0;
      this.props.savePosition(scrollTop, this.state.filters, this.state.selected);
    }
  }

  toggleMarked(taggingMode?: boolean) {
    if (taggingMode == null) {
      taggingMode = this.props.library.find((s) => s.marked) == null;
    }

    if (taggingMode) { // We're marking sources
      this.props.onUpdateLibrary((l) => {
        for (let source of this.state.displaySources) {
          l.find((s) => s.id == source.id).marked = true;
        }
      });
    } else { // We're unmarking sources
      this.props.onUpdateLibrary((l) => {
        for (let source of l) {
          source.marked = false;
        }
      });
    }
  }


  addMarked() {
    this.toggleMarked(true);
  }

  removeMarked() {
    this.toggleMarked(false);
  }

  batchTagOverwrite() {
    this.props.onUpdateLibrary((l) => {
      for (let sourceURL of this.state.selected) {
        const source = l.find((s) => s.url === sourceURL);
        source.tags = new Array<Tag>();
        for (let tag of this.state.selectedTags) {
          source.tags.push(new Tag({name: tag, id: this.props.tags.find((t) => t.name == tag).id}));
        }
      }
    });
    this.onCloseDialog();
  }

  batchTagAdd() {
    this.props.onUpdateLibrary((l) => {
      for (let sourceURL of this.state.selected) {
        const source = l.find((s) => s.url === sourceURL);
        const sourceTags = source.tags.map((t) => t.name);
        for (let tag of this.state.selectedTags) {
          if (!sourceTags.includes(tag)) {
            source.tags.push(new Tag({name: tag, id: this.props.tags.find((t) => t.name == tag).id}));
          }
        }
      }
    });
    this.onCloseDialog();
  }

  batchTagRemove() {
    this.props.onUpdateLibrary((l) => {
      for (let sourceURL of this.state.selected) {
        const source = l.find((s) => s.url === sourceURL);
        const sourceTags = source.tags.map((t) => t.name);
        for (let tag of this.state.selectedTags) {
          if (sourceTags.includes(tag)) {
            const indexOf = sourceTags.indexOf(tag);
            source.tags.splice(indexOf, 1);
            sourceTags.splice(indexOf, 1);
          }
        }
      }
    });
    this.onCloseDialog();
  }

  getSelectedTags() {
    let tagSelectValue = new Array<string>();
    let commonTags = Array<Tag>();
    for (let sourceURL of this.state.selected) {
      const source = this.props.library.find((s) => s.url === sourceURL);
      const tags = source.tags;
      if (commonTags.length == 0) {
        commonTags = tags;
      } else {
        const tagNames = tags.map((t) => t.name);
        commonTags = commonTags.filter((t) => tagNames.includes(t.name));
      }

      if (commonTags.length == 0) break;
    }

    if (commonTags.length > 0) {
      tagSelectValue = commonTags.map((t) => t.name);
    }

    return tagSelectValue;
  }

  getDisplaySources() {
    let displaySources = [];
    const filtering = this.state.filters.length > 0;
    if (filtering) {
      const mergeSources = this.state.filters.includes("<Mergeable>") ? this.getMerges() : null;
      for (let source of mergeSources ? mergeSources : this.props.library) {
        let matchesFilter = true;
        for (let filter of this.state.filters) {
          matchesFilter = filterSource(filter, source, null, mergeSources);
          if (!matchesFilter) break;
        }
        if (matchesFilter) {
          displaySources.push(source);
        }
      }
    } else {
      displaySources = this.props.library;
    }
    if (this.props.specialMode == SP.batchClip) {
      displaySources = displaySources.filter((s) => getSourceType(s.url) == ST.video);
    }
    return displaySources;
  }
}

(Library as any).displayName="Library";
export default Library;
