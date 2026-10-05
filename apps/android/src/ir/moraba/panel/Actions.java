package ir.moraba.panel;

import android.appwidget.AppWidgetManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

import org.json.JSONArray;
import org.json.JSONObject;

/** Widget buttons: switch tab, punch in/out, tick a task, refresh. Changes show at once, then sync with the panel. */
public class Actions extends BroadcastReceiver {
    static final String TAB = "ir.moraba.panel.TAB";
    static final String PUNCH_IN = "ir.moraba.panel.PUNCH_IN";
    static final String PUNCH_OUT = "ir.moraba.panel.PUNCH_OUT";
    static final String TASK = "ir.moraba.panel.TASK";
    static final String REFRESH = "ir.moraba.panel.REFRESH";

    @Override
    public void onReceive(Context ctx, Intent intent) {
        final Context c = ctx.getApplicationContext();
        String a = intent.getAction();
        if (a == null) return;
        if (TAB.equals(a)) {
            int id = intent.getIntExtra("widget", 0);
            Store.setTab(c, id, intent.getStringExtra("extra"));
            AppWidgetManager m = AppWidgetManager.getInstance(c);
            m.updateAppWidget(id, Widgets.tasks(c, id));
            m.notifyAppWidgetViewDataChanged(id, R.id.list);
            if (System.currentTimeMillis() - Store.fetchedAt(c) > 60000) Widgets.refresh(c, null);
            return;
        }
        String body;
        String ok;
        if (PUNCH_IN.equals(a) || PUNCH_OUT.equals(a)) {
            boolean in = PUNCH_IN.equals(a);
            body = "action=" + (in ? "in" : "out");
            ok = in ? "ورود ثبت شد؛ روز خوبی داشته باشید" : "خروج ثبت شد";
            local(c, in);
        } else if (TASK.equals(a)) {
            int id = intent.getIntExtra("id", 0);
            String op = intent.getStringExtra("op");
            body = "action=" + ("undo".equals(op) ? "undo" : "done") + "&id=" + id;
            ok = "undo".equals(op) ? "تسک برگشت" : "آفرین! تسک انجام شد";
            localTask(c, id, !"undo".equals(op));
        } else if (REFRESH.equals(a)) {
            body = null;
            ok = null;
        } else {
            return;
        }
        Widgets.renderAll(c);
        final PendingResult pending = goAsync();
        final String b = body, msg = ok;
        new Thread(new Runnable() {
            @Override public void run() {
                try {
                    if (b == null) Store.fetch(c); else Store.act(c, b);
                    if (msg != null) Widgets.toast(c, msg);
                } catch (Exception e) {
                    Widgets.toast(c, e.getMessage());
                    try { Store.fetch(c); } catch (Exception ignored) { /* keep the cache */ }
                }
                Widgets.renderAll(c);
                pending.finish();
            }
        }).start();
    }

    /** Optimistic attendance: the chip turns green/grey right away. */
    private static void local(Context c, boolean in) {
        JSONObject d = Store.data(c);
        if (d == null) return;
        try {
            JSONObject at = d.getJSONObject("attendance");
            boolean was = at.optBoolean("open");
            long worked = at.optLong("seconds") + (was ? Math.max(0, (System.currentTimeMillis() - Store.fetchedAt(c)) / 1000) : 0);
            at.put("open", in);
            at.put("seconds", worked);
            if (in) at.put("since", Store.fa(new java.text.SimpleDateFormat("HH:mm", java.util.Locale.US).format(new java.util.Date())));
            Store.save(c, d); // seconds are now relative to this moment
        } catch (Exception ignored) { /* the server answer fixes it */ }
    }

    /** Optimistic tick in every tab. */
    private static void localTask(Context c, int id, boolean done) {
        JSONObject d = Store.data(c);
        if (d == null) return;
        try {
            JSONObject tasks = d.getJSONObject("tasks");
            for (String tab : Widgets.TABS) {
                JSONArray items = tasks.getJSONObject(tab).getJSONArray("items");
                for (int i = 0; i < items.length(); i++) {
                    JSONObject t = items.getJSONObject(i);
                    if (t.optInt("id") == id) { t.put("done", done); t.put("doing", false); }
                }
            }
            Store.saveLocal(c, d);
        } catch (Exception ignored) { /* the server answer fixes it */ }
    }
}
