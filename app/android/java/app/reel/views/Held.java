// How a phone is held, for its player: the phone's window stays upright (Install), and the player
// draws itself sideways in it, the way the device is held (design/player-rendering.md, "Turns").
// The device's quarter turns come from the accelerometer (OrientationEventListener) while the
// app's activity is in front, and only while the system's auto-rotate is on: with it off the
// player turns only with Rotate, as an iPhone's does with its rotation lock on. Each new way it is
// held goes to the core (`nativeHeld`), which counts the turns the player follows
// (`VideoEngine.held`, src/adapters/android_views.rs).
package app.reel.views;

import android.app.Activity;
import android.content.ContentResolver;
import android.database.ContentObserver;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.view.OrientationEventListener;

final class Held extends OrientationEventListener {
  /** The turn the player gives its picture: a quarter clockwise (the phone turned counter-
   * clockwise, its top at the left), the other way, upright; and upside down (no turn of the
   * player's: the core says "not known"). The core's codes. */
  static final int CLOCKWISE = 90, OTHER_WAY = -90, UPRIGHT = 0, UPSIDE_DOWN = 180;
  /** How far past the half-way angle between two quarters a reading must be to count as the
   * next one, degrees: a hand that wavers about 45 degrees turns nothing. */
  private static final int MARGIN = 15;

  private static Held now;

  private final ContentResolver resolver;
  private final ContentObserver autoRotate;
  /** The way it is held, as the core was last told (-1: not yet). */
  private int sent = -1;

  private Held(Activity a) {
    super(a.getApplicationContext());
    resolver = a.getContentResolver();
    autoRotate = new ContentObserver(new Handler(Looper.getMainLooper())) {
      @Override public void onChange(boolean self) { apply(); }
    };
  }

  /** The phone's activity `a` is in front: its turns are followed (main thread). */
  static void follow(Activity a) {
    stop();
    try {
      // The core, as NSH loads it (already there when an activity runs).
      System.loadLibrary("nsh");
      now = new Held(a);
      now.resolver.registerContentObserver(Settings.System.getUriFor(Settings.System.ACCELEROMETER_ROTATION), false, now.autoRotate);
      now.apply();
    } catch (Throwable e) {
      android.util.Log.w("reel", "the device's turns are not followed", e);
      now = null;
    }
  }

  /** The activity left the front: nothing is followed (main thread). */
  static void stop() {
    Held h = now;
    now = null;
    if (h == null) return;
    h.disable();
    h.resolver.unregisterContentObserver(h.autoRotate);
  }

  /** The sensor runs while auto-rotate is on. */
  private void apply() {
    boolean on = Settings.System.getInt(resolver, Settings.System.ACCELEROMETER_ROTATION, 0) == 1;
    if (on && canDetectOrientation()) enable();
    else disable();
  }

  @Override
  public void onOrientationChanged(int degrees) {
    // Flat on a table: as it was.
    if (degrees == ORIENTATION_UNKNOWN) return;
    int quarter = Math.round(degrees / 90f) % 4;
    int off = Math.abs(degrees - quarter * 90);
    if (Math.min(off, 360 - off) > 45 - MARGIN) return;
    int turn = quarter == 0 ? UPRIGHT : quarter == 1 ? OTHER_WAY : quarter == 2 ? UPSIDE_DOWN : CLOCKWISE;
    // 90 degrees: its left side at the top (turned clockwise); 270: its right side at the top.
    if (turn == sent) return;
    sent = turn;
    nativeHeld(turn);
  }

  private static native void nativeHeld(int turn);
}
