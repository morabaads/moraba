package ir.moraba.panel;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.job.JobInfo;
import android.app.job.JobParameters;
import android.app.job.JobScheduler;
import android.app.job.JobService;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.os.Handler;
import android.os.Looper;
import android.webkit.CookieManager;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Notifications while the app is closed: every few minutes (as often as Android allows) it asks the site, with
 * the app's own sign-in, for the newest notification (staff) or the newest team message (clients).
 * Browsers' web push does not reach an app's web view, so this takes its place.
 */
public class NotifyJob extends JobService {
    private static final int ID = 7201;
    private static final String CHANNEL = "moraba";

    static void schedule(Context c, long delay) {
        JobScheduler js = (JobScheduler) c.getSystemService(Context.JOB_SCHEDULER_SERVICE);
        if (js == null || App.site(c).isEmpty()) return;
        js.schedule(new JobInfo.Builder(ID, new ComponentName(c, NotifyJob.class))
            .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
            .setMinimumLatency(delay)
            .setOverrideDeadline(delay + 10 * 60 * 1000L)
            .setPersisted(true)
            .build());
    }

    @Override
    public boolean onStartJob(final JobParameters p) {
        if (App.site(this).isEmpty()) return false;
        // The web view's cookies are read on the main thread, the site is asked on another.
        new Handler(Looper.getMainLooper()).post(new Runnable() {
            @Override public void run() {
                final String site = App.site(NotifyJob.this);
                final String cookies = CookieManager.getInstance().getCookie(site);
                new Thread(new Runnable() {
                    @Override public void run() {
                        if (cookies != null && !cookies.isEmpty() && !MainActivity.foreground) {
                            check(site + "/?mp_push_feed=1", cookies, "last_staff", 1);
                            check(site + "/?mp_client_feed=1", cookies, "last_client", 2);
                        }
                        schedule(NotifyJob.this, 3 * 60 * 1000L);
                        jobFinished(p, false);
                    }
                }).start();
            }
        });
        return true;
    }

    @Override public boolean onStopJob(JobParameters p) { return true; }

    private void check(String url, String cookies, String key, int slot) {
        HttpURLConnection h = null;
        try {
            h = (HttpURLConnection) new URL(url).openConnection();
            h.setConnectTimeout(15000);
            h.setReadTimeout(20000);
            h.setRequestProperty("Cookie", cookies);
            h.setRequestProperty("Accept", "application/json");
            h.setRequestProperty("User-Agent", "MorabaApp/" + App.VERSION);
            if (h.getResponseCode() != 200) return;
            InputStream in = h.getInputStream();
            ByteArrayOutputStream b = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) b.write(buf, 0, n);
            JSONObject o = new JSONObject(b.toString("UTF-8"));
            long id = o.optLong("id", 0);
            long last = App.last(this, key);
            if (id <= 0) return;
            App.setLast(this, key, Math.max(id, last));
            // The first look only sets the starting point: nothing old pops up after installing.
            if (last < 0 || id <= last) return;
            show(o.optString("title", "مربع"), o.optString("body", ""), o.optString("url", ""), o.optString("tag", key + id), slot);
        } catch (Exception ignored) {
            // offline, signed out, or not this kind of account: nothing to show
        } finally {
            if (h != null) h.disconnect();
        }
    }

    private void show(String title, String body, String url, String tag, int slot) {
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        if (android.os.Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(CHANNEL) == null) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "پیام‌ها و اعلان‌ها", NotificationManager.IMPORTANCE_HIGH);
            ch.setDescription("پیام‌های تازه، تسک‌ها و یادآوری‌های پنل و پرتال");
            nm.createNotificationChannel(ch);
        }
        Intent open = new Intent(this, MainActivity.class).putExtra("url", url).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi = PendingIntent.getActivity(this, tag.hashCode(), open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder nb = android.os.Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, CHANNEL) : new Notification.Builder(this);
        nb.setSmallIcon(R.drawable.ic_stat)
            .setColor(getColor(R.color.brand))
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(new Notification.BigTextStyle().bigText(body))
            .setAutoCancel(true)
            .setContentIntent(pi)
            .setCategory(Notification.CATEGORY_MESSAGE);
        if (android.os.Build.VERSION.SDK_INT < 26) nb.setPriority(Notification.PRIORITY_HIGH).setDefaults(Notification.DEFAULT_ALL);
        nm.notify(tag, slot, nb.build());
    }
}
