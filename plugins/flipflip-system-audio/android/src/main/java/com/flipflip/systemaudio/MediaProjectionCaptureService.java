package com.flipflip.systemaudio;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioPlaybackCaptureConfiguration;
import android.media.AudioRecord;
import android.media.projection.MediaProjection;
import android.media.projection.MediaProjectionManager;
import android.os.Build;
import android.os.IBinder;
import android.util.Log;

/**
 * Foreground service owning the MediaProjection audio capture (Phase B).
 *
 * Android 14+ mandates that MediaProjection sessions run in a foreground
 * service of type mediaProjection. This service calls startForeground() BEFORE
 * getMediaProjection() (required), builds an AudioRecord with an
 * AudioPlaybackCaptureConfiguration matching USAGE_MEDIA/GAME/UNKNOWN, reads
 * short PCM frames in a worker thread, and hands normalized samples back to the
 * plugin's shared analysis path (~30Hz) which emits the Capacitor `data` event.
 */
public class MediaProjectionCaptureService extends Service {

    public static final String EXTRA_RESULT_CODE = "flipflip.resultCode";
    public static final String EXTRA_RESULT_DATA = "flipflip.resultData";

    static final String TAG = "FlipSystemAudioSvc";
    private static final String CHANNEL_ID = "flipflip_media_projection";
    private static final int NOTIF_ID = 4021;
    private static final int SAMPLE_RATE = 44100;
    private static final int FFT_SIZE = 1024;

    private MediaProjection projection;
    private AudioRecord audioRecord;
    private Thread captureThread;
    private volatile boolean running = false;

    @Override
    public void onCreate() {
        super.onCreate();
        createChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null || !intent.hasExtra(EXTRA_RESULT_CODE) || !intent.hasExtra(EXTRA_RESULT_DATA)) {
            stopSelf();
            return START_NOT_STICKY;
        }
        final int resultCode = intent.getIntExtra(EXTRA_RESULT_CODE, 0);
        final Intent data = (Intent) intent.getParcelableExtra(EXTRA_RESULT_DATA);

        // Android 14+ requires startForeground(mediaProjection) BEFORE the
        // foregrounded projection is grabbed.
        startForegroundWithType();

        MediaProjectionManager mpm = (MediaProjectionManager) getSystemService(Context.MEDIA_PROJECTION_SERVICE);
        if (mpm == null) { stopSelf(); return START_NOT_STICKY; }
        projection = mpm.getMediaProjection(resultCode, data);
        if (projection == null) { stopSelf(); return START_NOT_STICKY; }
        projection.registerCallback(new MediaProjection.Callback() {
            @Override
            public void onStop() {
                stopCapturing();
                stopSelf();
            }
        }, null);

        startCapturing();
        return START_STICKY;
    }

    private void startForegroundWithType() {
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        Notification notification = new Notification.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setContentTitle("FlipFlip System Audio")
            .setContentText("Reading the audio output mix for haptics")
            .setOngoing(true)
            .build();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            try {
                startForeground(NOTIF_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION);
                return;
            } catch (Exception e) {
                Log.w(TAG, "startForeground(mediaProjection) failed, retrying plain", e);
            }
        }
        startForeground(NOTIF_ID, notification);
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationChannel ch = new NotificationChannel(
            CHANNEL_ID, "System audio capture", NotificationManager.IMPORTANCE_LOW);
        ch.setDescription("Indicates FlipFlip is reading the device audio output mix for haptic feedback");
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) nm.createNotificationChannel(ch);
    }

    private void startCapturing() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) { stopSelf(); return; }
        try {
            AudioPlaybackCaptureConfiguration config =
                new AudioPlaybackCaptureConfiguration.Builder(projection)
                    .addMatchingUsage(AudioAttributes.USAGE_MEDIA)
                    .addMatchingUsage(AudioAttributes.USAGE_GAME)
                    .addMatchingUsage(AudioAttributes.USAGE_UNKNOWN)
                    .build();

            AudioFormat format = new AudioFormat.Builder()
                .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                .setSampleRate(SAMPLE_RATE)
                .setChannelMask(AudioFormat.CHANNEL_IN_STEREO)
                .build();

            audioRecord = new AudioRecord.Builder()
                .setAudioPlaybackCaptureConfig(config)
                .setAudioFormat(format)
                .build();
            if (audioRecord.getState() != AudioRecord.STATE_INITIALIZED) {
                Log.e(TAG, "AudioRecord not initialized");
                stopSelf();
                return;
            }
            audioRecord.startRecording();
            running = true;
        } catch (Exception e) {
            Log.e(TAG, "AudioRecord start failed", e);
            stopSelf();
            return;
        }

        captureThread = new Thread(this::captureLoop, "flipflip-audio-record");
        captureThread.start();
    }

    private void captureLoop() {
        int minBuf = AudioRecord.getMinBufferSize(SAMPLE_RATE, AudioFormat.CHANNEL_IN_STEREO, AudioFormat.ENCODING_PCM_16BIT);
        int bufLen = Math.max(minBuf, FFT_SIZE * 4);
        short[] pcm = new short[bufLen];
        double[] frame = new double[FFT_SIZE];
        int fill = 0;
        while (running) {
            AudioRecord rec = this.audioRecord;
            if (rec == null) break;
            int read = rec.read(pcm, 0, pcm.length);
            if (read <= 0) {
                if (running) {
                    try { Thread.sleep(5); } catch (InterruptedException e) { break; }
                }
                continue;
            }
            for (int i = 0; i < read; i++) {
                frame[fill++] = pcm[i] / 32768.0;
                if (fill >= FFT_SIZE) {
                    double[] snap = new double[FFT_SIZE];
                    System.arraycopy(frame, 0, snap, 0, FFT_SIZE);
                    FlipSystemAudioPlugin.emitFromService(snap, SAMPLE_RATE);
                    fill = 0;
                }
            }
        }
    }

    private void stopCapturing() {
        running = false;
        if (captureThread != null) {
            try { captureThread.interrupt(); } catch (Exception ignored) {}
            captureThread = null;
        }
        if (audioRecord != null) {
            try { audioRecord.stop(); } catch (Exception ignored) {}
            try { audioRecord.release(); } catch (Exception ignored) {}
            audioRecord = null;
        }
        if (projection != null) {
            try { projection.stop(); } catch (Exception ignored) {}
            projection = null;
        }
    }

    @Override
    public void onDestroy() {
        stopCapturing();
        super.onDestroy();
    }

    // App task removed from Recents (user closed the app). Stop capture and
    // tear the service down so it no longer pins the process alive — otherwise
    // any native media player keeps playing with no way to stop it.
    @Override
    public void onTaskRemoved(Intent rootIntent) {
        stopCapturing();
        stopSelf();
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }
}
