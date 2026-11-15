// Compile-only: NSH's native component interface (its runtime has the real one).
package com.longbridge.nsh;

public interface NshComponent {
  android.view.View view();
  void setProp(String name, Object value);
  void command(String name, Object args);
  void setAnimatedNumber(String name, double value);
  void setAnimatedColor(String name, int value);
  void destroy();

  interface Factory {
    NshComponent create(NshComponentContext context);
  }
}
