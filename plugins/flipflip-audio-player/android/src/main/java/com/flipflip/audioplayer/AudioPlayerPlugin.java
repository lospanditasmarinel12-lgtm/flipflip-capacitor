package com.flipflip.audioplayer;

import android.media.audiofx.Visualizer;
import android.net.Uri;
import android.util.Log;

import androidx.media3.common.AudioAttributes;
import androidx.media3.common.MediaItem;
import androidx.media3.common.Player;
import androidx.media3.exoplayer.ExoPlayer;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * FlipAudioPlayer — focus-safe native scene-audio player.
 *
 * Plays the audio track with ExoPlayer configured to NOT take audio focus
 * (AudioAttributes.DEFAULT handed to setAudioAttributes with handleAudioFocus
 * = false), so the system never pauses background apps when it starts. Because
 * the audio lives OUTSIDE the WebView it is also no longer paused by a
 * <video/> starting inside the WebView (Android's one-audible-media-per-WebView
 * constraint no longer applies).
 *
 * Haptics keep working via a native meter: a Visualizer is attached to the
 * ExoPlayer's audio session and RMS + magnitude-spectrum frames are emitted as
 * `meter` events (the same shape AudioAnalyzer.startFromMeter consumes).
 */
@CapacitorPlugin(name = "FlipAudioPlayer")
public class AudioPlayerPlugin extends Plugin {

  private static final String TAG = "FlipAudioPlayer";
  private static final int CAPTURE_SIZE = 1024;

  private ExoPlayer player;
  private Visualizer visualizer;
  private boolean active = false;
  private int lastSessionId = -1;

  @PluginMethod
  public void load(PluginCall call) {
    final String url = call.getString("url");
    if (url == null) {
      call.reject("url is required");
      return;
    }
    final boolean loop = call.getBoolean("loop", false);
    final double volume = call.getDouble("volume", 1.0);
    stopInternal();

    try {
      player = new ExoPlayer.Builder(getContext()).build();
      // No exclusive audio focus: this player mixes with other apps' audio.
      AudioAttributes attrs = new AudioAttributes.Builder()
        .setUsage(android.media.AudioAttributes.USAGE_MEDIA)
        .setContentType(android.media.AudioAttributes.CONTENT_TYPE_MUSIC)
        .build();
      player.setAudioAttributes(attrs, /* handleAudioFocus */ false);
      player.setRepeatMode(loop ? Player.REPEAT_MODE_ONE : Player.REPEAT_MODE_OFF);
      player.setVolume((float) Math.max(0, Math.min(1, volume)));
      player.setMediaItem(MediaItem.fromUri(Uri.parse(url)));
      player.prepare();

      player.addListener(new Player.Listener() {
        @Override public void onPlaybackStateChanged(int state) {
          if (state == Player.STATE_READY) {
            maybeAttachVisualizer();
            // Intentionally NOT emitting a state here: at READY the player is
            // buffered but not yet playing, which JS would interpret as a
            // user-initiated pause and cancel a pending autoplay.
          } else if (state == Player.STATE_ENDED) {
            JSObject s = new JSObject();
            s.put("playing", false);
            s.put("position", 0);
            s.put("duration", player != null && player.getDuration() > 0 ? player.getDuration() : 0);
            s.put("ended", true);
            notifyListeners("playerState", s);
          }
        }
        @Override public void onIsPlayingChanged(boolean isPlaying) {
          if (isPlaying) maybeAttachVisualizer();
          emitState();
        }
      });

      active = true;
      call.resolve(new JSObject().put("duration", 0));
    } catch (Exception e) {
      Log.e(TAG, "load failed", e);
      stopInternal();
      call.reject("Failed to load audio: " + e.getMessage());
    }
  }

  @PluginMethod
  public void play(PluginCall call) {
    if (player == null) {
      call.reject("No audio loaded. Call load() first.");
      return;
    }
    try {
      player.play();
      maybeAttachVisualizer();
      emitState();
      call.resolve();
    } catch (Exception e) {
      Log.e(TAG, "play failed", e);
      call.reject("Failed to play: " + e.getMessage());
    }
  }

  @PluginMethod
  public void pause(PluginCall call) {
    if (player != null) player.pause();
    emitState();
    call.resolve();
  }

  @PluginMethod
  public void seekTo(PluginCall call) {
    if (player == null) {
      call.reject("No audio loaded.");
      return;
    }
    long position = call.getLong("position", 0L);
    try { player.seekTo(position); } catch (Exception e) {
      Log.w(TAG, "seekTo failed", e);
    }
    emitState();
    call.resolve();
  }

  @PluginMethod
  public void setVolume(PluginCall call) {
    double volume = call.getDouble("volume", 1.0);
    if (player != null) {
      player.setVolume((float) Math.max(0, Math.min(1, volume)));
    }
    call.resolve();
  }

  @PluginMethod
  public void getState(PluginCall call) {
    call.resolve(buildState());
  }

  @PluginMethod
  public void dispose(PluginCall call) {
    stopInternal();
    call.resolve();
  }

  // The app is considered "closed" only when the Activity is destroyed (Back
  // from the root, or the task swiped away from Recents). Pressing Home keeps
  // the Activity alive, so playback legitimately continues in the background.
  @Override
  public void handleOnDestroy() {
    super.handleOnDestroy();
    stopInternal();
  }

