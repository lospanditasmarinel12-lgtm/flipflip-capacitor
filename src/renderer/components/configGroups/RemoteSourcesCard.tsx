import * as React from "react";
import wretch from "wretch";

import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Grid,
  InputAdornment,
  MenuItem,
  Select,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";

import {RemoteSettings} from "../../data/Config";
import {ST} from "../../data/const";
import SourceIcon from "../library/SourceIcon";

/**
 * Remote-source configuration (web-safe subset of the desktop APICard).
 *
 * Desktop shows: Tumblr, Instagram, Hydrus, Rule34, Gelbooru, Piwigo.
 * All of those are VISIBLE here too; the OAuth-loop services (Tumblr,
 * Reddit, Twitter) require a desktop browser callback and are shown as
 * disabled entries with an explanatory note instead of the working
 * self-hosted/API-key services (Piwigo, Hydrus, Rule34, Gelbooru) and
 * Instagram (direct login, enabled here).
 */
class RemoteSourcesCard extends React.Component {
  readonly props: {
    settings: RemoteSettings,
    onUpdateSettings(fn: (settings: RemoteSettings) => void): void,
  };

  readonly state = {
    active: null as 'piwigo' | 'hydrus' | 'rule34' | 'gelbooru' | null,
    oauthNote: null as 'tumblr' | 'reddit' | 'twitter' | 'instagram' | null,
    testing: false,
    toast: null as string,
    toastError: false,
    // Piwigo
    piwigoProtocol: this.props.settings.piwigoProtocol,
    piwigoHost: this.props.settings.piwigoHost,
    piwigoUsername: this.props.settings.piwigoUsername,
    piwigoPassword: this.props.settings.piwigoPassword,
    // Hydrus
    hydrusProtocol: this.props.settings.hydrusProtocol,
    hydrusDomain: this.props.settings.hydrusDomain,
    hydrusPort: this.props.settings.hydrusPort,
    hydrusAPIKey: this.props.settings.hydrusAPIKey,
    // Rule34
    rule34APIKey: this.props.settings.rule34APIKey,
    rule34UserID: this.props.settings.rule34UserID,
    // Gelbooru
    gelbooruAPIKey: this.props.settings.gelbooruAPIKey,
    gelbooruUserID: this.props.settings.gelbooruUserID,
  };

  setActive(active: 'piwigo' | 'hydrus' | 'rule34' | 'gelbooru' | null) {
    // Re-read persisted values fresh from props each time the section opens.
    this.setState({
      active,
      toast: null,
      toastError: false,
      piwigoProtocol: this.props.settings.piwigoProtocol,
      piwigoHost: this.props.settings.piwigoHost,
      piwigoUsername: this.props.settings.piwigoUsername,
      piwigoPassword: this.props.settings.piwigoPassword,
      hydrusProtocol: this.props.settings.hydrusProtocol,
      hydrusDomain: this.props.settings.hydrusDomain,
      hydrusPort: this.props.settings.hydrusPort,
      hydrusAPIKey: this.props.settings.hydrusAPIKey,
      rule34APIKey: this.props.settings.rule34APIKey,
      rule34UserID: this.props.settings.rule34UserID,
      gelbooruAPIKey: this.props.settings.gelbooruAPIKey,
      gelbooruUserID: this.props.settings.gelbooruUserID,
    });
  }

  save(fields: Partial<RemoteSettings>) {
    this.props.onUpdateSettings((s) => {
      Object.assign(s, fields);
    });
    this.setState({toast: 'Saved.', toastError: false});
  }

  onTestPiwigo = async () => {
    const { piwigoProtocol, piwigoHost, piwigoUsername, piwigoPassword } = this.state;
    this.setState({testing: true, toast: null, toastError: false});
    let reqURL = piwigoProtocol + "://" + piwigoHost + (piwigoHost.endsWith('/') ? "" : "/") + "ws.php?format=json";

    if (!piwigoUsername) {
      reqURL += "&method=reflection.getMethodList";
    }

    let req = wretch(reqURL);
    if (piwigoUsername) {
      req = req.formUrl({ method: "pwg.session.login", username: piwigoUsername, password: piwigoPassword });
    }

    req
      .post()
      .setTimeout(5000)
      .notFound((e) => this.fail("Error: " + e.message))
      .internalError((e) => this.fail("Error: " + e.message))
      .json((json) => {
        if (json.stat == "ok") {
          this.save({piwigoProtocol, piwigoHost, piwigoUsername, piwigoPassword});
          this.setState({toast: 'Piwigo is configured', toastError: false});
        } else {
          this.fail('Invalid response from Piwigo server');
        }
      })
      .catch((e) => this.fail("Error: " + e.message));
  };

