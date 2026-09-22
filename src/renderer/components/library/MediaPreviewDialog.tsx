import * as React from "react";
import {useEffect, useState} from "react";

import {
  Box,
  Dialog,
  DialogTitle,
  IconButton,
  Typography,
} from "@mui/material";

import CloseIcon from "@mui/icons-material/Close";

import {toPlaybackUrl, toWebViewUrl} from "../../services/media-urls";
import {resolveOptimizedFallback} from "../../services/optimize-library";
import {isAudio, isImage, isVideo} from "../player/Scrapers";

export function isImageUrl(url: string): boolean {
  return isImage(url, true);
}

export function isVideoUrl(url: string): boolean {
  return isVideo(url, true);
}

export function isAudioUrl(url: string): boolean {
  return isAudio(url, true);
}

export function isPreviewableUrl(url: string): boolean {
  if (url == null) return false;
  return isImage(url, true) || isVideo(url, true) || isAudio(url, true);
}

function MediaPreviewDialog(props: {open: boolean, url: string, label?: string, onClose(): void}) {
  const [src, setSrc] = useState<string>(null);
  const [triedFallback, setTriedFallback] = useState(false);

  const kind = isVideoUrl(props.url) ? "video" : isAudioUrl(props.url) ? "audio" : isImageUrl(props.url) ? "image" : null;
  const isMedia = kind === "video" || kind === "audio";
  const resolveSrc = isMedia ? toPlaybackUrl : toWebViewUrl;

  useEffect(() => {
    if (!props.open) return;
    let cancelled = false;
    setSrc(null);
    setTriedFallback(false);
    resolveSrc(props.url).then((resolved) => {
      if (!cancelled) setSrc(resolved);
    }).catch(() => {
      if (!cancelled) setSrc(props.url);
    });
    return () => { cancelled = true; };
  }, [props.open, props.url, resolveSrc]);

  // A stored URL can point at an original that a conversion already deleted
  // (rewrite raced the import commit). If the primary source fails to load,
  // retry against the optimized sibling so the preview never silently blanks.
  const handleMediaError = () => {
    if (triedFallback) return;
    setTriedFallback(true);
    resolveOptimizedFallback(props.url).then((candidate) => {
      if (candidate === props.url) return;
      resolveSrc(candidate).then((resolved) => setSrc(resolved)).catch(() => setSrc(candidate));
    }).catch(() => { /* keep the current src */ });
  };

  return (
    <Dialog
      open={props.open}
      onClose={props.onClose}
      maxWidth={false}
      aria-labelledby="media-preview-title">
      <DialogTitle id="media-preview-title" sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingRight: 1 }}>
        <Typography noWrap variant="h6" sx={{ maxWidth: '78%' }}>
          {props.label || props.url}
        </Typography>
        <IconButton aria-label="close" onClick={props.onClose} size="large">
          <CloseIcon/>
        </IconButton>
      </DialogTitle>
      <Box sx={{
        px: 2,
        pb: 2,
        maxWidth: '92vw',
        maxHeight: '80vh',
        overflow: 'auto',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
      }}>
        {src != null && kind == "image" && (
          <Box component="img" src={src} alt={props.label} onError={handleMediaError}
               sx={{ maxWidth: '100%', maxHeight: '72vh', objectFit: 'contain', borderRadius: 1 }}/>
        )}
        {src != null && kind == "video" && (
          <video key={src} src={src} controls autoPlay onError={handleMediaError} style={{ maxWidth: '88vw', maxHeight: '76vh', borderRadius: 4 }}/>
        )}
        {src != null && kind == "audio" && (
          <audio key={src} src={src} controls autoPlay onError={handleMediaError} style={{ width: 'min(88vw, 520px)' }}/>
        )}
        {(!src || kind == null) && (
          <Typography color="textSecondary">
            Cannot preview this source type.
          </Typography>
        )}
      </Box>
    </Dialog>
  );
}

(MediaPreviewDialog as any).displayName="MediaPreviewDialog";
export default MediaPreviewDialog;