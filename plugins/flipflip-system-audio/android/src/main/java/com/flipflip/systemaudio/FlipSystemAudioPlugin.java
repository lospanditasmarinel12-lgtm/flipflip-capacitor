package com.flipflip.systemaudio;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.media.audiofx.Visualizer;
import android.os.Build;
import android.util.Log;

import androidx.activity.result.ActivityResult;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/**
 * FlipSystemAudio — native system-audio meter for FlipFlip haptics.
 *
 * Two Android backends:
 *  - visualizer (Phase A, default): android.media.audiofx.Visualizer on audio
 *    session 0 reflects the global output mix. No consent dialog, minSdk-safe.
 *  - mediaProjection (Phase B, fallback): AudioRecord + AudioPlaybackCapture so
 *    the output mix is captured even when the Visualizer skips certain apps.
 *    Requires the user consent dialog each session and a foreground service of
 *    type mediaProjection on Android 14+.
 *
 * Both compute RMS + FFT natively and ship ~30 compact frames/sec to JS via the
 * `data` event (AudioAnalyzer.startFromMeter pipeline). No MediaStream needed.
 */
@CapacitorPlugin(
    name = "FlipSystemAudio",
    permissions = {
        @Permission(
            strings = { Manifest.permission.RECORD_AUDIO },
            alias = "RECORD_AUDIO"
        )
    }
)
public class FlipSystemAudioPlugin extends Plugin {

    private static final String TAG = "FlipSystemAudio";
    private static final int CAPTURE_SIZE = 1024;

    /** Active plugin instance so MediaProjectionCaptureService can emit frames. */
    static volatile FlipSystemAudioPlugin sActive;

    private Visualizer visualizer = null;
    private boolean capturing = false;

    @PluginMethod
    public void startCapture(PluginCall call) {
        final String mode = call.getString("mode", "visualizer");
        if (getPermissionState("RECORD_AUDIO") != PermissionState.GRANTED) {
            requestPermissionForAliases(new String[]{"RECORD_AUDIO"}, call, "permissionGranted");
            return;
        }
        if ("mediaprojection".equalsIgnoreCase(mode)) {
            startMediaProjection(call);
        } else {
            startVisualizerInternal(call);
        }
    }

    @PermissionCallback
    private void permissionGranted(PluginCall call) {
        if (getPermissionState("RECORD_AUDIO") != PermissionState.GRANTED) {
            call.reject("RECORD_AUDIO permission denied");
            return;
        }
        final String mode = call.getString("mode", "visualizer");
        if ("mediaprojection".equalsIgnoreCase(mode)) {
            startMediaProjection(call);
        } else {
            startVisualizerInternal(call);
        }
    }

    @PluginMethod
    public void stopCapture(PluginCall call) {
        stopVisualizer();
        stopProjectionService();
        sActive = null;
        call.resolve();
    }

    @PluginMethod
    public void getState(PluginCall call) {
        JSObject state = new JSObject();
        state.put("capturing", capturing);
        state.put("sActive", sActive != null);
        state.put("projectionPending", projectionPending);
        state.put("lastSystemAudioError", lastSystemAudioError == null ? "" : lastSystemAudioError);
        call.resolve(state);
    }

    @PluginMethod
    public void isAvailable(PluginCall call) {
        boolean visualizerOk = false;
        if (getPermissionState("RECORD_AUDIO") == PermissionState.GRANTED) {
            Visualizer probe = null;
            try {
                probe = new Visualizer(0);
                visualizerOk = true;
            } catch (Exception e) {
                visualizerOk = false;
            } finally {
                if (probe != null) {
                    try { probe.release(); } catch (Exception ignored) {}
                }
            }
        } else {
            // Optimistic: radio must be visible so selecting System Audio prompts.
            visualizerOk = true;
        }
        // MediaProjection (Phase B) is available on Android 10+, permission-gated.
        boolean projectionOk = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q;
        call.resolve(new JSObject()
            .put("available", visualizerOk || projectionOk)
            .put("visualizer", visualizerOk)
            .put("mediaProjection", projectionOk));
    }

    // MARK: - Visualizer backend (Phase A)

    private void startVisualizerInternal(PluginCall call) {
        JSObject res = new JSObject();
        res.put("deviceId", "output-mix");
        res.put("label", "Output Mix (all device audio)");
        try {
            stopProjectionService();
            stopVisualizer();
            // Rapid stop/start churn (JS re-entering startCapture with the same
            // device) can leave the Visualizer in a state where setCaptureSize()
            // throws IllegalStateException; retry once with a fresh instance.
            Exception lastError = null;
            for (int attempt = 0; attempt < 2; attempt++) {
                try {
                    visualizer = new Visualizer(0); // audio session 0 = global output mix
                    int[] range = Visualizer.getCaptureSizeRange();
                    int captureSize;
                    if (CAPTURE_SIZE >= range[0] && CAPTURE_SIZE <= range[1]) {
                        captureSize = CAPTURE_SIZE;
                    } else {
                        captureSize = range[1];
                    }
                    visualizer.setCaptureSize(captureSize);
                    visualizer.setEnabled(true);
                    visualizer.setDataCaptureListener(new Visualizer.OnDataCaptureListener() {
                        @Override
                        public void onWaveFormDataCapture(Visualizer visualizer, byte[] waveform, int samplingRate) {
                            if (waveform == null || waveform.length == 0) return;
                            double[] samples = new double[waveform.length];
                            for (int i = 0; i < waveform.length; i++) {
                                // 8-bit unsigned waveform, 128 = silence -> normalize to [-1,1]
                                samples[i] = ((waveform[i] & 0xFF) - 128.0) / 128.0;
                            }
                            emitMeter(samples, samplingRate);
                        }

                        @Override
                        public void onFftDataCapture(Visualizer visualizer, byte[] fft, int samplingRate) {
                            // FFT computed from waveform capture.
                        }
                        // The rate parameter is in milliHertz (NOT ms). getMaxCaptureRate()
                        // is typically 20000 mHz (20Hz); half of it (~10Hz) is the canonical
                        // capture cadence. Passing a millisecond-looking value here (e.g. 30)
                        // silently yields ~0.03Hz (one capture per ~33s) so the feed appears
                        // permanently silent.
                    }, Visualizer.getMaxCaptureRate() / 2, /* waveform */ true, /* fft */ false);
                    capturing = true;
                    sActive = this;
                    call.resolve(res);
                    return;
                } catch (Exception e) {
                    lastError = e;
                    stopVisualizer(); // release the half-initialized instance
                }
            }
            throw lastError != null ? lastError : new Exception("Visualizer start failed");
        } catch (Exception e) {
            Log.e(TAG, "Visualizer start failed", e);
            stopVisualizer();
            call.reject("Failed to start Visualizer: " + e.getMessage());
        }
    }

