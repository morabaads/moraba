package ir.moraba.panel;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.DialogInterface;
import android.content.Intent;
import android.os.Bundle;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/** «خروج ثبت شود؟» before punching out from the widget, like the panel. */
public class ConfirmActivity extends Activity {
    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        AlertDialog d = new AlertDialog.Builder(this, android.R.style.Theme_DeviceDefault_Dialog_Alert)
            .setTitle("ثبت خروج")
            .setMessage("خروج در ساعت " + Store.fa(new SimpleDateFormat("HH:mm", Locale.US).format(new Date())) + " ثبت شود؟")
            .setPositiveButton("ثبت خروج", new DialogInterface.OnClickListener() {
                @Override public void onClick(DialogInterface di, int w) {
                    sendBroadcast(new Intent(ConfirmActivity.this, Actions.class).setAction(Actions.PUNCH_OUT));
                }
            })
            .setNegativeButton("انصراف", null)
            .create();
        d.setOnDismissListener(new DialogInterface.OnDismissListener() {
            @Override public void onDismiss(DialogInterface di) { finish(); overridePendingTransition(0, 0); }
        });
        d.show();
    }
}
