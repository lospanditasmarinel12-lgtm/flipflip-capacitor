import * as React from "react";
import {useState} from "react";

import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  TextField,
} from "@mui/material";

function MoveToIndexDialog(props: {open: boolean, title: string, max: number, onClose(): void, onConfirm(index: number): void}) {
  const [value, setValue] = useState<string>("1");
  const max = Math.max(1, props.max || 1);
  const index = parseInt(value, 10);
  const valid = !isNaN(index) && index >= 1 && index <= max;

  return (
    <Dialog
      open={props.open}
      onClose={props.onClose}
      fullWidth
      maxWidth="xs"
      aria-labelledby="move-to-index-title">
      <DialogContent>
        <DialogContentText id="move-to-index-title">
          {props.title}
        </DialogContentText>
        <TextField
          autoFocus
          fullWidth
          variant="standard"
          type="number"
          margin="dense"
          label="Index"
          placeholder={"1 - " + max}
          inputProps={{ min: 1, max, inputMode: 'numeric' }}
          helperText={"Enter a position from 1 to " + max}
          value={value}
          onChange={(e) => setValue((e.target as HTMLInputElement).value)} />
      </DialogContent>
      <DialogActions>
        <Button onClick={props.onClose} color="secondary">
          Cancel
        </Button>
        <Button
          disabled={!valid}
          onClick={() => {
            props.onConfirm(index);
            props.onClose();
          }}
          color="primary">
          Move
        </Button>
      </DialogActions>
    </Dialog>
  );
}

(MoveToIndexDialog as any).displayName="MoveToIndexDialog";
export default MoveToIndexDialog;