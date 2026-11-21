// A TV remote's and a gamepad's keys as reel's keymap knows them. NSH 0.6.1 names a key for the
// app's shortcuts (`keymap.bind`) from Android's key code, and its table has no OK of a remote
// (DPAD_CENTER), no gamepad A and no media key: OK did nothing on a Google TV. Each activity's
// window gets its key events through this first (Install), with these keys as keys NSH names:
//
//   OK (DPAD_CENTER), gamepad A, keypad Enter   ->  Enter          (keymap "enter")
//   MEDIA_REWIND                                ->  F7             (keymap "f7")
//   MEDIA_PLAY_PAUSE                            ->  F8             (keymap "f8")
//   MEDIA_FAST_FORWARD                          ->  F9             (keymap "f9")
//   MEDIA_PLAY                                  ->  F10            (keymap "f10")
//   MEDIA_PAUSE                                 ->  F11            (keymap "f11")
//
// (F7 to F9 are a Mac keyboard's media keys.) A key the app does not take goes on as it came: the
// window's own fallback (a media key to the system's playback).
package app.reel.views;

import android.view.KeyEvent;
import android.view.Window;
import java.lang.reflect.InvocationHandler;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.lang.reflect.Proxy;

final class RemoteKeys implements InvocationHandler {
  private final Window.Callback window;

  private RemoteKeys(Window.Callback window) {
    this.window = window;
  }

  /** The window's callback, its key events translated first (once per window). */
  static void wrap(Window w) {
    Window.Callback cb = w.getCallback();
    if (cb == null || (Proxy.isProxyClass(cb.getClass()) && Proxy.getInvocationHandler(cb) instanceof RemoteKeys)) {
      return;
    }
    w.setCallback((Window.Callback) Proxy.newProxyInstance(
        RemoteKeys.class.getClassLoader(), new Class<?>[] {Window.Callback.class}, new RemoteKeys(cb)));
  }

  /** The key code reel's keymap knows the key by, or the key's own. */
  static int translate(int code) {
    switch (code) {
      case KeyEvent.KEYCODE_DPAD_CENTER:
      case KeyEvent.KEYCODE_BUTTON_A:
      case KeyEvent.KEYCODE_NUMPAD_ENTER:
        return KeyEvent.KEYCODE_ENTER;
      case KeyEvent.KEYCODE_MEDIA_REWIND:
        return KeyEvent.KEYCODE_F7;
      case KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE:
        return KeyEvent.KEYCODE_F8;
      case KeyEvent.KEYCODE_MEDIA_FAST_FORWARD:
        return KeyEvent.KEYCODE_F9;
      case KeyEvent.KEYCODE_MEDIA_PLAY:
        return KeyEvent.KEYCODE_F10;
      case KeyEvent.KEYCODE_MEDIA_PAUSE:
        return KeyEvent.KEYCODE_F11;
      default:
        return code;
    }
  }

  @Override
  public Object invoke(Object proxy, Method method, Object[] args) throws Throwable {
    if ("dispatchKeyEvent".equals(method.getName()) && args != null && args.length == 1 && args[0] instanceof KeyEvent) {
      KeyEvent e = (KeyEvent) args[0];
      int code = translate(e.getKeyCode());
      if (code != e.getKeyCode()) {
        KeyEvent as = new KeyEvent(e.getDownTime(), e.getEventTime(), e.getAction(), code, e.getRepeatCount(),
            e.getMetaState(), e.getDeviceId(), e.getScanCode(), e.getFlags(), e.getSource());
        // Not taken (false): the window falls back on the key as it came.
        return window.dispatchKeyEvent(as);
      }
    }
    try {
      return method.invoke(window, args);
    } catch (InvocationTargetException e) {
      throw e.getCause();
    }
  }
}
