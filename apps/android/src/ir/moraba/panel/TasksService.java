package ir.moraba.panel;

import android.appwidget.AppWidgetManager;
import android.content.Context;
import android.content.Intent;
import android.widget.RemoteViews;
import android.widget.RemoteViewsService;

import org.json.JSONArray;
import org.json.JSONObject;

/** Rows of the tasks card for one widget (its own tab). */
public class TasksService extends RemoteViewsService {
    @Override
    public RemoteViewsFactory onGetViewFactory(Intent intent) {
        return new Factory(getApplicationContext(), intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, 0));
    }

    static final class Factory implements RemoteViewsFactory {
        private final Context c;
        private final int widgetId;
        private JSONArray rows = new JSONArray();

        Factory(Context c, int widgetId) { this.c = c; this.widgetId = widgetId; }

        @Override public void onCreate() {}
        private int width = 300;

        @Override public void onDataSetChanged() {
            rows = Store.tasks(c, Store.tab(c, widgetId));
            android.os.Bundle o = AppWidgetManager.getInstance(c).getAppWidgetOptions(widgetId);
            int w = o == null ? 0 : o.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 0);
            width = w > 0 ? w : Math.round(c.getResources().getDisplayMetrics().widthPixels / c.getResources().getDisplayMetrics().density) - 32;
        }
        @Override public void onDestroy() {}
        @Override public int getCount() { return rows.length(); }
        @Override public RemoteViews getViewAt(int position) {
            JSONObject t = rows.optJSONObject(position);
            return t == null ? new RemoteViews(c.getPackageName(), R.layout.widget_task_row) : Widgets.taskRow(c, t, width);
        }
        @Override public RemoteViews getLoadingView() { return null; }
        @Override public int getViewTypeCount() { return 1; }
        @Override public long getItemId(int position) { JSONObject t = rows.optJSONObject(position); return t == null ? position : t.optLong("id"); }
        @Override public boolean hasStableIds() { return true; }
    }
}
