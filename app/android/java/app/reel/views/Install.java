// reel's own native views on Android. An app packaged by `nsh package` has no Java of its own
// for NSH to call, so the core calls `install()` once the app runs: it finds the activity's
// NshView and registers reel's components on it, as an app embedding NSH would
// (`NshView.registerComponent`).
package app.reel.views;

import android.app.Activity;
import com.longbridge.nsh.NshView;
import java.lang.reflect.Field;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

public final class Install {
  private Install() {}

  /** Registers reel's components; false (and the reason in the log) when there is no NshView. */
  public static boolean install() {
    try {
      final NshView view = nshView();
      if (view == null) return false;
      final CountDownLatch done = new CountDownLatch(1);
      view.post(() -> {
        register(view);
        done.countDown();
      });
      return done.await(5, TimeUnit.SECONDS);
    } catch (Throwable e) {
      android.util.Log.w("reel", "native views not installed", e);
      return false;
    }
  }

  /** reel's components (none yet: the mpv video view comes next). */
  private static void register(NshView view) {}

  /** The NshView of the app's activity (NSH's AppActivity keeps it in `view`). */
  private static NshView nshView() throws Exception {
    Class<?> threadClass = Class.forName("android.app.ActivityThread");
    Object thread = threadClass.getMethod("currentActivityThread").invoke(null);
    Field activities = threadClass.getDeclaredField("mActivities");
    activities.setAccessible(true);
    for (Object record : ((Map<?, ?>) activities.get(thread)).values()) {
      Field field = record.getClass().getDeclaredField("activity");
      field.setAccessible(true);
      Activity activity = (Activity) field.get(record);
      for (Class<?> c = activity.getClass(); c != null; c = c.getSuperclass()) {
        for (Field f : c.getDeclaredFields()) {
          if (NshView.class.isAssignableFrom(f.getType())) {
            f.setAccessible(true);
            Object v = f.get(activity);
            if (v != null) return (NshView) v;
          }
        }
      }
    }
    android.util.Log.w("reel", "no NshView in the app's activities");
    return null;
  }
}
