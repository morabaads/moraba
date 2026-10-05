package ir.moraba.panel;

import android.app.job.JobInfo;
import android.app.job.JobParameters;
import android.app.job.JobScheduler;
import android.app.job.JobService;
import android.content.ComponentName;
import android.content.Context;

/** Keeps the widgets fresh every 15 minutes while the phone is online (the shortest interval Android allows). */
public class SyncJob extends JobService {
    private static final int ID = 7101;

    static void schedule(Context c) {
        JobScheduler js = (JobScheduler) c.getSystemService(Context.JOB_SCHEDULER_SERVICE);
        if (js == null || js.getPendingJob(ID) != null) return;
        js.schedule(new JobInfo.Builder(ID, new ComponentName(c, SyncJob.class))
            .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
            .setPeriodic(15 * 60 * 1000L)
            .setPersisted(true)
            .build());
    }

    static void cancel(Context c) {
        JobScheduler js = (JobScheduler) c.getSystemService(Context.JOB_SCHEDULER_SERVICE);
        if (js != null) js.cancel(ID);
    }

    @Override
    public boolean onStartJob(final JobParameters p) {
        if (!Widgets.any(this) || !Store.paired(this)) return false;
        Widgets.refresh(this, new Runnable() { @Override public void run() { jobFinished(p, false); } });
        return true;
    }

    @Override
    public boolean onStopJob(JobParameters p) { return true; }
}
