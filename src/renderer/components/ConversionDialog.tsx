import * as React from "react";

import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  LinearProgress,
} from "@mui/material";

import {
  getConversionState,
  subscribeConversion,
  skipCurrentFile,
  cancelImport,
} from "../services/convert-state";

/**
 * Conversion progress dialog shown while imported media is being optimized.
 * Rendered into its own React root (outside the app tree) so it works no matter
 * which screen initiated the import. Offers:
 *  - Skip: save the current file AS-IS (no conversion) and continue.
 *  - Cancel: stop the batch; files already imported so far are still added.
 */
class ConversionDialog extends React.Component {
  readonly state: { open: boolean; total: number; current: number; name: string } = getConversionState();

  private unsub: (() => void) | null = null;

  componentDidMount() {
    this.unsub = subscribeConversion(() => this.setState(getConversionState()));
  }

  componentWillUnmount() {
    if (this.unsub) this.unsub();
  }

  render() {
    const s = this.state;
    if (!s.open) return null;
    const pct = s.total > 0 ? Math.min(100, Math.round((s.current / s.total) * 100)) : 0;
    return (
      <Dialog
        open
        onClose={cancelImport}
        aria-describedby="convert-description"
      >
        <DialogTitle>Optimizing media for your device</DialogTitle>
        <DialogContent>
          <DialogContentText id="convert-description" component="div">
            {s.total > 0
              ? `File ${Math.min(s.current, s.total)} of ${s.total}${s.name ? ` — ${s.name}` : ""}`
              : s.name || "Preparing…"}
          </DialogContentText>
          <LinearProgress variant="determinate" value={pct} sx={{ mt: 2 }} />
        </DialogContent>
        <DialogActions>
          <Button onClick={skipCurrentFile} color="primary">
            Skip (save as-is)
          </Button>
          <Button onClick={cancelImport} color="error">
            Cancel
          </Button>
        </DialogActions>
      </Dialog>
    );
  }
}

(ConversionDialog as any).displayName = "ConversionDialog";
export default ConversionDialog;