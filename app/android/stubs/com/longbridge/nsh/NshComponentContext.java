// Compile-only: what NSH hands a native component (its runtime has the real one).
package com.longbridge.nsh;

public class NshComponentContext {
  public final int id = 0;
  public final NshView view = null;
  public android.content.Context getContext() { return null; }
  public void emit(String name, Object data) {}
  public void setSize(float width, float height) {}
}
