import * as React from "react";

import {
  AppBar,
  Dialog,
  IconButton,
  List,
  ListItemButton,
  ListItemText,
  TextField,
  Toolbar,
  Typography,
} from "@mui/material";
import { styled } from "@mui/material/styles";

import ArrowBackIcon from '@mui/icons-material/ArrowBack';

import Scene from "../../data/Scene";
import SceneGrid from "../../data/SceneGrid";
import {areWeightsValid} from "../../data/utils";

const StyledAppBar = styled(AppBar)({
  paddingTop: 'var(--safe-area-inset-top, env(safe-area-inset-top, 0px))',
});

class ScenePickerDialog extends React.Component {
  readonly props: {
    open: boolean,
    allScenes: Array<Scene>,
    value: number,
    allSceneGrids?: Array<SceneGrid>,
    scene?: Scene,
    includeExtra?: boolean,
    onlyExtra?: boolean,
    title?: string,
    getSceneName(sceneID: string): string,
    onChange(sceneID: any): void,
    onClose(): void,
  };

  readonly state = {
    search: "",
  };

  render() {
    const options = this.buildOptions() as Array<{label: string, value: string}>;
    const query = this.state.search.trim().toLowerCase();
    const filtered = query === "" ? options : options.filter((o) => o.label.toLowerCase().includes(query));
    return (
      <Dialog fullScreen open={this.props.open} onClose={this.props.onClose}>
        <StyledAppBar position="static">
          <Toolbar>
            <IconButton
              edge="start"
              color="inherit"
              aria-label="Back"
              onClick={this.props.onClose}
              size="large">
              <ArrowBackIcon />
            </IconButton>
            <Typography noWrap sx={{ ml: 1, flexGrow: 1, textAlign: 'center' }}>
              {this.props.title || "Select Scene"}
            </Typography>
            <TextField
              variant="standard"
              placeholder="Search"
              value={this.state.search}
              onChange={this.onChangeSearch.bind(this)}
              slotProps={{
                htmlInput: {
                  sx: {
                    color: (theme) => theme.palette.primary.contrastText,
                    '&::placeholder': {
                      color: (theme) => theme.palette.primary.contrastText,
                      opacity: 0.7,
                    },
                  },
                },
              }}
              sx={{ minWidth: 160 }}
              autoFocus/>
          </Toolbar>
        </StyledAppBar>
        <List disablePadding sx={{ flexGrow: 1, overflow: 'auto' }}>
          {filtered.map((o) =>
            <ListItemButton
              key={o.value}
              selected={this.props.value.toString() === o.value}
              onClick={this.onSelect.bind(this, o.value)}>
              <ListItemText primary={o.label} slotProps={{ primary: { noWrap: true, sx: { overflow: 'hidden', textOverflow: 'ellipsis' } } }} />
            </ListItemButton>
          )}
          {filtered.length == 0 && (
            <ListItemButton disabled>
              <ListItemText primary="No matches"/>
            </ListItemButton>
          )}
        </List>
      </Dialog>
    );
  }

  onChangeSearch(e: React.FormEvent<HTMLInputElement>) {
    this.setState({search: e.currentTarget.value});
  }

  onSelect(value: string) {
    this.props.onChange(value);
    this.setState({search: ""});
    this.props.onClose();
  }

  buildOptions() {
    let defaults = [this.props.onlyExtra ? "-1" : "0"];
    if (this.props.includeExtra) {
      defaults = ["0", "-1"];
    }
    const scenes = this.props.allScenes.filter((s) => (!this.props.scene || s.id !== this.props.scene.id) && (s.sources.length > 0 || (s.regenerate && areWeightsValid(s)))).map((s) => s.id.toString());
    let idList = defaults.concat(scenes);
    if (this.props.allSceneGrids) {
      idList = idList.concat(this.props.allSceneGrids.map((s) => "999" + s.id));
    }
    return idList.map((id) => ({label: this.props.getSceneName(id), value: id}))
      .filter((o) => o.label != "library_scene_temp");
  }
}

(ScenePickerDialog as any).displayName="ScenePickerDialog";
export default ScenePickerDialog;