// A desktop's window (window.ts): no system title bar, reel's own window bar over every
// page, the player's drag strips, full screen.
import { cleanup, signal, View, type ViewStyle } from "nsh";
import { currentWindow, isAvailable as hasWindows } from "nsh/desktop";
import { BAR_HEIGHT, barBackBox, WindowBar } from "../layout/WindowBar";
import type { Fullscreen, WindowFrameProps } from "./window";

/** The window has no system title bar: the window bar is reel's own, the hero's still
 * running up to the top edge under it and the window's controls. */
export function hideTitleBar() {
  if (hasWindows) currentWindow().set({ titleBar: { style: "hidden", height: BAR_HEIGHT } });
}

/** The player has no bar: its top still drags the window, around its Back (a strip over
 * Back would take its clicks). */
function PlayerDragStrips() {
  const b = barBackBox(false);
  const strip = (x: ViewStyle): ViewStyle => ({ position: "absolute", top: 0, height: BAR_HEIGHT, zIndex: 10, ...x });
  return (
    <View style={{ position: "absolute", top: 0, left: 0, right: 0, height: BAR_HEIGHT, pointerEvents: "box-none" }}>
      <View desktop={{ windowDrag: true }} style={strip({ left: 0, width: b.left })} />
      <View desktop={{ windowDrag: true }} style={strip({ left: b.left + b.width, right: 0 })} />
    </View>
  );
}

/** The window bar over the pages; the drag strips over the player. */
export function DesktopFrame(props: WindowFrameProps) {
  return (
    <If when={!props.playing()} else={<PlayerDragStrips />}>
      <WindowBar />
    </If>
  );
}

/** The window filling the screen. Taken while rendering: NSH's currentWindow() throws in
 * handlers. Left as it was found when the component that took it goes. */
export function windowFullscreen(): Fullscreen {
  const win = currentWindow();
  const on = signal(win?.state()?.mode === "fullScreen");
  const was = on();
  if (win) cleanup(win.on("modeChange", (e) => on.set(e.mode === "fullScreen")));
  const set = (to: boolean) => {
    if (!win) return;
    win.setMode(to ? "fullScreen" : "normal");
    on.set(to);
  };
  cleanup(() => {
    if (on() !== was) set(was);
  });
  return { on, set };
}
