package ir.moraba.panel;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.view.View;
import android.widget.RemoteViews;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

/** Draws every widget from the cached summary; refreshes it from the panel in the background. */
final class Widgets {
    private Widgets() {}

    static final String[] TABS = { "today", "week", "overdue" };
    private static final int[] TAB_IDS = { R.id.tab_today, R.id.tab_week, R.id.tab_overdue };
    private static final int MUTABLE = Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0;

    static int[] ids(Context c, Class<?> cls) {
        return AppWidgetManager.getInstance(c).getAppWidgetIds(new ComponentName(c, cls));
    }

    static void renderAll(Context c) {
        AppWidgetManager m = AppWidgetManager.getInstance(c);
        for (int id : ids(c, TasksWidget.class)) { m.updateAppWidget(id, tasks(c, id)); m.notifyAppWidgetViewDataChanged(id, R.id.list); }
        for (int id : ids(c, AttendanceWidget.class)) m.updateAppWidget(id, attendance(c));
        for (int id : ids(c, MessagesWidget.class)) m.updateAppWidget(id, messages(c));
        for (int id : ids(c, MeetingWidget.class)) m.updateAppWidget(id, meeting(c));
    }

    static boolean any(Context c) {
        return ids(c, TasksWidget.class).length + ids(c, AttendanceWidget.class).length + ids(c, MessagesWidget.class).length + ids(c, MeetingWidget.class).length > 0;
    }

    /** Fetch in the background, then redraw. done runs on the worker thread (may be null). */
    static void refresh(final Context ctx, final Runnable done) {
        final Context c = ctx.getApplicationContext();
        new Thread(new Runnable() {
            @Override public void run() {
                try {
                    if (Store.paired(c)) Store.fetch(c);
                } catch (Exception e) {
                    Store.fail(c, e.getMessage());
                }
                renderAll(c);
                if (done != null) done.run();
            }
        }).start();
    }

    static void toast(final Context c, final String msg) {
        new Handler(Looper.getMainLooper()).post(new Runnable() {
            @Override public void run() { Toast.makeText(c.getApplicationContext(), msg, Toast.LENGTH_SHORT).show(); }
        });
    }

    /* ------------------------------------------------------------ Intents */

