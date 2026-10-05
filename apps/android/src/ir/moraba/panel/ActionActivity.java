package ir.moraba.panel;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;

/** Target of taps inside the tasks list: opens the task in the panel or hands a tick to {@link Actions}. */
public class ActionActivity extends Activity {
    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        Intent i = getIntent();
        String kind = i.getStringExtra("kind");
        if ("open".equals(kind)) {
            String url = i.getStringExtra("url");
            if (url != null && !url.isEmpty()) {
                try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url))); } catch (Exception ignored) { /* no browser */ }
            }
        } else if ("task".equals(kind)) {
            sendBroadcast(new Intent(this, Actions.class).setAction(Actions.TASK)
                .putExtra("id", i.getIntExtra("id", 0)).putExtra("op", i.getStringExtra("op")));
        }
        finish();
        overridePendingTransition(0, 0);
    }
}
