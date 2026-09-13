import * as React from 'react';
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  FormControlLabel,
  Grid,
  Radio,
  RadioGroup,
  Switch,
  Tooltip,
  Typography
} from '@mui/material';
import { GeneralSettings } from '../../data/Config';
import { isCapacitor } from '../../services/platform';
import { optimizeLibrary } from '../../services/optimize-library';

interface MediaOptimizationCardProps {
  generalSettings: GeneralSettings;
  onUpdateSettings: (fn: (settings: GeneralSettings) => void) => void;
}

const MEDIA_OPTIMIZATION_CARD_STYLE: React.CSSProperties = {
  overflow: 'visible',
};

type OptimizeState = {
  confirmOpen: boolean;
  keepOriginal: boolean;
  running: boolean;
  done: string | null;
};

export default class MediaOptimizationCard extends React.Component<MediaOptimizationCardProps> {
  readonly state: OptimizeState = {
    confirmOpen: false,
    keepOriginal: false,
    running: false,
    done: null,
  };

  async start() {
    const { keepOriginal } = this.state;
    this.setState({ confirmOpen: false, running: true, done: null });
    try {
      const summary = await optimizeLibrary({ keepOriginal });
      if (summary.canceled) {
        this.setState({ running: false, done: `Stopped — optimized ${summary.converted} of ${summary.total} files so far.` });
      } else {
        this.setState({ running: false, done: `Done — optimized ${summary.converted} of ${summary.total} files.` });
      }
    } catch (e) {
      console.error(e);
      this.setState({ running: false, done: 'Optimization failed. See the logs for details.' });
    }
  }

  render() {
    const enabled = this.props.generalSettings.mediaOptimizationEnabled ?? true;
    const { confirmOpen, keepOriginal, running, done } = this.state;
    return (
      <div style={MEDIA_OPTIMIZATION_CARD_STYLE}>
        <Grid container spacing={2}>
          <Grid item xs={12}>
            <Typography variant="h6">Media Optimization</Typography>
          </Grid>
          <Grid item xs={12}>
            <Tooltip
              disableInteractive
              placement="top"
              title={
                <div>
                  Heavy camera files (HDR, wider/taller than 1080p×1920, HEIC/HEIF, larger than ~8 MB, or
                  videos over ~100 MB / 20 Mbps) are converted to SDR 1080p when you import them, and only the
                  optimized copy is kept. Turning this off imports your files completely untouched — they stay
                  original quality but are much larger and may be slower to play or not play at all (HDR/HEIC).
                </div>
              }
            >
              <FormControlLabel
                control={
                  <Switch
                    checked={enabled}
                    onChange={(_, checked) => this.props.onUpdateSettings((s) => { s.mediaOptimizationEnabled = checked; })}
                  />
                }
                label={enabled ? 'Convert heavy media on import (default)' : 'Import media untouched'}
              />
            </Tooltip>
          </Grid>
          <Grid item xs={12}>
            <Typography variant="body2" color="textSecondary">
              When on, imported camera media is converted to SDR 1080p so slideshows run smoothly and store less.
              When off, your files are imported exactly as they are — no conversion, no quality loss, but heavier
              storage and possible playback issues with HDR/HEIC files. Changes apply to new imports.
            </Typography>
          </Grid>
          {isCapacitor() && (
            <Grid item xs={12}>
              <Button
                variant="outlined"
                color="primary"
                disabled={running}
                onClick={() => this.setState({ confirmOpen: true })}
              >
                {running ? 'Optimizing…' : 'Optimize Existing Library…'}
              </Button>
              {done && (
                <Typography variant="body2" color="textSecondary" style={{ marginTop: 8 }}>
                  {done}
                </Typography>
              )}
            </Grid>
          )}
        </Grid>
        {confirmOpen && (
          <Dialog
            open
            onClose={() => this.setState({ confirmOpen: false })}
            aria-labelledby="optimize-library-title"
            aria-describedby="optimize-library-description"
          >
            <DialogTitle id="optimize-library-title">Optimize Existing Library</DialogTitle>
            <DialogContent>
              <DialogContentText id="optimize-library-description" component="div">
                Scans every local image/video referenced by your library (plus everything in imported/) and converts
                heavy files — HDR, oversized, or high bitrate — to lightweight SDR 1080p copies that play smoothly on
                mobile. Folder sources that scan whole directories are left untouched.
              </DialogContentText>
              <RadioGroup
                aria-label="optimize-mode"
                value={keepOriginal}
                onChange={(_, v) => this.setState({ keepOriginal: v === "true" })}
              >
                <FormControlLabel
                  value="false"
                  control={<Radio />}
                  label="Delete originals after conversion — frees the most space"
                />
                <FormControlLabel
                  value="true"
                  control={<Radio />}
                  label="Keep original files too — only adds optimized copies"
                />
              </RadioGroup>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => this.setState({ confirmOpen: false })} color="secondary">
                Cancel
              </Button>
              <Button onClick={() => this.start()} color="primary" autoFocus>
                Start
              </Button>
            </DialogActions>
          </Dialog>
        )}
      </div>
    );
  }
}

(MediaOptimizationCard as any).displayName = 'MediaOptimizationCard';