  private JSObject buildState() {
    boolean playing = player != null && player.isPlaying();
    long duration = player != null && player.getDuration() > 0 ? player.getDuration() : 0;
    long position = player != null && player.getCurrentPosition() > 0 ? player.getCurrentPosition() : 0;
    JSObject s = new JSObject();
    s.put("playing", playing);
    s.put("position", position);
    s.put("duration", duration);
    s.put("ended", false);
    return s;
  }

  private void emitState() {
    if (!active) return;
    notifyListeners("playerState", buildState());
  }

  private void maybeAttachVisualizer() {
    if (player == null || visualizer != null) return;
    try {
      int sessionId;
      try {
        sessionId = player.getAudioSessionId();
      } catch (Throwable t) {
        sessionId = -1;
      }
      if (sessionId < 0) return;
      lastSessionId = sessionId;

      visualizer = new Visualizer(sessionId);
      int[] range = Visualizer.getCaptureSizeRange();
      int captureSize = (CAPTURE_SIZE >= range[0] && CAPTURE_SIZE <= range[1]) ? CAPTURE_SIZE : range[1];
      visualizer.setCaptureSize(captureSize);
      visualizer.setEnabled(true);
      visualizer.setDataCaptureListener(new Visualizer.OnDataCaptureListener() {
        @Override public void onWaveFormDataCapture(Visualizer v, byte[] waveform, int samplingRate) {
          if (!active || waveform == null || waveform.length == 0) return;
          double[] samples = new double[waveform.length];
          for (int i = 0; i < waveform.length; i++) {
            samples[i] = ((waveform[i] & 0xFF) - 128.0) / 128.0;
          }
          emitMeter(samples, samplingRate);
        }
        @Override public void onFftDataCapture(Visualizer v, byte[] fft, int samplingRate) {}
      }, Visualizer.getMaxCaptureRate() / 2, true, false);
      Log.i(TAG, "Visualizer attached to player session " + sessionId);
    } catch (Exception e) {
      Log.w(TAG, "Visualizer attach failed (meter disabled): " + e.getMessage());
    }
  }

  private void emitMeter(double[] samples, int samplingRate) {
    if (!active) return;
    final int n = samples.length;
    double sumSq = 0;
    for (double s : samples) sumSq += s * s;
    double rmsRaw = Math.sqrt(sumSq / n);

    double[] re = new double[n];
    double[] im = new double[n];
    System.arraycopy(samples, 0, re, 0, n);
    fft(re, im, false);

    final JSArray spectrum = new JSArray();
    double refAmplitude = n / 2.0;
    for (int b = 0; b < n / 2; b++) {
      double mag = Math.sqrt(re[b] * re[b] + im[b] * im[b]);
      double amp = mag / refAmplitude;
      double db = 20.0 * Math.log10(Math.max(amp, 1e-6));
      int value = (int) Math.round((db + 100.0) / 70.0 * 255.0);
      spectrum.put(clamp255(value));
    }

    JSObject data = new JSObject();
    data.put("rms", clamp01(rmsRaw));
    data.put("rmsRaw", clamp01(rmsRaw));
    data.put("spectrum", spectrum);
    data.put("sampleRate", samplingRate);
    notifyListeners("meter", data);
  }

  private void stopInternal() {
    active = false;
    if (visualizer != null) {
      try { visualizer.setEnabled(false); } catch (Exception ignored) {}
      try { visualizer.release(); } catch (Exception ignored) {}
      visualizer = null;
    }
    if (player != null) {
      try { player.stop(); } catch (Exception ignored) {}
      try { player.release(); } catch (Exception ignored) {}
      player = null;
    }
    lastSessionId = -1;
  }

  private static int clamp255(int v) {
    return v < 0 ? 0 : (v > 255 ? 255 : v);
  }

  private static double clamp01(double v) {
    return v < 0 ? 0 : (v > 1 ? 1 : v);
  }

  /** In-place iterative radix-2 Cooley-Tukey FFT. n must be a power of two. */
  private static void fft(double[] re, double[] im, boolean inverse) {
    int n = re.length;
    if (n < 2 || (n & (n - 1)) != 0) return;
    int bits = Integer.numberOfTrailingZeros(n);
    for (int i = 0; i < n; i++) {
      int j = Integer.reverse(i) >>> (32 - bits);
      if (j > i) {
        double t = re[i]; re[i] = re[j]; re[j] = t;
        t = im[i]; im[i] = im[j]; im[j] = t;
      }
    }
    for (int len = 2; len <= n; len <<= 1) {
      double ang = 2.0 * Math.PI / len * (inverse ? 1 : -1);
      double wRe = Math.cos(ang);
      double wIm = Math.sin(ang);
      for (int i = 0; i < n; i += len) {
        double curRe = 1.0, curIm = 0.0;
        for (int k = 0; k < len / 2; k++) {
          double uRe = re[i + k];
          double uIm = im[i + k];
          double vRe = re[i + k + len / 2] * curRe - im[i + k + len / 2] * curIm;
          double vIm = re[i + k + len / 2] * curIm + im[i + k + len / 2] * curRe;
          re[i + k] = uRe + vRe;
          im[i + k] = uIm + vIm;
          re[i + k + len / 2] = uRe - vRe;
          im[i + k + len / 2] = uIm - vIm;
          double nRe = curRe * wRe - curIm * wIm;
          curIm = curRe * wIm + curIm * wRe;
          curRe = nRe;
        }
      }
    }
    if (inverse) {
      for (int i = 0; i < n; i++) {
        re[i] /= n;
        im[i] /= n;
      }
    }
  }
}