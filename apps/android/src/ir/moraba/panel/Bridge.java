package ir.moraba.panel;

import android.content.ContentValues;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.widget.Toast;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;

/**
 * window.MorabaApp in the site's pages: joins the widgets by itself after a colleague signs in, opens the
 * widget screen, saves files made in the page and shares text. Every call checks the page is our own site.
 */
final class Bridge {
    private final MainActivity a;

    Bridge(MainActivity a) { this.a = a; }

    private boolean ours() {
        final String[] url = { "" };
        final Object lock = new Object();
        synchronized (lock) {
            a.runOnUiThread(new Runnable() { @Override public void run() { synchronized (lock) { url[0] = a.currentUrl(); lock.notify(); } } });
            try { lock.wait(1500); } catch (InterruptedException ignored) { /* treat as not ours */ }
        }
        return a.ours(Uri.parse(url[0]));
    }

    @JavascriptInterface public String version() { return App.VERSION; }

    @JavascriptInterface public boolean widgetsPaired() { return Store.paired(a); }

    /** The pairing code the panel made for this phone (same as copying it by hand). */
    @JavascriptInterface public void pairWidgets(String code) {
        if (!ours()) return;
        final String[] p = Store.parseCode(code);
        if (p == null) return;
        Store.pair(a, p[0], p[1], p[2]);
        new Thread(new Runnable() {
            @Override public void run() {
                try {
                    Store.fetch(a);
                    Widgets.renderAll(a);
                    SyncJob.schedule(a);
                } catch (Exception e) {
                    Store.unpair(a);
                }
            }
        }).start();
    }

    @JavascriptInterface public void openWidgets() {
        if (!ours()) return;
        a.startActivity(new Intent(a, WidgetsActivity.class));
    }

    @JavascriptInterface public void share(String text) {
        if (!ours()) return;
        Intent i = new Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, text);
        a.startActivity(Intent.createChooser(i, "اشتراک‌گذاری"));
    }

    /** A file made in the page (base64) → the phone's Downloads. */
    @JavascriptInterface public void saveFile(String name, String mime, String b64) {
        if (!ours() || b64 == null) return;
        try {
            byte[] bytes = Base64.decode(b64, Base64.DEFAULT);
            String safe = name == null || name.isEmpty() ? "moraba-file" : name.replaceAll("[\\\\/:*?\"<>|]", "_");
            if (Build.VERSION.SDK_INT >= 29) {
                ContentValues cv = new ContentValues();
                cv.put(MediaStore.Downloads.DISPLAY_NAME, safe);
                cv.put(MediaStore.Downloads.MIME_TYPE, mime == null ? "application/octet-stream" : mime);
                Uri u = a.getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, cv);
                try (OutputStream o = a.getContentResolver().openOutputStream(u)) { o.write(bytes); }
            } else {
                File f = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), safe);
                try (OutputStream o = new FileOutputStream(f)) { o.write(bytes); }
            }
            toast("«" + safe + "» در پوشه دانلودها ذخیره شد");
        } catch (Exception e) {
            toast("ذخیره فایل انجام نشد.");
        }
    }

    /* ------------------------------------------------------------ «مربع چت» on the phone (chat-shell.js, chat-mobile.js) */

    private void ui(Runnable r) { a.runOnUiThread(r); }

    /** The page's theme colour on the status and navigation bars. */
    @JavascriptInterface public void theme(final String color, final boolean dark) {
        if (!ours()) return;
        ui(new Runnable() { @Override public void run() { a.theme(color, dark); } });
    }

    /** A passcode is set: no previews in the recent-apps list, no screenshots. */
    @JavascriptInterface public void secure(final boolean on) {
        if (!ours()) return;
        ui(new Runnable() { @Override public void run() { a.secure(on); } });
    }

    @JavascriptInterface public boolean canBiometric() { return a.canBiometric(); }

    @JavascriptInterface public void biometric(final String title) {
        if (!ours()) return;
        ui(new Runnable() { @Override public void run() { a.biometric(title); } });
    }

    @JavascriptInterface public void notifySettings() {
        if (!ours()) return;
        ui(new Runnable() { @Override public void run() { a.notifySettings(); } });
    }

    /** What another app shared: {text, files:[{name,type}]}; the files are read from /__mp_share/N. */
    @JavascriptInterface public String shared() { return ours() ? a.sharedJson() : "null"; }

    @JavascriptInterface public void clearShared() { if (ours()) a.clearShared(); }

    @JavascriptInterface public void haptic() {
        ui(new Runnable() { @Override public void run() { a.getWindow().getDecorView().performHapticFeedback(android.view.HapticFeedbackConstants.KEYBOARD_TAP); } });
    }

    private void toast(final String s) {
        a.runOnUiThread(new Runnable() { @Override public void run() { Toast.makeText(a, s, Toast.LENGTH_SHORT).show(); } });
    }
}
