package com.dailytrade.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;

import androidx.core.app.NotificationCompat;

/**
 * Keeps the app process alive during market hours so the WebView's own
 * polling (quotes, chain, Angel direct) keeps running with the screen off.
 *
 * Honest scope: this holds a PARTIAL_WAKE_LOCK and foreground priority —
 * it does NOT fetch anything itself, and aggressive OEM skins (Xiaomi, Oppo)
 * can still kill it. The persistent notification says exactly that.
 */
public class KeepAliveService extends Service {

    public static final String CHANNEL_ID = "dailytrade-feed";
    public static final int NOTIF_ID = 1001;
    public static volatile boolean isRunning = false;
    public static volatile String notifText = "Live market feed running";

    private PowerManager.WakeLock wakeLock;

    @Override
    public void onCreate() {
        super.onCreate();
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel ch = new NotificationChannel(
                    CHANNEL_ID, "Market feed", NotificationManager.IMPORTANCE_LOW);
            ch.setShowBadge(false);
            nm.createNotificationChannel(ch);
        }
        isRunning = true;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && intent.hasExtra("text")) {
            String t = intent.getStringExtra("text");
            if (t != null && !t.isEmpty()) notifText = t;
        }
        Notification notif = buildNotification(this, notifText);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIF_ID, notif, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
        } else {
            startForeground(NOTIF_ID, notif);
        }
        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        if (pm != null) {
            if (wakeLock == null) {
                wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "DailyTrade:FeedLock");
                wakeLock.setReferenceCounted(false);
            }
            if (!wakeLock.isHeld()) {
                try { wakeLock.acquire(); } catch (Exception ignored) { /* no lock, still foreground */ }
            }
        }
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        isRunning = false;
        if (wakeLock != null && wakeLock.isHeld()) {
            try { wakeLock.release(); } catch (Exception ignored) { /* already gone */ }
        }
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    public static void updateText(Context ctx, String text) {
        if (text != null && !text.isEmpty()) notifText = text;
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) nm.notify(NOTIF_ID, buildNotification(ctx, notifText));
    }

    private static Notification buildNotification(Context ctx, String text) {
        return new NotificationCompat.Builder(ctx, CHANNEL_ID)
                .setContentTitle("DailyTrade paper feed")
                .setContentText(text)
                .setSmallIcon(android.R.drawable.ic_menu_compass)
                .setOngoing(true)
                .setShowWhen(false)
                .build();
    }
}
