package ir.moraba.panel;

import android.app.Notification;
import android.app.NotificationManager;
import android.app.RemoteInput;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.webkit.CookieManager;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;

/**
 * «پاسخ» and «خوانده شد» on a chat notification (NotifyJob): sent to the site with the app's own sign-in and the
 * X-MP-Push header (a header no other web page can add, so nothing but the app can post this way).
 */
public class ReplyReceiver extends BroadcastReceiver {
    static final String KEY = "mp_reply";

    @Override public void onReceive(final Context c, Intent i) {
        final long channel = i.getLongExtra("channel", 0);
        final String tag = i.getStringExtra("tag");
        final int slot = i.getIntExtra("slot", 1);
        final boolean reply = "reply".equals(i.getAction());
        Bundle in = RemoteInput.getResultsFromIntent(i);
        CharSequence typed = in == null ? null : in.getCharSequence(KEY);
        final String text = typed == null ? "" : typed.toString().trim();
        final String site = App.site(c);
        if (channel <= 0 || site.isEmpty() || (reply && text.isEmpty())) return;
        final String cookies = CookieManager.getInstance().getCookie(site);
        final PendingResult done = goAsync();
        new Thread(new Runnable() {
            @Override public void run() {
                boolean ok = false;
                HttpURLConnection h = null;
                try {
                    h = (HttpURLConnection) new URL(site + "/?mp_push_feed=1&chat=1&" + (reply ? "reply=" : "read=") + channel).openConnection();
                    h.setConnectTimeout(15000);
                    h.setReadTimeout(20000);
                    if (cookies != null) h.setRequestProperty("Cookie", cookies);
                    h.setRequestProperty("X-MP-Push", "1");
                    h.setRequestProperty("Accept", "application/json");
                    h.setRequestProperty("User-Agent", "MorabaApp/" + App.VERSION);
                    if (reply) {
                        byte[] body = ("text=" + URLEncoder.encode(text, "UTF-8")).getBytes("UTF-8");
                        h.setRequestMethod("POST");
                        h.setDoOutput(true);
                        h.setRequestProperty("Content-Type", "application/x-www-form-urlencoded; charset=utf-8");
                        try (OutputStream o = h.getOutputStream()) { o.write(body); }
                    }
                    ok = h.getResponseCode() == 200;
                } catch (Exception ignored) {
                    // offline or signed out: said below
                } finally {
                    if (h != null) h.disconnect();
                }
                NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
                if (nm != null) {
                    if (ok) nm.cancel(tag, slot);
                    else {
                        Notification.Builder nb = android.os.Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(c, "moraba") : new Notification.Builder(c);
                        nb.setSmallIcon(R.drawable.ic_stat).setContentTitle(App.name())
                            .setContentText(reply ? "پاسخ فرستاده نشد؛ برنامه را باز کنید." : "انجام نشد؛ برنامه را باز کنید.").setAutoCancel(true);
                        nm.notify(tag, slot, nb.build());
                    }
                }
                done.finish();
            }
        }).start();
    }
}
