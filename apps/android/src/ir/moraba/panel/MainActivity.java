package ir.moraba.panel;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.DownloadManager;
import android.app.NotificationManager;
import android.content.ActivityNotFoundException;
import android.content.ClipboardManager;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Message;
import android.provider.MediaStore;
import android.text.InputType;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.GeolocationPermissions;
import android.webkit.PermissionRequest;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * The app: the studio's panel (colleagues) or project portal (clients) in a full-screen web view, with the
 * phone's camera, microphone, files, location, downloads and notifications. The site decides who is who:
 * the first page (/mp-app/) sends staff to the panel and clients to their portal after one mobile login.
 */
public class MainActivity extends Activity {
    private static final int REQ_FILE = 11, REQ_PERMS = 12, REQ_GEO = 13, REQ_CAM = 14, REQ_NOTIFY = 15, REQ_STORAGE = 16;

    private FrameLayout root;
    private WebView web;
    private ProgressBar bar;
    private View offline, custom;
    private WebChromeClient.CustomViewCallback customCb;

    private ValueCallback<Uri[]> fileCb;
    private WebChromeClient.FileChooserParams fileParams;
    private Uri cameraUri;
    private PermissionRequest pendingPerm;
    private GeolocationPermissions.Callback geoCb;
    private String geoOrigin;
    private String[] pendingDownload;

