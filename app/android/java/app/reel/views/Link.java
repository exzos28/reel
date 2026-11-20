// The app's links on Android (`reel://s?t=<key>&u=<address>`, from a partner's bot). NSH's
// activity claims them but its Android runtime drops them (NSH 0.6.1 does not read the schemes
// app.json claims: "not a scheme the app claims"), so build/android-manifest.py gives the
// link's intent filter to this activity instead. The source in the link is offered to the
// screen as a phone's offer is (src/interface/hosted: a yes there saves it, nothing before),
// and the app comes to the front. Goes once NSH reads the schemes on Android.
package app.reel.views;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;

public final class Link extends Activity {
  @Override
  protected void onCreate(Bundle state) {
    super.onCreate(state);
    String url = getIntent().getDataString();
    if (url != null) {
      try {
        // The core, as NSH loads it (already there when the app runs).
        System.loadLibrary("nsh");
        nativeOpen(url);
      } catch (Throwable e) {
        android.util.Log.w("reel", "link not taken", e);
      }
    }
    // The app, as its launcher entry opens it: brought to the front where it runs.
    Intent app = getPackageManager().getLaunchIntentForPackage(getPackageName());
    if (app == null) app = getPackageManager().getLeanbackLaunchIntentForPackage(getPackageName());
    if (app != null) startActivity(app.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
    finish();
  }

  private static native void nativeOpen(String url);
}
