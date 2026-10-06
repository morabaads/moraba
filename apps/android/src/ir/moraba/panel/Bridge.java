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

    private void toast(final String s) {
        a.runOnUiThread(new Runnable() { @Override public void run() { Toast.makeText(a, s, Toast.LENGTH_SHORT).show(); } });
    }
}