    static volatile boolean foreground;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        root = new FrameLayout(this);
        root.setBackgroundColor(getColor(R.color.bg));
        setContentView(root);
        takeShare(getIntent());
        if (!handleLink(getIntent()) && App.site(this).isEmpty()) { setup(null); return; }
        showWeb(startUrl(getIntent()));
        if (b != null && web != null) web.restoreState(b);
    }

    @Override
    protected void onNewIntent(Intent i) {
        super.onNewIntent(i);
        setIntent(i);
        boolean shared = takeShare(i);
        if (shared && web != null && ours(Uri.parse(currentUrl()))) { js("window.__mpShared&&window.__mpShared()"); return; }
        if (handleLink(i)) { showWeb(App.entry(this)); return; }
        if (web != null && (i.getStringExtra("url") != null || shared || page(i) != null)) web.loadUrl(startUrl(i));
    }

    @Override protected void onResume() {
        super.onResume();
        foreground = true;
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) nm.cancelAll();
        if (web != null) web.onResume();
    }

    @Override protected void onPause() {
        super.onPause();
        foreground = false;
        CookieManager.getInstance().flush();
        if (web != null && !inCall) web.onPause(); // a voice call goes on while another app is in front
    }

    @Override protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        if (web != null) web.saveState(out);
    }

    /** moraba://open?site=https://… (morabachat:// for «مربع چت», from the site's download page): remember the site. */
    private boolean handleLink(Intent i) {
        Uri u = i == null ? null : i.getData();
        if (u == null || !(Config.CHAT ? "morabachat" : "moraba").equals(u.getScheme()) || !"open".equals(u.getHost())) return false;
        String s = App.normalize(u.getQueryParameter("site"));
        if (s.isEmpty()) return false;
        App.setSite(this, s);
        return true;
    }

    private String startUrl(Intent i) {
        String url = i == null ? null : i.getStringExtra("url");
        if (url != null && !url.isEmpty()) return url;
        if (i != null && (Intent.ACTION_SEND.equals(i.getAction()) || Intent.ACTION_SEND_MULTIPLE.equals(i.getAction())) && share != null) return App.entry(this) + "#share";
        String to = page(i);
        return to != null ? App.entry(this) + "#" + to : App.entry(this);
    }

    /** Home-screen shortcuts: morabachat://open?to=saved | new-dm | contacts. */
    private static String page(Intent i) {
        Uri u = i == null ? null : i.getData();
        String to = u == null || !"open".equals(u.getHost()) ? null : u.getQueryParameter("to");
        return to != null && to.matches("saved|new-dm|contacts") ? to : null;
    }

    /* ------------------------------------------------------------ Shared from other apps (Android's share sheet) */

    /** What was shared: the page asks MorabaApp.shared() and fetches each file from /__mp_share/N (served below). */
    static final class Shared {
        final List<Uri> uris = new ArrayList<>();
        final List<String> names = new ArrayList<>(), types = new ArrayList<>();
        String text = "";
    }
    static volatile Shared share;

    private boolean takeShare(Intent i) {
        if (i == null || !(Intent.ACTION_SEND.equals(i.getAction()) || Intent.ACTION_SEND_MULTIPLE.equals(i.getAction()))) return false;
        Shared s = new Shared();
        List<Uri> list = new ArrayList<>();
        if (Intent.ACTION_SEND_MULTIPLE.equals(i.getAction())) {
            ArrayList<Uri> l = i.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
            if (l != null) list.addAll(l);
        } else {
            Uri u = i.getParcelableExtra(Intent.EXTRA_STREAM);
            if (u != null) list.add(u);
        }
        for (Uri u : list) {
            if (u == null || "file".equals(u.getScheme())) continue; // only content shared by an app, never our own files
            String name = "file", type = getContentResolver().getType(u);
            try (android.database.Cursor c = getContentResolver().query(u, new String[] { android.provider.OpenableColumns.DISPLAY_NAME }, null, null, null)) {
                if (c != null && c.moveToFirst() && c.getString(0) != null) name = c.getString(0);
            } catch (Exception ignored) { /* no name */ }
            s.uris.add(u); s.names.add(name); s.types.add(type == null ? (i.getType() == null ? "application/octet-stream" : i.getType()) : type);
        }
        CharSequence t = i.getCharSequenceExtra(Intent.EXTRA_TEXT);
        String subject = i.getStringExtra(Intent.EXTRA_SUBJECT);
        s.text = (subject != null && t != null && !t.toString().contains(subject) ? subject + "\n" : "") + (t == null ? "" : t.toString());
        if (s.uris.isEmpty() && s.text.isEmpty()) return false;
        share = s;
        return true;
    }

    String sharedJson() {
        Shared s = share;
        if (s == null) return "null";
        try {
            org.json.JSONArray files = new org.json.JSONArray();
            for (int k = 0; k < s.uris.size(); k++) files.put(new JSONObject().put("name", s.names.get(k)).put("type", s.types.get(k)));
            return new JSONObject().put("text", s.text).put("files", files).toString();
        } catch (Exception e) { return "null"; }
    }

    void clearShared() { share = null; }

    private WebResourceResponse sharedFile(Uri u) {
        Shared s = share;
        String p = u.getPath();
        if (s == null || p == null || !ours(u)) return null;
        try {
            int k = Integer.parseInt(p.substring(p.lastIndexOf('/') + 1));
            InputStream in = getContentResolver().openInputStream(s.uris.get(k));
            Map<String, String> h = new HashMap<>();
            h.put("Cache-Control", "no-store");
            return new WebResourceResponse(s.types.get(k), null, 200, "OK", h, in);
        } catch (Exception e) {
            return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", new HashMap<String, String>(), null);
        }
    }

    void js(final String code) {
        runOnUiThread(new Runnable() { @Override public void run() { if (web != null) web.evaluateJavascript(code, null); } });
    }

    /* ------------------------------------------------------------ The page's theme on the system bars, privacy */

    void theme(String color, boolean dark) {
        int c;
        try { c = android.graphics.Color.parseColor(color.trim()); } catch (Exception e) { return; }
        android.view.Window w = getWindow();
        w.setStatusBarColor(c);
        w.setNavigationBarColor(c);
        View d = w.getDecorView();
        int f = d.getSystemUiVisibility();
        f = dark ? f & ~View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR : f | View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
        if (Build.VERSION.SDK_INT >= 26) f = dark ? f & ~View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR : f | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
        d.setSystemUiVisibility(f);
        if (web != null) web.setBackgroundColor(c);
        root.setBackgroundColor(c);
    }

    /** With a passcode the chat stays out of the recent-apps list and screenshots (Telegram does the same). */
    void secure(boolean on) {
        if (on) getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SECURE);
    }

    boolean canBiometric() {
        if (Build.VERSION.SDK_INT >= 29) {
            android.hardware.biometrics.BiometricManager bm = getSystemService(android.hardware.biometrics.BiometricManager.class);
            return bm != null && bm.canAuthenticate() == android.hardware.biometrics.BiometricManager.BIOMETRIC_SUCCESS;
        }
        if (Build.VERSION.SDK_INT >= 28) {
            @SuppressWarnings("deprecation")
            android.hardware.fingerprint.FingerprintManager fm = getSystemService(android.hardware.fingerprint.FingerprintManager.class);
            try { return fm != null && fm.isHardwareDetected() && fm.hasEnrolledFingerprints(); } catch (SecurityException e) { return false; }
        }
        return false;
    }

    /** Fingerprint / face → window.__mpBio(true|false) in the page. */
    void biometric(String title) {
        if (Build.VERSION.SDK_INT < 28 || !canBiometric()) { js("window.__mpBio&&window.__mpBio(false)"); return; }
        final android.os.CancellationSignal cancel = new android.os.CancellationSignal();
        android.hardware.biometrics.BiometricPrompt p = new android.hardware.biometrics.BiometricPrompt.Builder(this)
            .setTitle(title == null || title.isEmpty() ? App.name() : title)
            .setSubtitle("با اثر انگشت باز کنید")
            .setNegativeButton("رمز محلی", getMainExecutor(), new android.content.DialogInterface.OnClickListener() {
                @Override public void onClick(android.content.DialogInterface d, int w) { js("window.__mpBio&&window.__mpBio(false)"); }
            })
            .build();
        p.authenticate(cancel, getMainExecutor(), new android.hardware.biometrics.BiometricPrompt.AuthenticationCallback() {
            @Override public void onAuthenticationSucceeded(android.hardware.biometrics.BiometricPrompt.AuthenticationResult r) { js("window.__mpBio&&window.__mpBio(true)"); }
            @Override public void onAuthenticationError(int code, CharSequence msg) { js("window.__mpBio&&window.__mpBio(false)"); }
        });
    }

    /* ------------------------------------------------------------ Voice calls (call-voice.js) */

    static volatile boolean inCall;

    /** Communication mode: the phone's own echo canceller and the earpiece; the call keeps going behind other apps. */
    void callAudio(boolean on) {
        inCall = on;
        android.media.AudioManager am = (android.media.AudioManager) getSystemService(Context.AUDIO_SERVICE);
        if (am != null) {
            am.setMode(on ? android.media.AudioManager.MODE_IN_COMMUNICATION : android.media.AudioManager.MODE_NORMAL);
            if (!on) am.setSpeakerphoneOn(false);
        }
        if (on) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        setVolumeControlStream(on ? android.media.AudioManager.STREAM_VOICE_CALL : android.media.AudioManager.USE_DEFAULT_STREAM_TYPE);
    }

    void speaker(boolean on) {
        android.media.AudioManager am = (android.media.AudioManager) getSystemService(Context.AUDIO_SERVICE);
        if (am != null) am.setSpeakerphoneOn(on);
    }

    void notifySettings() {
        Intent i = Build.VERSION.SDK_INT >= 26
            ? new Intent(android.provider.Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(android.provider.Settings.EXTRA_APP_PACKAGE, getPackageName())
            : new Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getPackageName()));
        try { startActivity(i); } catch (ActivityNotFoundException ignored) { /* no settings screen */ }
    }

    /* ------------------------------------------------------------ First run: which site */

    private void setup(String error) {
        root.removeAllViews();
        if (web != null) { web.destroy(); web = null; }
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setLayoutDirection(View.LAYOUT_DIRECTION_RTL);
        box.setGravity(Gravity.CENTER_HORIZONTAL);
        box.setPadding(dp(24), dp(56), dp(24), dp(24));
        ImageView logo = new ImageView(this);
        logo.setImageResource(Config.CHAT ? R.mipmap.ic_chat : R.mipmap.ic_launcher);
        box.addView(logo, new LinearLayout.LayoutParams(dp(84), dp(84)));
        box.addView(text(App.name(), 26, R.color.ink, true, Gravity.CENTER));
        box.addView(text(Config.CHAT ? "پیام‌رسان تیم مربع استودیو" : "پنل کارمندان و پرتال مشتریان مربع استودیو", 14, R.color.muted, false, Gravity.CENTER));
        space(box, 28);
        box.addView(text("آدرس سایت استودیو", 14, R.color.ink, true, Gravity.START));
        final EditText site = new EditText(this);
        site.setSingleLine(true);
        site.setHint("example.ir");
        site.setHintTextColor(getColor(R.color.faint));
        site.setTextColor(getColor(R.color.ink));
        site.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
        site.setBackgroundResource(R.drawable.bg_input);
        site.setPadding(dp(14), dp(12), dp(14), dp(12));
        site.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        site.setTextDirection(View.TEXT_DIRECTION_LTR);
        String guess = App.site(this).isEmpty() ? Config.SITE : App.site(this);
        if (guess.isEmpty()) guess = clipboardSite();
        site.setText(guess.replaceFirst("^https://", ""));
        box.addView(site, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        box.addView(text("همان آدرسی که این اپ را از آن دانلود کردید. فقط یک بار پرسیده می‌شود.", 12, R.color.muted, false, Gravity.START));
        space(box, 14);
        final TextView err = text(error == null ? "" : error, 13, R.color.danger, false, Gravity.START);
        final Button go = button("ادامه");
        box.addView(go);
        space(box, 8);
        box.addView(err);
        go.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) {
                final String s = App.normalize(site.getText().toString());
                if (s.isEmpty()) { err.setText("آدرس سایت را وارد کنید."); return; }
                go.setEnabled(false);
                err.setTextColor(getColor(R.color.muted));
                err.setText("در حال بررسی " + s + " …");
                new Thread(new Runnable() {
                    @Override public void run() {
                        final String fail = check(s);
                        runOnUiThread(new Runnable() {
                            @Override public void run() {
                                go.setEnabled(true);
                                if (fail != null) { err.setTextColor(getColor(R.color.danger)); err.setText(fail); return; }
                                App.setSite(MainActivity.this, s);
                                showWeb(App.entry(MainActivity.this));
                            }
                        });
                    }
                }).start();
            }
        });
        root.addView(box, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
    }

    /** Is the panel installed on this site? Returns an error message or null. */
    private String check(String site) {
        HttpURLConnection h = null;
        try {
            h = (HttpURLConnection) new URL(site + "/wp-json/moraba-panel/v1/app/info").openConnection();
            h.setConnectTimeout(12000);
            h.setReadTimeout(15000);
            int code = h.getResponseCode();
            if (code == 404) {
                // Sites without pretty links answer at ?rest_route=.
                h.disconnect();
                h = (HttpURLConnection) new URL(site + "/?rest_route=/moraba-panel/v1/app/info").openConnection();
                code = h.getResponseCode();
            }
            if (code != 200) return "پنل مربع روی این سایت پیدا نشد (" + code + ").";
            InputStream in = h.getInputStream();
            byte[] buf = new byte[65536];
            int n, len = 0;
            while ((n = in.read(buf, len, buf.length - len)) > 0 && len < buf.length) len += n;
            JSONObject o = new JSONObject(new String(buf, 0, len, "UTF-8"));
            if (!o.has("entry")) return "پنل مربع روی این سایت پیدا نشد.";
            App.setEntry(this, o.optString("entry"));
            App.setChatEntry(this, o.optString("chat"));
            return null;
        } catch (java.net.UnknownHostException e) {
            return "سایت پیدا نشد؛ آدرس یا اینترنت را بررسی کنید.";
        } catch (javax.net.ssl.SSLException e) {
            return "گواهی امنیتی (SSL) سایت معتبر نیست.";
        } catch (Exception e) {
            return "اتصال به سایت انجام نشد: " + e.getMessage();
        } finally {
            if (h != null) h.disconnect();
        }
    }

    private String clipboardSite() {
        try {
            ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
            if (cm != null && cm.hasPrimaryClip() && cm.getPrimaryClip().getItemCount() > 0) {
                String t = String.valueOf(cm.getPrimaryClip().getItemAt(0).coerceToText(this)).trim();
                if (t.matches("https?://[^\\s]+")) return Uri.parse(t).getScheme() + "://" + Uri.parse(t).getHost();
            }
        } catch (Exception ignored) { /* no clipboard access */ }
        return "";
    }

    /* ------------------------------------------------------------ The web view */

    @SuppressLint({ "SetJavaScriptEnabled", "AddJavascriptInterface" })
    private void showWeb(String url) {
        root.removeAllViews();
        if (web != null) web.destroy();
        getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
        web = new WebView(this);
        web.setBackgroundColor(getColor(R.color.bg));
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(true);
        s.setGeolocationEnabled(true);
        s.setSupportMultipleWindows(true);
        s.setJavaScriptCanOpenWindowsAutomatically(true);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setTextZoom(100);
        s.setUserAgentString(s.getUserAgentString() + " MorabaApp/" + App.VERSION);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, false);
        web.addJavascriptInterface(new Bridge(this), "MorabaApp");
        web.setWebViewClient(new Client());
        web.setWebChromeClient(new Chrome());
        web.setDownloadListener(new android.webkit.DownloadListener() {
            @Override public void onDownloadStart(String u, String ua, String cd, String mime, long len) { download(u, ua, cd, mime); }
        });
        root.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        bar = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        bar.setIndeterminate(false);
        bar.setMax(100);
        bar.setProgressTintList(android.content.res.ColorStateList.valueOf(getColor(R.color.brand)));
        root.addView(bar, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(3), Gravity.TOP));
        web.loadUrl(url);
        NotifyJob.schedule(this, 60000);
    }

    String host() { return Uri.parse(App.site(this)).getHost(); }

    boolean ours(Uri u) {
        String h = host();
        return u != null && h != null && h.equalsIgnoreCase(u.getHost()) && ("https".equals(u.getScheme()) || "http".equals(u.getScheme()));
    }

    String currentUrl() { return web == null ? "" : String.valueOf(web.getUrl()); }

    private class Client extends WebViewClient {
        @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
            return route(r.getUrl());
        }

        @Override public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest r) {
            Uri u = r.getUrl();
            String p = u.getPath();
            if (p != null && p.startsWith("/__mp_share/")) return sharedFile(u);
            return null;
        }

        @Override public void onPageStarted(WebView v, String url, Bitmap icon) {
            if (offline != null) { root.removeView(offline); offline = null; }
            bar.setVisibility(View.VISIBLE);
        }

        @Override public void onPageFinished(WebView v, String url) {
            bar.setVisibility(View.GONE);
            CookieManager.getInstance().flush();
            Uri u = Uri.parse(url);
            // Signed in (panel or portal): now is the time to ask for notifications.
            if (ours(u) && (u.getPath() != null && (u.getPath().contains("/c/") || !u.getPath().contains("mp-app"))) && Build.VERSION.SDK_INT >= 33
                && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED && !App.askedNotify(MainActivity.this)) {
                App.setAskedNotify(MainActivity.this);
                requestPermissions(new String[] { Manifest.permission.POST_NOTIFICATIONS }, REQ_NOTIFY);
            }
        }

        @Override public void onReceivedError(WebView v, WebResourceRequest r, WebResourceError e) {
            if (r.isForMainFrame()) showOffline();
        }
    }

    private void outside(Uri u) {
        try { startActivity(new Intent(Intent.ACTION_VIEW, u).addCategory(Intent.CATEGORY_BROWSABLE)); } catch (ActivityNotFoundException ignored) { /* no browser */ }
    }

    /** Our own pages stay in the app; the site's home (after signing out) leads back to the app's entry; the rest opens outside. */
    private boolean route(Uri u) {
        String scheme = u.getScheme() == null ? "" : u.getScheme();
        if (ours(u)) {
            String p = u.getPath() == null ? "" : u.getPath();
            if ((p.isEmpty() || "/".equals(p)) && u.getQuery() == null) { web.loadUrl(App.entry(this)); return true; }
            return false;
        }
        if ("moraba".equals(scheme)) {
            if ("pair".equals(u.getHost())) startActivity(new Intent(this, WidgetsActivity.class).setData(u));
            return true;
        }
        try {
            Intent i = "intent".equals(scheme) ? Intent.parseUri(u.toString(), Intent.URI_INTENT_SCHEME) : new Intent(Intent.ACTION_VIEW, u);
            i.addCategory(Intent.CATEGORY_BROWSABLE);
            i.setComponent(null);
            startActivity(i);
        } catch (Exception e) {
            Toast.makeText(this, "برنامه‌ای برای باز کردن این لینک پیدا نشد.", Toast.LENGTH_SHORT).show();
        }
        return true;
    }

    private void showOffline() {
        if (offline != null) return;
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setGravity(Gravity.CENTER);
        box.setBackgroundColor(getColor(R.color.bg));
        box.setPadding(dp(24), dp(24), dp(24), dp(24));
        box.addView(text("اتصال برقرار نشد", 20, R.color.ink, true, Gravity.CENTER));
        box.addView(text("اینترنت گوشی را بررسی کنید و دوباره تلاش کنید.", 14, R.color.muted, false, Gravity.CENTER));
        space(box, 16);
        Button retry = button("تلاش دوباره");
        retry.setOnClickListener(new View.OnClickListener() { @Override public void onClick(View v) { web.reload(); } });
        box.addView(retry);
        space(box, 8);
        Button change = button("تغییر آدرس سایت");
        change.setBackgroundResource(R.drawable.bg_btn_ghost);
        change.setTextColor(getColor(R.color.ink));
        change.setOnClickListener(new View.OnClickListener() { @Override public void onClick(View v) { setup(null); } });
        box.addView(change);
        offline = box;
        root.addView(box, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
    }

    private class Chrome extends WebChromeClient {
        @Override public void onProgressChanged(WebView v, int p) { bar.setProgress(p); }

        /** Attachments, photos from the gallery or straight from the camera. */
        @Override public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams params) {
            if (fileCb != null) fileCb.onReceiveValue(null);
            fileCb = cb;
            fileParams = params;
            if (wantsCamera(params) && checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
                requestPermissions(new String[] { Manifest.permission.CAMERA }, REQ_CAM);
                return true;
            }
            openChooser();
            return true;
        }

        /** Microphone and camera for voice and video messages and meetings — only for our own site. */
        @Override public void onPermissionRequest(final PermissionRequest r) {
            runOnUiThread(new Runnable() {
                @Override public void run() {
                    if (!ours(r.getOrigin())) { r.deny(); return; }
                    List<String> need = new ArrayList<>();
                    for (String res : r.getResources()) {
                        if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(res)) need.add(Manifest.permission.RECORD_AUDIO);
                        if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(res)) need.add(Manifest.permission.CAMERA);
                    }
                    List<String> missing = new ArrayList<>();
                    for (String p : need) if (checkSelfPermission(p) != PackageManager.PERMISSION_GRANTED) missing.add(p);
                    if (missing.isEmpty()) { r.grant(r.getResources()); return; }
                    pendingPerm = r;
                    requestPermissions(missing.toArray(new String[0]), REQ_PERMS);
                }
            });
        }

        @Override public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback cb) {
            if (!ours(Uri.parse(origin))) { cb.invoke(origin, false, false); return; }
            if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED) { cb.invoke(origin, true, false); return; }
            geoCb = cb; geoOrigin = origin;
            requestPermissions(new String[] { Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION }, REQ_GEO);
        }

        /** target=_blank and window.open: our pages here, the rest outside. */
        @Override public boolean onCreateWindow(WebView v, boolean dialog, boolean gesture, Message msg) {
            WebView tmp = new WebView(MainActivity.this);
            tmp.setWebViewClient(new WebViewClient() {
                @Override public boolean shouldOverrideUrlLoading(WebView t, WebResourceRequest r) {
                    Uri u = r.getUrl();
                    if (ours(u)) {
                        String p = u.getPath() == null ? "" : u.getPath();
                        // Files (downloads, PDFs) go to the downloader / viewer; pages open here.
                        if (u.getQueryParameter("mp_file") != null) download(u.toString(), web.getSettings().getUserAgentString(), null, null);
                        // «مربع چت»: the rest of the panel (tasks, calendar…) opens in the browser or the Moraba app.
                        else if (Config.CHAT && !p.startsWith(Uri.parse(App.entry(MainActivity.this)).getPath()) && !p.contains("/m/")) outside(u);
                        else web.loadUrl(u.toString());
                    } else route(u);
                    t.destroy();
                    return true;
                }
            });
            ((WebView.WebViewTransport) msg.obj).setWebView(tmp);
            msg.sendToTarget();
            return true;
        }

        /** Videos full screen. */
        @Override public void onShowCustomView(View v, CustomViewCallback cb) {
            if (custom != null) { cb.onCustomViewHidden(); return; }
            custom = v; customCb = cb;
            root.addView(v, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
            web.setVisibility(View.GONE);
        }

        @Override public void onHideCustomView() { hideCustom(); }
    }

    private void hideCustom() {
        if (custom == null) return;
        root.removeView(custom);
        custom = null;
        web.setVisibility(View.VISIBLE);
        if (customCb != null) customCb.onCustomViewHidden();
        customCb = null;
    }

    private boolean wantsCamera(WebChromeClient.FileChooserParams p) {
        if (p == null) return false;
        if (p.isCaptureEnabled()) return true;
        for (String t : p.getAcceptTypes()) if (t != null && (t.isEmpty() || t.startsWith("image") || t.startsWith("video"))) return true;
        return false;
    }

    private void openChooser() {
        WebChromeClient.FileChooserParams p = fileParams;
        Intent content;
        try { content = p.createIntent(); } catch (Exception e) { content = new Intent(Intent.ACTION_GET_CONTENT).setType("*/*"); }
        content.addCategory(Intent.CATEGORY_OPENABLE);
        if (p.getMode() == WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE) content.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        Intent camera = null;
        cameraUri = null;
        if (wantsCamera(p) && checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
            try {
                ContentValues cv = new ContentValues();
                cv.put(MediaStore.Images.Media.DISPLAY_NAME, "moraba-" + System.currentTimeMillis() + ".jpg");
                cv.put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg");
                cameraUri = getContentResolver().insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, cv);
                if (cameraUri != null) camera = new Intent(MediaStore.ACTION_IMAGE_CAPTURE).putExtra(MediaStore.EXTRA_OUTPUT, cameraUri).addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            } catch (Exception ignored) { cameraUri = null; }
        }
        Intent pick;
        if (camera != null && p.isCaptureEnabled()) pick = camera;
        else {
            pick = Intent.createChooser(content, "انتخاب فایل");
            if (camera != null) pick.putExtra(Intent.EXTRA_INITIAL_INTENTS, new Intent[] { camera });
        }
        try { startActivityForResult(pick, REQ_FILE); } catch (ActivityNotFoundException e) { if (fileCb != null) fileCb.onReceiveValue(null); fileCb = null; }
    }

    @Override protected void onActivityResult(int req, int res, Intent data) {
        super.onActivityResult(req, res, data);
        if (req != REQ_FILE || fileCb == null) return;
        Uri[] out = null;
        if (res == RESULT_OK) {
            if (data != null && data.getClipData() != null) {
                int n = data.getClipData().getItemCount();
                out = new Uri[n];
                for (int i = 0; i < n; i++) out[i] = data.getClipData().getItemAt(i).getUri();
            } else if (data != null && data.getData() != null) out = new Uri[] { data.getData() };
            else if (cameraUri != null) out = new Uri[] { cameraUri };
        } else if (cameraUri != null) {
            try { getContentResolver().delete(cameraUri, null, null); } catch (Exception ignored) { /* nothing taken */ }
        }
        fileCb.onReceiveValue(out);
        fileCb = null;
    }

    @Override public void onRequestPermissionsResult(int req, String[] perms, int[] res) {
        super.onRequestPermissionsResult(req, perms, res);
        boolean all = res.length > 0;
        for (int r : res) if (r != PackageManager.PERMISSION_GRANTED) all = false;
        if (req == REQ_PERMS && pendingPerm != null) {
            if (all) pendingPerm.grant(pendingPerm.getResources()); else pendingPerm.deny();
            pendingPerm = null;
        } else if (req == REQ_GEO && geoCb != null) {
            geoCb.invoke(geoOrigin, all, false);
            geoCb = null;
        } else if (req == REQ_CAM && fileCb != null) {
            openChooser();
        } else if (req == REQ_STORAGE && pendingDownload != null) {
            String[] d = pendingDownload; pendingDownload = null;
            if (all) download(d[0], d[1], d[2], d[3]);
        }
    }

    /* ------------------------------------------------------------ Downloads */

    void download(String url, String ua, String cd, String mime) {
        if (url.startsWith("blob:") || url.startsWith("data:")) {
            // Files made in the page (exports, a saved contact): read them in the page, then save here.
            web.evaluateJavascript("(function(){fetch('" + url.replace("'", "\\'") + "').then(function(r){return r.blob();}).then(function(b){var f=new FileReader();f.onload=function(){MorabaApp.saveFile(" + jsString(URLUtil.guessFileName(url, cd, mime)) + ",b.type||'application/octet-stream',String(f.result).split(',')[1]);};f.readAsDataURL(b);});})()", null);
            return;
        }
        if (Build.VERSION.SDK_INT < 29 && checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
            pendingDownload = new String[] { url, ua, cd, mime };
            requestPermissions(new String[] { Manifest.permission.WRITE_EXTERNAL_STORAGE }, REQ_STORAGE);
            return;
        }
        try {
            String name = URLUtil.guessFileName(url, cd, mime);
            DownloadManager.Request r = new DownloadManager.Request(Uri.parse(url));
            String cookies = CookieManager.getInstance().getCookie(url);
            if (cookies != null) r.addRequestHeader("Cookie", cookies);
            if (ua != null) r.addRequestHeader("User-Agent", ua);
            if (mime != null) r.setMimeType(mime);
            r.setTitle(name);
            r.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            r.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name);
            ((DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE)).enqueue(r);
            Toast.makeText(this, "دانلود «" + name + "» شروع شد", Toast.LENGTH_SHORT).show();
        } catch (Exception e) {
            route(Uri.parse(url));
        }
    }

    private static String jsString(String s) {
        return "'" + s.replace("\\", "\\\\").replace("'", "\\'") + "'";
    }

    /* ------------------------------------------------------------ Back */

    @Override public void onBackPressed() {
        if (custom != null) { hideCustom(); return; }
        if (web != null && web.canGoBack()) { web.goBack(); return; }
        moveTaskToBack(true);
    }

    @Override protected void onDestroy() {
        if (web != null) { web.destroy(); web = null; }
        super.onDestroy();
    }

    /* ------------------------------------------------------------ Pieces */

    private TextView text(String s, int sp, int color, boolean bold, int gravity) {
        TextView t = new TextView(this);
        t.setText(s);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp);
        t.setTextColor(getColor(color));
        t.setGravity(gravity);
        t.setTypeface(font(bold));
        t.setPadding(0, dp(4), 0, dp(4));
        t.setLayoutParams(new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        return t;
    }

    private Button button(String s) {
        Button b = new Button(this);
        b.setText(s);
        b.setAllCaps(false);
        b.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
        b.setTypeface(font(true));
        b.setTextColor(0xFFFFFFFF);
        b.setBackgroundResource(R.drawable.bg_btn);
        b.setStateListAnimator(null);
        b.setLayoutParams(new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(52)));
        return b;
    }

    private void space(LinearLayout box, int h) {
        box.addView(new View(this), new LinearLayout.LayoutParams(1, dp(h)));
    }

    private Typeface font(boolean bold) {
        if (Build.VERSION.SDK_INT >= 26) {
            try { return getResources().getFont(bold ? R.font.dana_bold : R.font.dana_regular); } catch (Exception ignored) { /* fall back */ }
        }
        return bold ? Typeface.DEFAULT_BOLD : Typeface.DEFAULT;
    }

    private int dp(int v) {
        return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, getResources().getDisplayMetrics()));
    }
}
