import * as React from 'react';
import {
  FormControlLabel, Grid, InputLabel, MenuItem, Select, Switch, TextField, Typography
} from '@mui/material';

interface HapticTransportCardProps {
  hapticTransport: string;
  hapticWSEndpoint: string;
  nativeAudioPlayback?: boolean;
  onUpdateSettings: (fn: (settings: any) => void) => void;
}

const HAPTIC_TRANSPORT_CARD_STYLE: React.CSSProperties = {
  overflow: 'visible',
};

export default class HapticTransportCard extends React.Component<HapticTransportCardProps> {
  render() {
    return (
      <div style={HAPTIC_TRANSPORT_CARD_STYLE}>
        <Grid container spacing={2}>
          <Grid item xs={12}>
            <Typography variant="h6">Haptic Settings</Typography>
          </Grid>

          <Grid item xs={12}>
            <Typography variant="body2" color="textSecondary" gutterBottom>
              Configure how FlipFlip connects to haptic devices.
            </Typography>
          </Grid>

          <Grid item xs={12}>
            <InputLabel>Device Transport</InputLabel>
            <Select
              value={this.props.hapticTransport}
              onChange={(e) => this.props.onUpdateSettings((s) => { s.hapticTransport = e.target.value; })}
              fullWidth
            >
              <MenuItem value="auto">Auto (Web Bluetooth, fallback to Intiface)</MenuItem>
              <MenuItem value="wasm">Web Bluetooth (built-in, no extra app)</MenuItem>
              <MenuItem value="websocket">Intiface Central (separate app, more reliable)</MenuItem>
            </Select>
          </Grid>

          {this.props.hapticTransport !== 'wasm' && (
            <Grid item xs={12}>
              <TextField
                label="Intiface Central WebSocket URL"
                value={this.props.hapticWSEndpoint}
                onChange={(e) => this.props.onUpdateSettings((s) => { s.hapticWSEndpoint = e.target.value; })}
                fullWidth
                size="small"
                helperText="Default: ws://127.0.0.1:12345 — on mobile this is the phone itself, so enter your computer's LAN IP instead (e.g. ws://192.168.1.10:12345)."
              />
            </Grid>
          )}

          <Grid item xs={12}>
            <FormControlLabel
              control={
                <Switch
                  checked={!!this.props.nativeAudioPlayback}
                  onChange={(_, checked) => this.props.onUpdateSettings((s) => { s.nativeAudioPlayback = checked; })}
                />
              }
              label="Native Audio Playback (background-safe)"
            />
            <Typography variant="body2" color="textSecondary">
              Play the scene audio track through the system audio player instead of the WebView. The WebView's
              single-media limit means a playing video otherwise pauses the scene audio (Android) and can pause
              music in other apps. Native playback keeps both going. Haptic analysis continues through a native
              meter. Restart the scene to apply.
            </Typography>
          </Grid>

          <Grid item xs={12}>
            <Typography variant="body2" color="textSecondary">
              <strong>Auto</strong>: Tries Web Bluetooth first (via the native Bluetooth plugin on mobile). Falls back to Intiface Central only if you configured a reachable endpoint.<br/>
              <strong>Web Bluetooth</strong>: Uses Bluetooth directly; no extra app.<br/>
              <strong>Intiface Central</strong>: Connects to the Intiface Central app. On mobile, run it on your computer and enter that computer's LAN IP — <code>ws://127.0.0.1:12345</code> refers to the phone itself and will not work. Most reliable. <a href="https://intiface.com/central/" target="_blank" rel="noreferrer">Download Intiface Central</a>
            </Typography>
          </Grid>
        </Grid>
      </div>
    );
  }
}

(HapticTransportCard as any).displayName="HapticTransportCard";