  onTestHydrus = async () => {
    const { hydrusProtocol, hydrusDomain, hydrusPort, hydrusAPIKey } = this.state;
    this.setState({testing: true, toast: null, toastError: false});
    wretch(hydrusProtocol + "://" + hydrusDomain + ":" + hydrusPort + "/session_key")
      .headers({"Hydrus-Client-API-Access-Key": hydrusAPIKey})
      .get()
      .setTimeout(5000)
      .notFound((e) => this.fail("Error: " + e.message))
      .internalError((e) => this.fail("Error: " + e.message))
      .json((json) => {
        if (json.session_key) {
          this.save({hydrusProtocol, hydrusDomain, hydrusPort, hydrusAPIKey});
          this.setState({toast: 'Hydrus is configured', toastError: false});
        } else {
          this.fail('Invalid response from Hydrus server');
        }
      })
      .catch((e) => this.fail("Error: " + e.message));
  };

  onSaveRule34 = () => {
    this.save({rule34APIKey: this.state.rule34APIKey, rule34UserID: this.state.rule34UserID});
  };

  onSaveGelbooru = () => {
    this.save({gelbooruAPIKey: this.state.gelbooruAPIKey, gelbooruUserID: this.state.gelbooruUserID});
  };

  onClear = (section: 'piwigo' | 'hydrus' | 'rule34' | 'gelbooru') => {
    switch (section) {
      case 'piwigo':
        this.save({piwigoProtocol: 'http', piwigoHost: '', piwigoUsername: '', piwigoPassword: ''});
        this.setActive(null);
        break;
      case 'hydrus':
        this.save({hydrusProtocol: 'http', hydrusDomain: 'localhost', hydrusPort: '45869', hydrusAPIKey: ''});
        this.setActive(null);
        break;
      case 'rule34':
        this.save({rule34APIKey: '', rule34UserID: ''});
        this.setActive(null);
        break;
      case 'gelbooru':
        this.save({gelbooruAPIKey: '', gelbooruUserID: ''});
        this.setActive(null);
        break;
    }
  };

  fail(message: string) {
    this.setState({testing: false, toast: message, toastError: true});
  }

  onCloseOAuthNote() {
    this.setState({oauthNote: null});
  }

