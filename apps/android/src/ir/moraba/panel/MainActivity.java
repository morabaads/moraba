package ir.moraba.panel;

import android.app.Activity;
import android.appwidget.AppWidgetManager;
import android.content.ClipboardManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.text.InputType;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/** Connect the phone to the panel (paste the code or open the link from the panel), then add the widgets. */
public class MainActivity extends Activity {
    private LinearLayout box;
    private TextView status;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setLayoutDirection(View.LAYOUT_DIRECTION_RTL);
        box.setPadding(dp(20), dp(28), dp(20), dp(28));
        scroll.addView(box);
        setContentView(scroll);
        handle(getIntent());
    }

    @Override
    protected void onNewIntent(Intent i) {
        super.onNewIntent(i);
        setIntent(i);
        handle(i);
    }

    private void handle(Intent i) {
        Uri u = i == null ? null : i.getData();
        if (u != null && "moraba".equals(u.getScheme())) {
            String[] p = Store.parseCode(u.toString());
            if (p != null) { connect(p); return; }
        }
        draw();
    }

    /* ------------------------------------------------------------ Screens */

    private void draw() {
        box.removeAllViews();
        LinearLayout head = row();
        ImageView logo = new ImageView(this);
        logo.setImageResource(R.mipmap.ic_launcher);
        head.addView(logo, new LinearLayout.LayoutParams(dp(52), dp(52)));
        LinearLayout names = new LinearLayout(this);
        names.setOrientation(LinearLayout.VERTICAL);
        names.setPadding(dp(12), 0, dp(12), 0);
        names.addView(text("مربع", 22, R.color.ink, true));
        names.addView(text(Store.paired(this) ? "وصل به " + Store.site(this) : "ویجت‌های پنل روی صفحه اصلی", 13, R.color.muted, false));
        head.addView(names);
        box.addView(head);
        space(20);

        if (!Store.paired(this)) { drawPair(); return; }

        JSONObject d = Store.data(this);
        LinearLayout card = card();
        card.addView(text(d == null ? "در حال دریافت…" : "سلام " + d.optString("user") + "، " + d.optString("today_fa"), 16, R.color.ink, true));
        status = text(statusLine(d), 13, R.color.muted, false);
        card.addView(status);
        box.addView(card);
        space(18);

        box.addView(text("افزودن ویجت به صفحه اصلی", 15, R.color.ink, true));
        box.addView(text("روی هر کدام بزنید یا از صفحه اصلی: انگشت را نگه دارید ← ویجت‌ها ← مربع", 12, R.color.muted, false));
        space(8);
        widgetButton("تسک‌ها — همان کارت میز کار", TasksWidget.class);
        widgetButton("حضور — ساعت زنده و ثبت ورود/خروج", AttendanceWidget.class);
        widgetButton("پیام‌های نخوانده", MessagesWidget.class);
        widgetButton("جلسه بعدی", MeetingWidget.class);
        space(18);

        Button refresh = button("به‌روزرسانی الان", false);
        refresh.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) {
                status.setText("در حال دریافت…");
                Widgets.refresh(MainActivity.this, new Runnable() { @Override public void run() { runOnUiThread(new Runnable() { @Override public void run() { draw(); } }); } });
            }
        });
        box.addView(refresh);
        space(8);
        Button panel = button("باز کردن پنل", false);
        panel.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) { openUrl(Store.url(MainActivity.this, "panel")); }
        });
        box.addView(panel);
        space(8);
        Button out = button("قطع اتصال این گوشی", false);
        out.setTextColor(getColor(R.color.danger));
        out.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) {
                Store.unpair(MainActivity.this);
                Widgets.renderAll(MainActivity.this);
                SyncJob.cancel(MainActivity.this);
                draw();
            }
        });
        box.addView(out);

        if (d == null || System.currentTimeMillis() - Store.fetchedAt(this) > 60000) {
            Widgets.refresh(this, new Runnable() { @Override public void run() { runOnUiThread(new Runnable() { @Override public void run() { if (!isFinishing()) draw(); } }); } });
        }
    }

    private String statusLine(JSONObject d) {
        String err = Store.error(this);
        if (!err.isEmpty()) return "به‌روزرسانی نشد: " + err;
        if (d == null) return "";
        long at = Store.fetchedAt(this);
        return "آخرین به‌روزرسانی " + Store.fa(new SimpleDateFormat("HH:mm", Locale.US).format(new Date(at)))
            + " · ویجت‌ها هر ۱۵ دقیقه و بعد از هر کار به‌روز می‌شوند";
    }

    private void drawPair() {
        LinearLayout card = card();
        card.addView(text("اتصال به پنل", 17, R.color.ink, true));
        TextView how = text("۱. پنل مربع را باز کنید.\n۲. منوی کاربری (عکس پروفایل) ← «ویجت‌ها روی صفحه اصلی».\n۳. «ساخت کد اتصال» را بزنید؛ روی همین گوشی دکمه «باز کردن در اپ مربع» را بزنید یا کد را کپی کنید و اینجا بچسبانید.", 14, R.color.muted, false);
        how.setLineSpacing(0, 1.3f);
        card.addView(how);
        box.addView(card);
        space(16);

        final EditText code = new EditText(this);
        code.setHint("کد اتصال را اینجا بچسبانید");
        code.setHintTextColor(getColor(R.color.faint));
        code.setTextColor(getColor(R.color.ink));
        code.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
        code.setBackgroundResource(R.drawable.bg_input);
        code.setPadding(dp(14), dp(12), dp(14), dp(12));
        code.setMinLines(3);
        code.setGravity(Gravity.TOP | Gravity.START);
        code.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_MULTI_LINE | InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS);
        code.setTextDirection(View.TEXT_DIRECTION_LTR);
        box.addView(code);
        space(10);

        Button paste = button("چسباندن از کلیپ‌بورد", false);
        paste.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) {
                ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
                if (cm != null && cm.hasPrimaryClip() && cm.getPrimaryClip().getItemCount() > 0) {
                    CharSequence t = cm.getPrimaryClip().getItemAt(0).coerceToText(MainActivity.this);
                    code.setText(t);
                }
            }
        });
        box.addView(paste);
        space(8);

        final TextView err = text("", 13, R.color.danger, false);
        Button go = button("اتصال", true);
        go.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) {
                String[] p = Store.parseCode(code.getText().toString());
                if (p == null) { err.setText("کد معتبر نیست؛ آن را کامل از پنل کپی کنید."); return; }
                connect(p);
            }
        });
        box.addView(go);
        space(8);
        box.addView(err);
    }

    private void connect(String[] p) {
        Store.pair(this, p[0], p[1], p[2]);
        box.removeAllViews();
        box.addView(text("در حال اتصال به " + (p[2] == null ? "" : p[2]) + "…", 16, R.color.ink, true));
        new Thread(new Runnable() {
            @Override public void run() {
                String fail = null;
                try { Store.fetch(MainActivity.this); } catch (Exception e) { fail = e.getMessage(); }
                connected(fail);
            }
        }).start();
    }

    private void connected(final String fail) {
        runOnUiThread(new Runnable() {
            @Override public void run() {
                if (fail != null) {
                    Store.unpair(MainActivity.this);
                    draw();
                    box.addView(text("اتصال انجام نشد: " + fail, 14, R.color.danger, false));
                    return;
                }
                Widgets.renderAll(MainActivity.this);
                SyncJob.schedule(MainActivity.this);
                draw();
            }
        });
    }

    /* ------------------------------------------------------------ Pieces */

    private void widgetButton(String label, final Class<?> cls) {
        Button b = button("＋  " + label, false);
        b.setGravity(Gravity.CENTER_VERTICAL | Gravity.START);
        b.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) {
                AppWidgetManager m = AppWidgetManager.getInstance(MainActivity.this);
                if (Build.VERSION.SDK_INT >= 26 && m.isRequestPinAppWidgetSupported()) {
                    m.requestPinAppWidget(new ComponentName(MainActivity.this, cls), null, null);
                } else {
                    Widgets.toast(MainActivity.this, "روی صفحه اصلی انگشت را نگه دارید ← ویجت‌ها ← مربع");
                }
            }
        });
        box.addView(b);
        space(6);
    }

    private void openUrl(String url) {
        if (url == null || url.isEmpty()) return;
        try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url))); } catch (Exception ignored) { /* no browser */ }
    }

    private LinearLayout row() {
        LinearLayout r = new LinearLayout(this);
        r.setOrientation(LinearLayout.HORIZONTAL);
        r.setGravity(Gravity.CENTER_VERTICAL);
        return r;
    }

    private LinearLayout card() {
        LinearLayout c = new LinearLayout(this);
        c.setOrientation(LinearLayout.VERTICAL);
        c.setBackgroundResource(R.drawable.bg_card);
        c.setPadding(dp(18), dp(16), dp(18), dp(16));
        return c;
    }

    private TextView text(String s, int sp, int color, boolean bold) {
        TextView t = new TextView(this);
        t.setText(s);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp);
        t.setTextColor(getColor(color));
        t.setTextAlignment(View.TEXT_ALIGNMENT_VIEW_START);
        if (bold) t.setTypeface(Typeface.DEFAULT_BOLD);
        t.setPadding(0, dp(2), 0, dp(2));
        return t;
    }

    private Button button(String s, boolean primary) {
        Button b = new Button(this);
        b.setText(s);
        b.setAllCaps(false);
        b.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        b.setTypeface(Typeface.DEFAULT_BOLD);
        b.setTextColor(primary ? 0xFFFFFFFF : getColor(R.color.ink));
        b.setBackgroundResource(primary ? R.drawable.bg_btn : R.drawable.bg_btn_ghost);
        b.setStateListAnimator(null);
        b.setPadding(dp(18), 0, dp(18), 0);
        b.setLayoutParams(new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(50)));
        return b;
    }

    private void space(int dp) {
        View v = new View(this);
        box.addView(v, new LinearLayout.LayoutParams(1, dp(dp)));
    }

    private int dp(int v) {
        return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, getResources().getDisplayMetrics()));
    }
}
