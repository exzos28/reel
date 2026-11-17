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

  /** The activity NSH runs in (found by `install`). */
  private static volatile Activity activity;

  /** The player's full screen: the status and navigation bars hide (a swipe from the edge shows
   * them for a moment), or come back. */
  public static void fullscreen(final boolean on) {
    final Activity a = activity;
    if (a == null) return;
    a.runOnUiThread(() -> {
      android.view.Window window = a.getWindow();
      if (android.os.Build.VERSION.SDK_INT >= 30) {
        android.view.WindowInsetsController c = window.getInsetsController();
        if (c == null) return;
        if (on) {
          c.setSystemBarsBehavior(android.view.WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
          c.hide(android.view.WindowInsets.Type.systemBars());
        } else {
          c.show(android.view.WindowInsets.Type.systemBars());
        }
      } else {
        int flags = on
            ? android.view.View.SYSTEM_UI_FLAG_FULLSCREEN | android.view.View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | android.view.View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | android.view.View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            : android.view.View.SYSTEM_UI_FLAG_LAYOUT_STABLE;
        window.getDecorView().setSystemUiVisibility(flags);
      }
    });
  }

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

  /** reel's components: the mpv video view where libmpv is in the APK. */
  private static void register(NshView view) {
    try {
      System.loadLibrary("mpv");
      view.registerComponent("reel/mpv", MpvView::new);
    } catch (UnsatisfiedLinkError e) {
      android.util.Log.w("reel", "no libmpv: the platform's player plays", e);
    }
  }

  /** The NshView of the app's activity (NSH's AppActivity keeps it in `view`). */
  private static NshView nshView() throws Exception {
    Class<?> threadClass = Class.forName("android.app.ActivityThread");
    Object thread = threadClass.getMethod("currentActivityThread").invoke(null);
    Field activities = threadClass.getDeclaredField("mActivities");
    activities.setAccessible(true);
    for (Object record : ((Map<?, ?>) activities.get(thread)).values()) {
      Field field = record.getClass().getDeclaredField("activity");
      field.setAccessible(true);
      Activity found = (Activity) field.get(record);
      for (Class<?> c = found.getClass(); c != null; c = c.getSuperclass()) {
        for (Field f : c.getDeclaredFields()) {
          if (NshView.class.isAssignableFrom(f.getType())) {
            f.setAccessible(true);
            Object v = f.get(found);
            if (v != null) {
              activity = found;
              return (NshView) v;
            }
          }
        }
      }
    }
    android.util.Log.w("reel", "no NshView in the app's activities");
    return null;
  }
}
