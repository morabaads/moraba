package ir.moraba.panel;

import android.content.Context;
import android.content.SharedPreferences;
import android.net.Uri;

/** The site this app opens (asked once, or set by a moraba://open?site= link) and small app-wide settings. */
final class App {
    private App() {}

    static final String VERSION = "2.1";

    private static SharedPreferences prefs(Context c) {
        return c.getApplicationContext().getSharedPreferences("moraba_app", Context.MODE_PRIVATE);
    }

    /** A build made with SITE=… skips the first-run question and opens that site straight away. */
    static String site(Context c) { return prefs(c).getString("site", normalize(Config.SITE)); }

    static void setSite(Context c, String site) {
        if (!site.equals(site(c))) prefs(c).edit().putString("site", site).remove("entry").remove("last_staff").remove("last_client").apply();
    }

    /** /mp-app/ (or ?mp_app=1 on sites without pretty links), as the site reported it. */
    static String entry(Context c) {
        String e = prefs(c).getString("entry", "");
        return e.isEmpty() ? site(c) + "/mp-app/" : e;
    }

    static void setEntry(Context c, String e) { if (e != null && !e.isEmpty()) prefs(c).edit().putString("entry", e).apply(); }

    static boolean askedNotify(Context c) { return prefs(c).getBoolean("asked_notify", false); }
    static void setAskedNotify(Context c) { prefs(c).edit().putBoolean("asked_notify", true).apply(); }

    static long last(Context c, String key) { return prefs(c).getLong(key, -1); }
    static void setLast(Context c, String key, long v) { prefs(c).edit().putLong(key, v).apply(); }

    /** «example.ir», «http://example.ir/panel/» … → https://example.ir (http only for a local test server). */
    static String normalize(String raw) {
        if (raw == null) return "";
        String s = raw.trim().replace("۰", "0");
        if (s.isEmpty()) return "";
        if (!s.matches("(?i)^https?://.*")) s = "https://" + s;
        Uri u = Uri.parse(s);
        String host = u.getHost();
        if (host == null || !host.contains(".") && !"localhost".equals(host)) return "";
        String scheme = "localhost".equals(host) || host.startsWith("10.0.2.2") ? u.getScheme() : "https";
        return scheme + "://" + host + (u.getPort() > 0 ? ":" + u.getPort() : "");
    }
}