  render() {
    const s = this.props.settings;
    const piwigoConfigured = s.piwigoHost != "";
    const hydrusConfigured = s.hydrusAPIKey != "";
    const rule34Configured = s.rule34APIKey != "" && s.rule34UserID != "";
    const gelbooruConfigured = s.gelbooruAPIKey != "" && s.gelbooruUserID != "";
    const instagramConfigured = (s as any).instagramUsername != "" && (s as any).instagramPassword != "";
    const oauthTitle = this.state.oauthNote ? this.state.oauthNote[0].toUpperCase() + this.state.oauthNote.slice(1) : "";

    return (
      <Grid container spacing={2}>
        <Grid item xs={12}>
          <Typography variant="h6">Remote Sources</Typography>
          <Typography variant="body2" color="text.secondary" gutterBottom>
            Configure the image source services. Everything shown in the desktop settings is listed
            here; OAuth sign-in services (Tumblr, Reddit, Twitter) need a desktop browser callback and
            are shown for reference only on mobile.
          </Typography>
        </Grid>

        <Grid item xs={12}>
          <Grid container spacing={2}>
            <Grid item xs={6} sm={3}>
              <Button
                variant={this.state.oauthNote === 'tumblr' ? "contained" : "outlined"}
                fullWidth
                onClick={() => this.setState({oauthNote: 'tumblr'})}>
                <SourceIcon sx={{ mr: 0.75, fontSize: 20 }} type={ST.tumblr} />
                Tumblr
              </Button>
            </Grid>
            <Grid item xs={6} sm={3}>
              <Button
                variant={this.state.oauthNote === 'instagram' ? "contained" : "outlined"}
                color={instagramConfigured ? "success" : "inherit"}
                fullWidth
                onClick={() => this.setState({oauthNote: 'instagram'})}>
                <SourceIcon sx={{ mr: 0.75, fontSize: 20 }} type={ST.instagram} />
                Instagram
              </Button>
            </Grid>
            <Grid item xs={6} sm={3}>
              <Button
                variant={this.state.active == 'piwigo' ? "contained" : "outlined"}
                color={piwigoConfigured ? "success" : "error"}
                fullWidth
                onClick={() => this.setActive(this.state.active == 'piwigo' ? null : 'piwigo')}>
                Piwigo
              </Button>
            </Grid>
            <Grid item xs={6} sm={3}>
              <Button
                variant={this.state.active == 'hydrus' ? "contained" : "outlined"}
                color={hydrusConfigured ? "success" : "error"}
                fullWidth
                onClick={() => this.setActive(this.state.active == 'hydrus' ? null : 'hydrus')}>
                Hydrus
              </Button>
            </Grid>
            <Grid item xs={6} sm={3}>
              <Button
                variant={this.state.active == 'rule34' ? "contained" : "outlined"}
                color={rule34Configured ? "success" : "error"}
                fullWidth
                onClick={() => this.setActive(this.state.active == 'rule34' ? null : 'rule34')}>
                Rule34
              </Button>
            </Grid>
            <Grid item xs={6} sm={3}>
              <Button
                variant={this.state.active == 'gelbooru' ? "contained" : "outlined"}
                color={gelbooruConfigured ? "success" : "error"}
                fullWidth
                onClick={() => this.setActive(this.state.active == 'gelbooru' ? null : 'gelbooru')}>
                Gelbooru
              </Button>
            </Grid>
          </Grid>
        </Grid>

        {this.state.active == 'piwigo' && (
          <Grid item xs={12}>
            <Grid container spacing={2}>
              <Grid item xs={12}>
                <Typography variant="body2" color="text.secondary">
                  Self-hosted photo gallery. Host is required for the Piwigo import FAB in the
                  Library and Scene Detail.
                </Typography>
              </Grid>
              <Grid item xs={12} sm={3}>
                <Select
                  value={this.state.piwigoProtocol}
                  onChange={(e) => this.setState({piwigoProtocol: e.target.value as string})}
                  fullWidth
                  size="small">
                  <MenuItem value="http">http</MenuItem>
                  <MenuItem value="https">https</MenuItem>
                </Select>
              </Grid>
              <Grid item xs={12} sm={9}>
                <TextField
                  label="Piwigo Host"
                  placeholder="photos.example.com"
                  value={this.state.piwigoHost}
                  onChange={(e) => this.setState({piwigoHost: e.target.value})}
                  fullWidth
                  size="small"
                  helperText="Hostname only (no protocol, no /ws.php)" />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  label="Username (optional)"
                  value={this.state.piwigoUsername}
                  onChange={(e) => this.setState({piwigoUsername: e.target.value})}
                  fullWidth
                  size="small" />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  label="Password (optional)"
                  type="password"
                  value={this.state.piwigoPassword}
                  onChange={(e) => this.setState({piwigoPassword: e.target.value})}
                  fullWidth
                  size="small" />
              </Grid>
              <Grid item xs={12}>
                <Button variant="contained" color="primary" size="small" disabled={this.state.testing} onClick={this.onTestPiwigo}>
                  {this.state.testing ? 'Testing...' : 'Test & Save'}
                </Button>
                {piwigoConfigured && (
                  <Button variant="outlined" color="error" size="small" sx={{ ml: 1 }} onClick={() => this.onClear('piwigo')}>
                    Remove
                  </Button>
                )}
              </Grid>
            </Grid>
          </Grid>
        )}

        {this.state.active == 'hydrus' && (
          <Grid item xs={12}>
            <Grid container spacing={2}>
              <Grid item xs={12} sm={3}>
                <Select
                  value={this.state.hydrusProtocol}
                  onChange={(e) => this.setState({hydrusProtocol: e.target.value as string})}
                  fullWidth
                  size="small">
                  <MenuItem value="http">http</MenuItem>
                  <MenuItem value="https">https</MenuItem>
                </Select>
              </Grid>
              <Grid item xs={12} sm={4}>
                <TextField
                  label="Domain"
                  value={this.state.hydrusDomain}
                  onChange={(e) => this.setState({hydrusDomain: e.target.value})}
                  fullWidth
                  size="small" />
              </Grid>
              <Grid item xs={12} sm={2}>
                <TextField
                  label="Port"
                  value={this.state.hydrusPort}
                  onChange={(e) => this.setState({hydrusPort: e.target.value})}
                  fullWidth
                  size="small" />
              </Grid>
              <Grid item xs={12} sm={3}>
                <TextField
                  label="API Key"
                  value={this.state.hydrusAPIKey}
                  onChange={(e) => this.setState({hydrusAPIKey: e.target.value})}
                  fullWidth
                  size="small" />
              </Grid>
              <Grid item xs={12}>
                <Button variant="contained" color="primary" size="small" disabled={this.state.testing} onClick={this.onTestHydrus}>
                  {this.state.testing ? 'Testing...' : 'Test & Save'}
                </Button>
                {hydrusConfigured && (
                  <Button variant="outlined" color="error" size="small" sx={{ ml: 1 }} onClick={() => this.onClear('hydrus')}>
                    Remove
                  </Button>
                )}
              </Grid>
            </Grid>
          </Grid>
        )}

        {this.state.active == 'rule34' && (
          <Grid item xs={12}>
            <Grid container spacing={2}>
              <Grid item xs={12}>
                <Typography variant="body2" color="text.secondary">
                  Optional API credentials for higher-rate Rule34 browsing. Leave blank to use the
                  public endpoint.
                </Typography>
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  label="Rule34 API Key"
                  value={this.state.rule34APIKey}
                  onChange={(e) => this.setState({rule34APIKey: e.target.value})}
                  fullWidth
                  size="small" />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  label="Rule34 User ID"
                  value={this.state.rule34UserID}
                  onChange={(e) => this.setState({rule34UserID: e.target.value})}
                  fullWidth
                  size="small" />
              </Grid>
              <Grid item xs={12}>
                <Button variant="contained" color="primary" size="small" onClick={this.onSaveRule34}>
                  Save
                </Button>
                {rule34Configured && (
                  <Button variant="outlined" color="error" size="small" sx={{ ml: 1 }} onClick={() => this.onClear('rule34')}>
                    Remove
                  </Button>
                )}
              </Grid>
            </Grid>
          </Grid>
        )}

        {this.state.active == 'gelbooru' && (
          <Grid item xs={12}>
            <Grid container spacing={2}>
              <Grid item xs={12}>
                <Typography variant="body2" color="text.secondary">
                  Optional API credentials for Gelbooru. Leave blank to use the public endpoint.
                </Typography>
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  label="Gelbooru API Key"
                  value={this.state.gelbooruAPIKey}
                  onChange={(e) => this.setState({gelbooruAPIKey: e.target.value})}
                  fullWidth
                  size="small" />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  label="Gelbooru User ID"
                  value={this.state.gelbooruUserID}
                  onChange={(e) => this.setState({gelbooruUserID: e.target.value})}
                  fullWidth
                  size="small" />
              </Grid>
              <Grid item xs={12}>
                <Button variant="contained" color="primary" size="small" onClick={this.onSaveGelbooru}>
                  Save
                </Button>
                {gelbooruConfigured && (
                  <Button variant="outlined" color="error" size="small" sx={{ ml: 1 }} onClick={() => this.onClear('gelbooru')}>
                    Remove
                  </Button>
                )}
              </Grid>
            </Grid>
          </Grid>
        )}

        {this.state.oauthNote && (
          <Grid item xs={12}>
            <Dialog
              open={true}
              onClose={this.onCloseOAuthNote.bind(this)}
              aria-describedby="oauth-note-description">
              <DialogTitle id="oauth-note-title">
                {oauthTitle} — not available on mobile (yet)
              </DialogTitle>
              <DialogContent>
                <DialogContentText id="oauth-note-description">
                  {this.state.oauthNote === 'instagram'
                    ? "Instagram sign-in isn't wired into the mobile app yet — it requires bundling the Instagram login library."
                    : "Tumblr (and Reddit/Twitter) use an OAuth browser-callback flow: they redirect you to the site and then back to the app. A mobile WebView can't host that callback, so those accounts can only be authorized in the desktop app. You can still use the service's public endpoints without an account."}
                </DialogContentText>
              </DialogContent>
              <DialogActions>
                <Button onClick={this.onCloseOAuthNote.bind(this)} color="primary">
                  OK
                </Button>
              </DialogActions>
            </Dialog>
          </Grid>
        )}

        {this.state.toast && (
          <Grid item xs={12}>
            <Alert severity={this.state.toastError ? "error" : "success"} sx={{ py: 0 }}>
              {this.state.toast}
            </Alert>
          </Grid>
        )}
      </Grid>
    );
  }
}

(RemoteSourcesCard as any).displayName = "RemoteSourcesCard";
export default RemoteSourcesCard;