    static PendingIntent open(Context c, String url, int req) {
        Intent i;
        if (url == null || url.isEmpty()) {
            i = new Intent(c, MainActivity.class);
        } else {
            i = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
        }
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        return PendingIntent.getActivity(c, req, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    static PendingIntent action(Context c, String action, int widgetId, String extra, int req) {
        Intent i = new Intent(c, Actions.class).setAction(action);
        i.putExtra("widget", widgetId);
        if (extra != null) i.putExtra("extra", extra);
        return PendingIntent.getBroadcast(c, req, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    /* ------------------------------------------------------------ Tasks card */

    static RemoteViews tasks(Context c, int widgetId) {
        RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_tasks);
        String tab = Store.tab(c, widgetId);
        for (int i = 0; i < TABS.length; i++) {
            boolean on = TABS[i].equals(tab);
            v.setInt(TAB_IDS[i], "setBackgroundResource", on ? R.drawable.bg_seg_on : 0);
            v.setTextColor(TAB_IDS[i], c.getColor(on ? R.color.ink : R.color.muted));
            v.setOnClickPendingIntent(TAB_IDS[i], action(c, Actions.TAB, widgetId, TABS[i], widgetId * 10 + i));
        }
        v.setOnClickPendingIntent(R.id.add, open(c, Store.url(c, "new_task"), widgetId * 10 + 5));
        v.setOnClickPendingIntent(R.id.title, open(c, Store.url(c, "tasks"), widgetId * 10 + 6));

        Intent svc = new Intent(c, TasksService.class);
        svc.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId);
        svc.setData(Uri.parse("moraba://tasks/" + widgetId + "/" + tab));
        v.setRemoteAdapter(R.id.list, svc);
        v.setEmptyView(R.id.list, R.id.empty);
        v.setTextViewText(R.id.empty, emptyText(c, tab));

        Intent tpl = new Intent(c, ActionActivity.class);
        v.setPendingIntentTemplate(R.id.list, PendingIntent.getActivity(c, widgetId * 10 + 7, tpl, PendingIntent.FLAG_UPDATE_CURRENT | MUTABLE));
        return v;
    }

    private static String emptyText(Context c, String tab) {
        if (!Store.paired(c)) return "اپ مربع را باز کنید و به پنل وصل شوید";
        if (Store.data(c) == null) return Store.error(c).isEmpty() ? "در حال دریافت…" : Store.error(c);
        if ("overdue".equals(tab)) return "عقب‌افتاده‌ای ندارید\nعالی! همه کارها به‌موقع است.";
        return "today".equals(tab) ? "امروز تسکی ندارید" : "این هفته تسکی ندارید";
    }

    /** One row of the tasks list, like MP.taskRow on the dashboard. */
    static RemoteViews taskRow(Context c, JSONObject t, int widthDp) {
        RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_task_row);
        boolean done = t.optBoolean("done"), locked = t.optBoolean("locked"), overdue = t.optBoolean("overdue");
        v.setTextViewText(R.id.title, t.optString("title"));
        // The chips sit right after the title (as on the dashboard); the title gets what is left of the row.
        int room = widthDp - 28 - 26 - 48 - (locked ? 30 : 0) - (t.optBoolean("new") ? 54 : 0) - (t.optBoolean("urgent") ? 50 : 0);
        v.setInt(R.id.title, "setMaxWidth", Math.round(Math.max(80, room) * c.getResources().getDisplayMetrics().density));
        v.setTextColor(R.id.title, c.getColor(done ? R.color.faint : R.color.ink));
        v.setViewVisibility(R.id.lock, locked ? View.VISIBLE : View.GONE);
        v.setViewVisibility(R.id.fresh, t.optBoolean("new") ? View.VISIBLE : View.GONE);
        v.setViewVisibility(R.id.urgent, t.optBoolean("urgent") ? View.VISIBLE : View.GONE);
        v.setInt(R.id.row, "setBackgroundResource", locked ? R.drawable.bg_row_locked : R.drawable.bg_row);
        v.setImageViewResource(R.id.tick, done ? R.drawable.tick_on : t.optBoolean("doing") ? R.drawable.tick_doing : R.drawable.tick_off);

        String due = t.optString("due"), time = t.optString("time"), project = t.optString("project"), items = t.optString("items");
        text(v, R.id.due, due);
        v.setTextColor(R.id.due, c.getColor(overdue ? R.color.danger : R.color.muted));
        text(v, R.id.time, time);
        text(v, R.id.project, project);
        text(v, R.id.items, items);
        v.setViewVisibility(R.id.meta, due.isEmpty() && time.isEmpty() && project.isEmpty() && items.isEmpty() ? View.GONE : View.VISIBLE);

        int id = t.optInt("id");
        Intent open = new Intent().putExtra("kind", "open").putExtra("url", Store.url(c, "task") + id);
        v.setOnClickFillInIntent(R.id.row, open);
        if (t.optBoolean("can")) {
            v.setOnClickFillInIntent(R.id.tick, new Intent().putExtra("kind", "task").putExtra("id", id).putExtra("op", done ? "undo" : "done"));
        } else {
            v.setOnClickFillInIntent(R.id.tick, open);
        }
        return v;
    }

    private static void text(RemoteViews v, int id, String s) {
        v.setTextViewText(id, s);
        v.setViewVisibility(id, s.isEmpty() ? View.GONE : View.VISIBLE);
    }

    /* ------------------------------------------------------------ Attendance chip */

    static RemoteViews attendance(Context c) {
        RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_attendance);
        JSONObject d = Store.data(c);
        JSONObject a = d == null ? null : d.optJSONObject("attendance");
        boolean open = a != null && a.optBoolean("open");
        v.setInt(R.id.chip, "setBackgroundResource", open ? R.drawable.bg_punch_in : R.drawable.bg_punch_out);
        v.setImageViewResource(R.id.dot, open ? R.drawable.dot_ok : R.drawable.dot_off);
        v.setTextColor(R.id.label, c.getColor(open ? R.color.ok : R.color.muted));
        if (open) {
            long worked = a.optLong("seconds") * 1000 + Math.max(0, System.currentTimeMillis() - Store.fetchedAt(c));
            v.setChronometer(R.id.clock, SystemClock.elapsedRealtime() - worked, null, true);
            v.setViewVisibility(R.id.clock, View.VISIBLE);
            v.setTextViewText(R.id.label, "حاضر");
            v.setTextViewText(R.id.sub, "ورود " + a.optString("since"));
            Intent i = new Intent(c, ConfirmActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
            v.setOnClickPendingIntent(R.id.root, PendingIntent.getActivity(c, 900, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
        } else {
            v.setChronometer(R.id.clock, SystemClock.elapsedRealtime(), null, false);
            v.setViewVisibility(R.id.clock, View.GONE);
            boolean ready = Store.paired(c) && d != null;
            v.setTextViewText(R.id.label, ready ? "ثبت ورود" : Store.paired(c) ? "…" : "اتصال به پنل");
            v.setTextViewText(R.id.sub, a != null && a.optLong("seconds") > 0 ? "امروز " + a.optString("worked") : "");
            v.setOnClickPendingIntent(R.id.root, ready ? action(c, Actions.PUNCH_IN, 0, null, 901) : open(c, null, 902));
        }
        return v;
    }

    /* ------------------------------------------------------------ Messages */

    private static final int[][] MSG = {
        { R.id.r1, R.id.t1, R.id.n1, R.id.b1 }, { R.id.r2, R.id.t2, R.id.n2, R.id.b2 }, { R.id.r3, R.id.t3, R.id.n3, R.id.b3 }
    };

    static RemoteViews messages(Context c) {
        RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_messages);
        JSONObject d = Store.data(c);
        JSONObject m = d == null ? null : d.optJSONObject("messages");
        int unread = m == null ? 0 : m.optInt("unread");
        JSONArray items = m == null ? new JSONArray() : m.optJSONArray("items");
        v.setViewVisibility(R.id.count, unread > 0 ? View.VISIBLE : View.GONE);
        v.setTextViewText(R.id.count, Store.fa(unread));
        v.setViewVisibility(R.id.empty, items == null || items.length() == 0 ? View.VISIBLE : View.GONE);
        if (!Store.paired(c)) v.setTextViewText(R.id.empty, "اپ مربع را باز کنید و به پنل وصل شوید");
        for (int i = 0; i < MSG.length; i++) {
            JSONObject x = items == null ? null : items.optJSONObject(i);
            v.setViewVisibility(MSG[i][0], x == null ? View.GONE : View.VISIBLE);
            if (x == null) continue;
            v.setTextViewText(MSG[i][1], x.optString("title"));
            v.setTextViewText(MSG[i][2], x.optString("unread") + " جدید");
            v.setTextViewText(MSG[i][3], x.optString("text"));
        }
        v.setOnClickPendingIntent(R.id.root, open(c, Store.url(c, "messages"), 910));
        return v;
    }

    /* ------------------------------------------------------------ Next meeting */

    static RemoteViews meeting(Context c) {
        RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_meeting);
        JSONObject d = Store.data(c);
        JSONObject m = d == null ? null : d.optJSONObject("meeting");
        if (m != null) {
            boolean live = m.optBoolean("live");
            v.setTextViewText(R.id.when, m.optString("when"));
            v.setTextColor(R.id.when, c.getColor(live ? R.color.ok : R.color.muted));
            v.setTextViewText(R.id.title, m.optString("title"));
            v.setViewVisibility(R.id.join, View.VISIBLE);
            v.setOnClickPendingIntent(R.id.join, open(c, m.optString("url"), 920));
            v.setOnClickPendingIntent(R.id.root, open(c, m.optString("url"), 921));
        } else {
            v.setTextViewText(R.id.when, "جلسه بعدی");
            v.setTextColor(R.id.when, c.getColor(R.color.muted));
            v.setTextViewText(R.id.title, Store.paired(c) ? "جلسه‌ای پیش رو ندارید" : "اپ مربع را باز کنید و وصل شوید");
            v.setViewVisibility(R.id.join, View.GONE);
            v.setOnClickPendingIntent(R.id.root, open(c, Store.url(c, "meetings"), 921));
        }
        return v;
    }
}
