package ir.moraba.panel;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** After a restart the live clock needs a new base, and the summary a refresh. */
public class Boot extends BroadcastReceiver {
    @Override
    public void onReceive(Context c, Intent i) {
        if (!Widgets.any(c)) return;
        Widgets.renderAll(c);
        SyncJob.schedule(c);
        final PendingResult p = goAsync();
        Widgets.refresh(c, new Runnable() { @Override public void run() { p.finish(); } });
    }
}
