// reel's own native views on Android. An app packaged by `nsh package` has no Java of its own
// for NSH to call, so reel follows the app's activities from the process's start (`Start`, a
// provider) and registers reel's components on each one's NshView, as an app embedding NSH
// would (`NshView.registerComponent`), and gives its window the remote's keys (`RemoteKeys`).
// Components are registered per NshView, and an activity the system makes again (the process
// lives on) has a new one. The core's `install()` says whether they are there (and adopts the
// running activity where nothing followed it).
package app.reel.views;

import android.app.Activity;
import android.app.Application;
import android.os.Bundle;
import com.longbridge.nsh.NshView;
import java.lang.reflect.Field;
import java.util.Collections;
import java.util.Map;
import java.util.Set;
import java.util.WeakHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

public final class Install {
  private Install() {}

  /** The activity NSH runs in now (found by `install`, then followed). */
  private static volatile Activity activity;
  /** The views reel's components are registered on (main thread). */
  private static final Set<NshView> registered = Collections.newSetFromMap(new WeakHashMap<>());
  /** The app's activities are followed (`follow`). */
  private static boolean following;
  /** While the player is full screen: hides the bars again when something shows them. */
  private static android.view.ViewTreeObserver.OnGlobalLayoutListener keeper;

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
        android.view.View decor = window.getDecorView();
        if (keeper != null) {
          decor.getViewTreeObserver().removeOnGlobalLayoutListener(keeper);
          keeper = null;
        }
        if (on) {
          c.setSystemBarsBehavior(android.view.WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
          c.hide(android.view.WindowInsets.Type.systemBars());
          // NSH applies its status bar again when the window's insets change (as hiding the
          // bars does) and showed it: hide it again whenever it comes back unasked.
          keeper = () -> {
            android.view.WindowInsets insets = decor.getRootWindowInsets();
            if (insets != null && insets.isVisible(android.view.WindowInsets.Type.statusBars())) {
              c.hide(android.view.WindowInsets.Type.systemBars());
            }
          };
          decor.getViewTreeObserver().addOnGlobalLayoutListener(keeper);
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

  /** Registers reel's components, on this activity's NshView and on every later one's; false
   * (and the reason in the log) when there is no NshView. */
  public static boolean install() {
    try {
      final NshView view = nshView();
      if (view == null) return false;
      final Activity found = activity;
      final CountDownLatch done = new CountDownLatch(1);
      view.post(() -> {
        follow(found.getApplication());
        adopt(found, view);
        done.countDown();
      });
      return done.await(5, TimeUnit.SECONDS);
    } catch (Throwable e) {
      android.util.Log.w("reel", "native views not installed", e);
      return false;
    }
  }

  /** Follows the app's activities (main thread): each one, one made again included (a
   * configuration it does not handle, the system's memory), has an NshView of its own, which gets
   * reel's components before its app runs. */
  static void follow(Application app) {
    if (following || app == null) return;
    following = true;
    app.registerActivityLifecycleCallbacks(new Application.ActivityLifecycleCallbacks() {
      // Android 10+: right after onCreate made the view.
      @Override public void onActivityPostCreated(Activity a, Bundle state) { adopt(a); }
      // Before: started, still before its first layout (the app starts on its first size).
      @Override public void onActivityStarted(Activity a) { adopt(a); }
      @Override public void onActivityCreated(Activity a, Bundle state) {}
      @Override public void onActivityResumed(Activity a) {}
      @Override public void onActivityPaused(Activity a) {}
      @Override public void onActivityStopped(Activity a) {}
      @Override public void onActivitySaveInstanceState(Activity a, Bundle state) {}
      @Override public void onActivityDestroyed(Activity a) {
        if (activity == a) activity = null;
      }
    });
  }

  /** `a`'s NshView gets reel's components, once (main thread). */
  private static void adopt(Activity a) {
    try {
      NshView view = viewOf(a);
      if (view != null) adopt(a, view);
    } catch (Throwable e) {
      android.util.Log.w("reel", "native views not installed on " + a, e);
    }
  }

  private static void adopt(Activity a, NshView view) {
    activity = a;
    if (registered.add(view)) {
      register(view);
      RemoteKeys.wrap(a.getWindow());
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
      NshView v = viewOf(found);
      if (v != null) {
        activity = found;
        return v;
      }
    }
    android.util.Log.w("reel", "no NshView in the app's activities");
    return null;
  }

  /** The NshView an activity keeps in a field (NSH's AppActivity: `view`), or null. */
  private static NshView viewOf(Activity a) throws IllegalAccessException {
    if (a == null) return null;
    for (Class<?> c = a.getClass(); c != null; c = c.getSuperclass()) {
      for (Field f : c.getDeclaredFields()) {
        if (NshView.class.isAssignableFrom(f.getType())) {
          f.setAccessible(true);
          Object v = f.get(a);
          if (v != null) return (NshView) v;
        }
      }
    }
    return null;
  }
}
