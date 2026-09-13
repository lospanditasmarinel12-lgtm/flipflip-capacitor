import * as React from "react";

import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Grid,
} from "@mui/material";
import PhotoLibraryIcon from "@mui/icons-material/PhotoLibrary";
import FolderOpenIcon from "@mui/icons-material/FolderOpen";

import {
  getSourcePickerState,
  subscribeSourcePicker,
  resolveSource,
} from "../services/picker-source";

/**
 * Asks where the mobile import should pull media from: the Photo Library
 * (PHPicker) or the Files document picker — restoring the choice the web
 * <input> picker used to offer.
 */
class SourcePickerDialog extends React.Component {
  readonly state: { open: boolean } = getSourcePickerState();
  private unsub: (() => void) | null = null;

  componentDidMount() {
    this.unsub = subscribeSourcePicker(() => this.setState(getSourcePickerState()));
  }

  componentWillUnmount() {
    if (this.unsub) this.unsub();
  }

  render() {
    if (!this.state.open) return null;
    return (
      <Dialog open onClose={() => resolveSource(null)}>
        <DialogTitle>Import Media</DialogTitle>
        <DialogContent>
          <Grid container spacing={1}>
            <Grid item xs={12}>
              <Button
                variant="contained"
                color="primary"
                fullWidth
                size="large"
                startIcon={<PhotoLibraryIcon />}
                onClick={() => resolveSource("media")}
              >
                Photo Library
              </Button>
            </Grid>
            <Grid item xs={12}>
              <Button
                variant="outlined"
                fullWidth
                size="large"
                startIcon={<FolderOpenIcon />}
                onClick={() => resolveSource("files")}
              >
                Files
              </Button>
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => resolveSource(null)} color="inherit">
            Cancel
          </Button>
        </DialogActions>
      </Dialog>
    );
  }
}

(SourcePickerDialog as any).displayName = "SourcePickerDialog";
export default SourcePickerDialog;