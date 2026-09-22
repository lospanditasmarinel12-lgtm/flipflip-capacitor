package com.flipflip.transcoder;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;

/**
 * Keep the process prioritized and the CPU awake while conversions run (library
 * sweep OR single-file imports) so encodes continue even with the screen off /
 * the app backgrounded / a swipe away. Conversion work itself executes on the
 * plugin's executor; this service only holds the foreground status + a partial
 * wake lock and shows the progress notification.
 *
 * Crash-proofing: start()/stop() are ref-counted and stop() NEVER calls
 * stopService() directly. The service drops back to background / self-stops only
 * from an idle check scheduled on the main looper after onStartCommand has
 * already elevated it to foreground. The old per-convert start/stop cycle
 * stopped a startForegroundService()-started service before onStartCommand ran
 * startForeground(); Android threw
 * "Context.startForegroundService() did not then call Service.startForeground()"
 * (RemoteServiceException) and killed the whole app whenever a convert settled
 * fast. The ref-count + deferred stop removes that race entirely.
 */
public class MediaOptimizationService extends Service {

    public static final String ACTION_STOP = "com.flipflip.transcoder.STOP";

    private static final String CHANNEL_ID = "media_optimization";
    private static final int NOTIF_ID = 1001;
    private static final long IDLE_CHECK_MS = 1000;

    private static int refCount = 0;
    private static final Object refLock = new Object();
    private static final Handler mainHandler = new Handler(Looper.getMainLooper());

    private PowerManager.WakeLock wakeLock;

    private final Runnable idleCheck = new Runnable() {
        @Override
        public void run() {
            boolean idle;
            synchronized (refLock) {
                idle = refCount <= 0;
            }
            if (idle) {
                stopForeground(true);
                stopSelf();
            } else {
                mainHandler.postDelayed(this, IDLE_CHECK_MS);
            }
        }
    };

    public static void start(Context ctx, int total) {
        start(ctx, total, null);
    }

    /** `label` (optional, e.g. "3/7 — Some_Audio.mp3") shows in the notification
     * text so a serial queue of converts visibly steps instead of looking
     * frozen. */
    public static void start(Context ctx, int total, String label) {
        synchronized (refLock) {
            refCount++;
        }
        Intent i = new Intent(ctx, MediaOptimizationService.class);
        i.putExtra("total", total);
        if (label != null && !label.isEmpty()) {
            i.putExtra("label", label);
        }
        if (android.os.Build.VERSION.SDK_INT >= 26) {
            ctx.startForegroundService(i);
        } else {
            ctx.startService(i);
        }
    }

    /** Decrement the active-conversion count. Safe from any thread. Never stops
     * the service directly — that happens on the main looper via idleCheck once
     * refCount drops to zero and startForeground() has run. */
    public static void stop(Context ctx) {
        synchronized (refLock) {
            if (refCount > 0) refCount--;
        }
    }

    @Override
    public void onCreate() {
        super.onCreate();
        if (android.os.Build.VERSION.SDK_INT >= 26) {
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm != null && nm.getNotificationChannel(CHANNEL_ID) == null) {
                NotificationChannel ch = new NotificationChannel(
                        CHANNEL_ID,
                        "Media optimization",
                        NotificationManager.IMPORTANCE_LOW);
                ch.setDescription("Shows progress while heavy media is being optimized.");
                nm.createNotificationChannel(ch);
            }
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        // Keep the startForegroundService() pledge (5s watchdog) no matter what:
        // elevate to foreground FIRST, before any early return, so a short-lived /
        // immediately-idle service never trips the RemoteServiceException.
        int total = intent != null ? intent.getIntExtra("total", 0) : 0;
        String label = intent != null ? intent.getStringExtra("label") : null;
        Notification notif = buildNotification(total, label);
        if (android.os.Build.VERSION.SDK_INT >= 34) {
            startForeground(NOTIF_ID, notif, android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROCESSING);
        } else if (android.os.Build.VERSION.SDK_INT >= 29) {
            startForeground(NOTIF_ID, notif, 0);
        } else {
            startForeground(NOTIF_ID, notif);
        }
        // Notification tap = user-requested stop. The pledge is already kept, so
        // stopping here is safe; also clear the ref count so the next start()
        // allocates a fresh budget.
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            synchronized (refLock) {
                refCount = 0;
            }
            mainHandler.removeCallbacks(idleCheck);
            stopForeground(true);
            stopSelf();
            return START_NOT_STICKY;
        }
        acquireWakeLock();
        mainHandler.removeCallbacks(idleCheck);
        mainHandler.post(idleCheck);
        return START_NOT_STICKY;
    }

    private Notification buildNotification(int total, String label) {
        String text = "Optimizing media\u2026";
        if (label != null && !label.isEmpty()) {
            text = "Optimizing media\u2026 " + label;
        } else if (total > 0) {
            text = "Optimizing media\u2026 0/" + total;
        }
        Intent tap = new Intent(this, MediaOptimizationService.class).setAction(ACTION_STOP);
        PendingIntent pi = PendingIntent.getService(
                this, 0, tap,
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification.Builder b;
        if (android.os.Build.VERSION.SDK_INT >= 26) {
            b = new Notification.Builder(this, CHANNEL_ID);
        } else {
            b = new Notification.Builder(this);
        }
        return b
                .setSmallIcon(android.R.drawable.stat_sys_download)
                .setContentTitle("FlipFlip")
                .setContentText(label)
                .setContentIntent(pi)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .build();
    }

    private void acquireWakeLock() {
        if (wakeLock != null) return;
        PowerManager pm = getSystemService(PowerManager.class);
        if (pm != null) {
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "flipflip:media-optimization");
            wakeLock.setReferenceCounted(false);
            wakeLock.acquire();
        }
    }

    @Override
    public void onDestroy() {
        mainHandler.removeCallbacks(idleCheck);
        if (wakeLock != null && wakeLock.isHeld()) {
            wakeLock.release();
        }
        wakeLock = null;
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}