    private void stopVisualizer() {
        capturing = false;
        if (visualizer != null) {
            try { visualizer.setEnabled(false); } catch (Exception ignored) {}
            try { visualizer.release(); } catch (Exception ignored) {}
            visualizer = null;
        }
    }

    // MARK: - MediaProjection backend (Phase B)

    private void startMediaProjection(PluginCall call) {
        try {
            stopVisualizer();
            android.media.projection.MediaProjectionManager mpm =
                (android.media.projection.MediaProjectionManager) getActivity().getSystemService(Context.MEDIA_PROJECTION_SERVICE);
            if (mpm == null) {
                call.reject("MediaProjection service unavailable");
                return;
            }
            sActive = this;
            // Interim state so a late/dropped consent result can be diagnosed
            // rather than silently leaving the UI on "waiting for audio".
            lastSystemAudioError = null;
            projectionPending = true;
            // Android 14+ requires the mediaProjection foreground service to be
            // running before getMediaProjection(); the service is started inside
            // the projection result callback, before that call.
            startActivityForResult(call, mpm.createScreenCaptureIntent(), "projectionResult");
        } catch (Exception e) {
            Log.e(TAG, "MediaProjection launch failed", e);
            call.reject("Failed to launch MediaProjection: " + e.getMessage());
        }
    }

    /** Set when a consent ActivityResult was delivered to a recreated activity
     *  whose plugin instance no longer holds the pending call. Exposed via
     *  getState() so the UI can show a real error instead of "waiting". */
    volatile boolean projectionPending = false;
    volatile String lastSystemAudioError = null;

    @ActivityCallback
    private void projectionResult(PluginCall call, ActivityResult result) {
        projectionPending = false;
        Intent data = result.getData();
        if (result.getResultCode() != android.app.Activity.RESULT_OK || data == null) {
            call.reject("MediaProjection consent denied");
            lastSystemAudioError = "MediaProjection consent was not granted";
            stopProjectionService();
            sActive = null;
            return;
        }
        Intent svc = new Intent(getContext(), MediaProjectionCaptureService.class);
        svc.putExtra(MediaProjectionCaptureService.EXTRA_RESULT_CODE, result.getResultCode());
        svc.putExtra(MediaProjectionCaptureService.EXTRA_RESULT_DATA, data);
        try {
            ContextCompat.startForegroundService(getContext(), svc);
        } catch (Exception e) {
            Log.e(TAG, "startForegroundService failed", e);
            call.reject("Failed to start foreground service: " + e.getMessage());
            sActive = null;
            return;
        }
        capturing = true;

        JSObject res = new JSObject();
        res.put("deviceId", "media-projection");
        res.put("label", "Audio Capture (MediaProjection)");
        call.resolve(res);
    }

    private void stopProjectionService() {
        capturing = false;
        try {
            getContext().stopService(new Intent(getContext(), MediaProjectionCaptureService.class));
        } catch (Exception e) {
            Log.w(TAG, "stopService failed", e);
        }
    }

    // MARK: - Shared analysis + emission

    /** Called by MediaProjectionCaptureService from its capture thread. */
    static void emitFromService(final double[] samples, final int samplingRate) {
        final FlipSystemAudioPlugin p = sActive;
        if (p == null) return;
        p.bridge.getActivity().runOnUiThread(() -> p.emitMeter(samples, samplingRate));
    }

    /** Compute RMS + magnitude spectrum from normalized [-1,1] samples and emit. */
    void emitMeter(double[] samples, int samplingRate) {
        if (!capturing || samples == null || samples.length == 0) return;
        final int n = samples.length;
        double sumSq = 0;
        for (double s : samples) sumSq += s * s;
        double rmsRaw = Math.sqrt(sumSq / n); // 0..1 for [-1,1] input

        double[] re = new double[n];
        double[] im = new double[n];
        System.arraycopy(samples, 0, re, 0, n);
        fft(re, im, false);

        final JSArray spectrum = new JSArray();
        double refAmplitude = n / 2.0; // full-scale amplitude of a sine at FFT size
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
        data.put("waveform", new JSArray()); // too heavy to ship -> analyzer uses rms
        data.put("sampleRate", samplingRate);
        notifyListeners("data", data);
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
