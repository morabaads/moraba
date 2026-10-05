package ir.moraba.panel;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;

/** Shared provider behaviour: draw from the cache now, fetch when it is older than two minutes. */
public abstract class BaseWidget extends AppWidgetProvider {
    @Override
    public void onUpdate(Context c, AppWidgetManager m, int[] ids) {
        Widgets.renderAll(c);
        SyncJob.schedule(c);
        if (System.currentTimeMillis() - Store.fetchedAt(c) > 120000) {
            final PendingResult p = goAsync();
            Widgets.refresh(c, new Runnable() { @Override public void run() { p.finish(); } });
        }
    }

    @Override
    public void onAppWidgetOptionsChanged(Context c, AppWidgetManager m, int id, android.os.Bundle o) { Widgets.renderAll(c); }

    @Override
    public void onEnabled(Context c) { SyncJob.schedule(c); }

    @Override
    public void onDisabled(Context c) { if (!Widgets.any(c)) SyncJob.cancel(c); }
}
