// Runs when the app's process starts, before any activity (a provider of nothing: the system
// makes the app's providers first; build/android-manifest.py declares it): reel follows every
// activity from its first, so each gets reel's native views and the remote's keys (Install).
package app.reel.views;

import android.app.Application;
import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.net.Uri;

public final class Start extends ContentProvider {
  @Override
  public boolean onCreate() {
    Install.follow((Application) getContext().getApplicationContext());
    return true;
  }

  @Override public Cursor query(Uri uri, String[] projection, String selection, String[] args, String order) { return null; }
  @Override public String getType(Uri uri) { return null; }
  @Override public Uri insert(Uri uri, ContentValues values) { return null; }
  @Override public int delete(Uri uri, String selection, String[] args) { return 0; }
  @Override public int update(Uri uri, ContentValues values, String selection, String[] args) { return 0; }
}
