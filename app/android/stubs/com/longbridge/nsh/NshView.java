// Compile-only: NSH's own class as reel's Java sees it (the real one is in NSH's runtime).
package com.longbridge.nsh;

public class NshView extends android.widget.FrameLayout {
  public NshView(android.content.Context context) { super(context); }
  public void registerComponent(String name, NshComponent.Factory factory) {}
}
