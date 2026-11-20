// The mpv video view (`reel/mpv`) on Android: a TextureView NSH lays out, whose Surface mpv
// draws into. A TextureView, not a SurfaceView: it composes in its place among NSH's views
// (the player's controls draw over it); a SurfaceView sits under the window and needed every
// view above it transparent. The player itself is the core's (src/adapters/mpv: the same as on macOS); this
// passes it the Surface, the TSX view's props and commands, and passes its events to NSH.
//
// None of its calls waits for mpv (src/adapters/mpv/android.rs): mpv's thread may be waiting for
// the stream, or for this thread, which takes the TextureView's frames.
package app.reel.views;

import android.graphics.SurfaceTexture;
import android.os.Handler;
import android.os.Looper;
import android.view.Surface;
import android.view.TextureView;
import android.view.View;
import com.longbridge.nsh.NshComponent;
import com.longbridge.nsh.NshComponentContext;
import org.json.JSONArray;
import org.json.JSONObject;
import org.json.JSONTokener;

final class MpvView implements NshComponent, TextureView.SurfaceTextureListener {
  private static final Handler MAIN = new Handler(Looper.getMainLooper());

  private final NshComponentContext context;
  private final TextureView texture;
  /** The Surface mpv draws into, while the texture is there. */
  private Surface surface;
  private long handle;
  /** The view is gone: the player's last events (it stops on a thread of its own) go nowhere. */
  private volatile boolean destroyed;

  MpvView(NshComponentContext context) {
    this.context = context;
    texture = new TextureView(context.getContext());
    texture.setSurfaceTextureListener(this);
    handle = nativeCreate();
  }

  @Override public View view() { return texture; }

  @Override public void setProp(String name, Object value) {
    if (handle != 0) nativeProp(handle, name, json(value));
  }

  @Override public void command(String name, Object args) {
    if (handle != 0) nativeCommand(handle, name, json(args));
  }

  @Override public void setAnimatedNumber(String name, double value) {}
  @Override public void setAnimatedColor(String name, int value) {}

  @Override public void destroy() {
    destroyed = true;
    long h = handle;
    handle = 0;
    // The player stops on a thread of its own; mpv keeps its own reference to the window while
    // it does, so the Surface goes now.
    nativeDestroy(h);
    releaseSurface();
  }

  @Override public void onSurfaceTextureAvailable(SurfaceTexture st, int width, int height) {
    surface = new Surface(st);
    if (handle != 0) {
      nativeAttach(handle, surface);
      nativeSize(handle, width, height);
    }
  }

  @Override public void onSurfaceTextureSizeChanged(SurfaceTexture st, int width, int height) {
    if (handle != 0) nativeSize(handle, width, height);
  }

  @Override public boolean onSurfaceTextureDestroyed(SurfaceTexture st) {
    if (handle == 0 || surface == null) {
      releaseSurface();
      return true;
    }
    // mpv lets go of the Surface on its own thread, then both are released (`release`): kept
    // until then, not released by the TextureView (false).
    surface = null;
    nativeDetach(handle, st);
    return false;
  }

  /** mpv no longer draws into `surface` (called from the player's thread). */
  static void release(final Surface surface, final SurfaceTexture texture) {
    MAIN.post(() -> {
      surface.release();
      if (texture != null) texture.release();
    });
  }

  @Override public void onSurfaceTextureUpdated(SurfaceTexture st) {}

  private void releaseSurface() {
    if (surface != null) {
      surface.release();
      surface = null;
    }
  }

  /** A player event (from the core's thread): to NSH on the main thread. */
  void emit(String name, String json) {
    if (destroyed) return;
    Object data;
    try {
      data = json == null ? null : new JSONTokener(json).nextValue();
    } catch (Exception e) {
      data = null;
    }
    final Object payload = data;
    texture.post(() -> {
      if (!destroyed) context.emit(name, payload);
    });
  }

  /** Any value as a one-element JSON array, so strings and null travel as JSON too. */
  private static String json(Object value) {
    return new JSONArray().put(JSONObject.wrap(value)).toString();
  }

  private native long nativeCreate();
  private native void nativeAttach(long handle, Object surface);
  private native void nativeDetach(long handle, Object texture);
  private native void nativeSize(long handle, int width, int height);
  private native void nativeProp(long handle, String name, String json);
  private native void nativeCommand(long handle, String name, String json);
  private native void nativeDestroy(long handle);
}
