import * as React from "react";

import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  Grid,
  Typography,
} from "@mui/material";

import { getFilesystem } from "../../services/filesystem";
import { isCapacitor } from "../../services/platform";

/**
 * Storage — media imported through the picker is copied into the app's data
 * directory (Directory.Data/imported/, content-addressed). Removing a scene or
 * library entry only unlinks the reference; the file stays on disk and blocks
 * re-importing the same media (duplicates are detected by the stored file).
 *
 * This card shows how much space imported files use and offers "Erase All" so
 * users can free storage and re-import later. (Not shown on desktop — imported/
 * only exists in the Capacitor app; noContent-addressed import pipeline there.)
 */
class StorageCard extends React.Component {
  readonly state = {
    count: null as number | null,
    size: null as number | null,
    confirm: false,
    erasing: false,
    error: null as string,
  };

  componentDidMount() {
    if (isCapacitor()) {
      this.refresh();
    }
  }

  async refresh() {
    try {
      const entries = await getFilesystem().readDirectory("imported");
      let size = 0;
      try {
        size = await getFilesystem().getDirectorySize("imported");
      } catch (_) {}
      this.setState({ count: entries.length, size });
    } catch (e) {
      // imported/ may not exist yet — nothing stored.
      this.setState({ count: 0, size: 0 });
    }
  }

  async eraseAll() {
    this.setState({ erasing: true, error: null });
    try {
      try {
        await getFilesystem().deleteDirectory("imported");
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (!/NOT.?EXIST|NOENT|ENOENT/i.test(msg)) {
          throw e;
        }
      }
      this.setState({ count: 0, size: 0, confirm: false, error: null });
    } catch (e) {
      this.setState({ error: e instanceof Error ? e.message : String(e), confirm: false });
    } finally {
      this.setState({ erasing: false });
    }
  }

  formatBytes(bytes: number): string {
    if (bytes < 1024) return bytes + " B";
    const units = ["KB", "MB", "GB", "TB"];
    let u = -1;
    do {
      bytes /= 1024;
      ++u;
    } while (bytes >= 1024 && u < units.length - 1);
    return bytes.toFixed(u > 0 ? 1 : 0) + " " + units[u];
  }

  render() {
    if (!isCapacitor()) return null;
    const { count, size, confirm, erasing, error } = this.state;
    return (
      <Grid container spacing={2}>
        <Grid item xs={12}>
          <Typography variant="h6">Storage</Typography>
          <Typography variant="body2" color="text.secondary" gutterBottom>
            Media imported through the picker is stored inside this app. Deleting a scene or list only removes
            the entries here — the files stay on this device and can't be re-imported while they exist. Use this
            to free space and allow re-importing.
          </Typography>
        </Grid>
        <Grid item xs={12}>
          <Typography variant="body2">
            Imported files: <b>{count ?? "…"}</b> · {size != null ? this.formatBytes(size) : "…"}
          </Typography>
        </Grid>
        <Grid item xs={12}>
          <Button
            variant="outlined"
            color="error"
            disabled={erasing || count === 0}
            onClick={() => this.setState({ confirm: true })}
          >
            {erasing ? "Erasing…" : "Erase All Imported Files"}
          </Button>
        </Grid>
        {error && (
          <Grid item xs={12}>
            <Typography variant="body2" color="error">
              {error}
            </Typography>
          </Grid>
        )}
        {confirm && (
          <Dialog
            open
            onClose={() => this.setState({ confirm: false })}
            aria-describedby="storage-erase-description"
          >
            <DialogContent>
              <DialogContentText id="storage-erase-description">
                Erase <b>all</b> imported files from this device? This frees storage and lets you import the same
                media again. Existing scenes/library entries that referenced them will appear offline until
                re-imported.
              </DialogContentText>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => this.setState({ confirm: false })} color="secondary">
                Cancel
              </Button>
              <Button onClick={() => this.eraseAll()} color="error">
                Erase All
              </Button>
            </DialogActions>
          </Dialog>
        )}
      </Grid>
    );
  }
}

(StorageCard as any).displayName = "StorageCard";
export default StorageCard;