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
  DetachedConvert,
} from "../services/convert-state";

/**
 * Conversion progress dialog shown while imported media is being optimized.
 * Rendered into its own React root (outside the app tree) so it works no matter
 * which screen initiated the import.
 *
 * It stays open across BOTH phases of an import:
 *  1. the import loop (per-file "File X of Y" progress), and
 *  2. the detached background conversions that keep running afterward
 *     ("Converting X of Y — name"), so the popup only dismisses once every
 *     converted file has actually finished — even if you minimize the app,
 *     since the native foreground service keeps encoding.
 *
 * Buttons appear only when they mean something:
 *  - Skip (only when a per-file signal is armed): save the current file AS-IS
 *    (no conversion) and continue.
 *  - Cancel (while an import batch or background conversions are live): stop;
 *    files already imported/optimized so far are still kept.
 */
class ConversionDialog extends React.Component {
  readonly state: {
    open: boolean;
    total: number;
    current: number;
    name: string;
    active: boolean;
    hasSignal: boolean;
    detached: DetachedConvert[];
  } = getConversionState();

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

    const pending = s.detached.filter((d) => !d.settled);
    const convertedDone = s.detached.length - pending.length;
    const phase2Live = pending.length > 0;
    // Prefer the import-loop progress while it's live, otherwise the detached
    // conversions determine the bar.
    const active = s.active && s.total > 0;
    const numerator = active ? Math.min(s.current, s.total) : convertedDone;
    const denominator = active ? s.total : s.detached.length;
    const pct = denominator > 0 ? Math.min(100, Math.round((numerator / denominator) * 100)) : 0;
    const currentName = active && s.name
      ? s.name
      : (pending[0]?.name || (s.detached.length > 0 ? s.detached[s.detached.length - 1].name : ""));

    const lines: React.ReactNode[] = [];
    if (active) {
      lines.push(`File ${Math.min(s.current, s.total)} of ${s.total}${s.name ? ` — ${s.name}` : ""}`);
    }
    if (phase2Live) {
      lines.push(
        <span key="batch">
          Converting {convertedDone} of {s.detached.length}
          {currentName ? ` — ${currentName}` : ""}
        </span>
      );
    }
    if (lines.length === 0) {
      lines.push(s.name || "Preparing…");
    }

    const canCancel = s.active || phase2Live;

    return (
      <Dialog
        open
        onClose={cancelImport}
        aria-describedby="convert-description"
      >
        <DialogTitle>Optimizing media for your device</DialogTitle>
        <DialogContent>
          <DialogContentText id="convert-description" component="div">
            {lines.map((line, i) => (
              <React.Fragment key={i}>
                {i > 0 && <br />}
                {line}
              </React.Fragment>
            ))}
          </DialogContentText>
          <LinearProgress variant="determinate" value={pct} sx={{ mt: 2 }} />
        </DialogContent>
        <DialogActions>
          {s.hasSignal && (
            <Button onClick={skipCurrentFile} color="primary">
              Skip (save as-is)
            </Button>
          )}
          {canCancel && (
            <Button onClick={cancelImport} color="error">
              Cancel
            </Button>
          )}
        </DialogActions>
      </Dialog>
    );
  }
}

(ConversionDialog as any).displayName = "ConversionDialog";
export default ConversionDialog;