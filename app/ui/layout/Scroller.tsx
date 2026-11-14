// The scroll view of a `scroller` (scrollCtl.ts): hides the system's
// indicator; on a Mac a thin bar of our own replaces it, a TV and a phone
// show none.
import { Scroll, signal, View, type JSX, type ScrollEvent, type ScrollRef, type ViewRef, type ViewStyle } from "nsh";
import { Scrollbar } from "nsh/base";
import { alpha, colors, density, u } from "../theme";
import { stopAll, type ScrollCtl } from "./scrollCtl";

export { scroller, type Follow, type Placement, type ScrollCtl } from "./scrollCtl";

/** How long the bar stays after the last scroll or pointer move, ms. */
const BAR_IDLE = 1000;

const barLayer = (horizontal: boolean, shown: boolean): ViewStyle => ({
  position: "absolute",
  ...(horizontal ? { left: 0, right: 0, bottom: 0, height: thickness() } : { top: 0, bottom: 0, right: 0, width: thickness() }),
  opacity: shown ? 1 : 0,
  pointerEvents: shown ? "box-none" : "none",
  transitionProperty: "opacity",
  transitionDuration: shown ? 120 : 300,
  transitionTimingFunction: "ease-out",
});
const thickness = () => Math.max(10, u(18));
const trackStyle = (horizontal: boolean): ViewStyle => ({
  position: "absolute",
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  padding: Math.max(3, u(5)),
  alignItems: horizontal ? "stretch" : "flex-end",
  justifyContent: horizontal ? "flex-end" : "flex-start",
});
const thumbStyle = (horizontal: boolean): ViewStyle => ({
  ...(horizontal ? { height: Math.max(4, u(6)) } : { width: Math.max(4, u(6)) }),
  borderRadius: 999,
  backgroundColor: alpha(colors.ash(), 0.55),
});

/** Our own thin bar, shown while the view scrolls or the pointer moves. */
function Bar(props: { ctl: ScrollCtl; shown: () => boolean }) {
  const horizontal = props.ctl.horizontal;
  return (
    <View style={barLayer(horizontal, props.shown())}>
      <Scrollbar
        scroll={props.ctl.scroll()}
        axis={horizontal ? "horizontal" : "vertical"}
        mode="always"
        minThumbLength={u(64)}
        style={trackStyle(horizontal)}
        thumbStyle={thumbStyle(horizontal)}
      />
    </View>
  );
}

/** `style` is the outer view's (size, background); `onScroll` hears where
 * the content is. */
export function Scroller(props: { ctl: ScrollCtl; style?: ViewStyle; onScroll?: (e: ScrollEvent) => void; children: JSX.Element }) {
  const c = props.ctl;
  // Our thin bar for pages only: rows of cards show none (a trackpad, the keys and the focus move them).
  const bar = density === "regular" && !c.horizontal;
  const shown = signal(false);
  let hide = 0;
  const poke = () => {
    if (!bar) return;
    shown.set(true);
    clearTimeout(hide);
    hide = setTimeout(() => shown.set(false), BAR_IDLE);
  };
  return (
    <View style={props.style} onMouseMove={poke} onWheel={stopAll}>
      <Scroll
        ref={(r: ScrollRef) => c.scroll.set(r)}
        horizontal={c.horizontal}
        scrollbar={false}
        // No overscroll bounce anywhere: content stops at its edges.
        bounces={false}
        scrollEventThrottle={16}
        onScroll={(e: ScrollEvent) => {
          c.remember(c.horizontal ? e.offset.x : e.offset.y);
          poke();
          props.onScroll?.(e);
        }}
        onScrollDragStart={stopAll}
        style={c.horizontal ? undefined : { flex: 1 }}
      >
        <View ref={(r: ViewRef) => (c.content = r)}>{props.children}</View>
      </Scroll>
      <If when={bar}>
        <Bar ctl={c} shown={shown} />
      </If>
    </View>
  );
}
