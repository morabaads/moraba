package ir.moraba.panel;

import android.content.Context;
import android.content.SharedPreferences;
import android.net.Uri;
import android.util.Base64;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/** Pairing, the cached summary and the two calls to the panel (GET summary, POST action). */
final class Store {
    private Store() {}

    static SharedPreferences prefs(Context c) {
        return c.getApplicationContext().getSharedPreferences("moraba", Context.MODE_PRIVATE);
    }

    static boolean paired(Context c) { return !prefs(c).getString("token", "").isEmpty(); }
    static String site(Context c) { return prefs(c).getString("site", ""); }

    static void pair(Context c, String api, String token, String site) {
        prefs(c).edit().clear().putString("api", api).putString("token", token).putString("site", site == null ? "" : site).apply();
    }

    static void unpair(Context c) { prefs(c).edit().clear().apply(); }

    /** Reads a pasted code: the base64 JSON from the panel or a moraba://pair link. Returns {api, token, site} or null. */
    static String[] parseCode(String raw) {
        if (raw == null) return null;
        String s = raw.trim().replaceAll("\\s+", "");
        try {
            if (s.startsWith("moraba://")) {
                Uri u = Uri.parse(s);
                String api = u.getQueryParameter("api"), token = u.getQueryParameter("token");
                if (api != null && token != null) return new String[] { api, token, u.getQueryParameter("name") };
                return null;
            }
            JSONObject o = new JSONObject(new String(Base64.decode(s, Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING), StandardCharsets.UTF_8));
            return new String[] { o.getString("a"), o.getString("t"), o.optString("n", "") };
        } catch (Exception e) {
            return null;
        }
    }

    /* ------------------------------------------------------------ Cache */

    static JSONObject data(Context c) {
        String s = prefs(c).getString("data", "");
        if (s.isEmpty()) return null;
        try { return new JSONObject(s); } catch (Exception e) { return null; }
    }

    static long fetchedAt(Context c) { return prefs(c).getLong("at", 0); }
    static String error(Context c) { return prefs(c).getString("error", ""); }

    static void save(Context c, JSONObject d) {
        prefs(c).edit().putString("data", d.toString()).putLong("at", System.currentTimeMillis()).putString("error", "").apply();
    }

    static void saveLocal(Context c, JSONObject d) {
        prefs(c).edit().putString("data", d.toString()).apply();
    }

    static void fail(Context c, String msg) { prefs(c).edit().putString("error", msg).apply(); }

    static String tab(Context c, int widgetId) { return prefs(c).getString("tab_" + widgetId, "today"); }
    static void setTab(Context c, int widgetId, String tab) { prefs(c).edit().putString("tab_" + widgetId, tab).apply(); }

    /** Tasks of a tab from the cached summary. */
    static JSONArray tasks(Context c, String tab) {
        JSONObject d = data(c);
        if (d == null) return new JSONArray();
        JSONObject t = d.optJSONObject("tasks");
        JSONObject x = t == null ? null : t.optJSONObject(tab);
        return x == null ? new JSONArray() : x.optJSONArray("items") == null ? new JSONArray() : x.optJSONArray("items");
    }

    static String url(Context c, String key) {
        JSONObject d = data(c);
        JSONObject u = d == null ? null : d.optJSONObject("urls");
        return u == null ? "" : u.optString(key, "");
    }

    /* ------------------------------------------------------------ Network */

    static JSONObject fetch(Context c) throws IOException {
        JSONObject d = call(c, null);
        save(c, d);
        return d;
    }

    static JSONObject act(Context c, String body) throws IOException {
        JSONObject d = call(c, body);
        save(c, d);
        return d;
    }

    private static JSONObject call(Context c, String body) throws IOException {
        String api = prefs(c).getString("api", ""), token = prefs(c).getString("token", "");
        if (api.isEmpty() || token.isEmpty()) throw new IOException("اپ به پنل وصل نیست.");
        HttpURLConnection h = (HttpURLConnection) new URL(api).openConnection();
        try {
            h.setConnectTimeout(15000);
            h.setReadTimeout(20000);
            h.setUseCaches(false);
            h.setRequestProperty("X-MP-Widget-Token", token);
            h.setRequestProperty("Authorization", "Bearer " + token);
            h.setRequestProperty("Accept", "application/json");
            if (body != null) {
                h.setRequestMethod("POST");
                h.setDoOutput(true);
                h.setRequestProperty("Content-Type", "application/x-www-form-urlencoded; charset=utf-8");
                try (OutputStream o = h.getOutputStream()) { o.write(body.getBytes(StandardCharsets.UTF_8)); }
            }
            int code = h.getResponseCode();
            InputStream in = code >= 400 ? h.getErrorStream() : h.getInputStream();
            String text = read(in);
            JSONObject o;
            try { o = new JSONObject(text); } catch (Exception e) { throw new IOException("پاسخ پنل قابل خواندن نبود (" + code + ")."); }
            if (code >= 400 || !o.optBoolean("ok", false)) {
                throw new IOException(o.optString("message", "خطا در ارتباط با پنل (" + code + ")."));
            }
            return o;
        } catch (java.net.UnknownHostException | java.net.SocketTimeoutException | java.net.ConnectException e) {
            throw new IOException("اینترنت در دسترس نیست.");
        } catch (IOException e) {
            String m = String.valueOf(e.getMessage());
            if (m.contains("Cleartext") || m.contains("CLEARTEXT")) throw new IOException("آدرس سایت باید https باشد.");
            if (e instanceof javax.net.ssl.SSLException) throw new IOException("گواهی امنیتی (SSL) سایت معتبر نیست.");
            throw e;
        } finally {
            h.disconnect();
        }
    }

    private static String read(InputStream in) throws IOException {
        if (in == null) return "";
        ByteArrayOutputStream b = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        while ((n = in.read(buf)) > 0) b.write(buf, 0, n);
        in.close();
        return b.toString("UTF-8");
    }

    /* ------------------------------------------------------------ Text */

    static String fa(Object o) {
        String s = String.valueOf(o);
        StringBuilder b = new StringBuilder(s.length());
        for (char ch : s.toCharArray()) b.append(ch >= '0' && ch <= '9' ? (char) ('۰' + (ch - '0')) : ch);
        return b.toString();
    }
}
