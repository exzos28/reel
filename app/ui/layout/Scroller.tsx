// The scroll view of a `scroller` (scrollCtl.ts): hides the system's
// indicator; on a Mac a thin bar of our own replaces it, a TV and a phone
// show none.
import { Scroll, signal, View, type JSX, type ScrollEvent, type ScrollRef, type ViewRef, type ViewStyle, type WheelEvent } from "nsh";
import { Scrollbar } from "nsh/base";
import { alpha, colors, density, u } from "../theme";
import { family } from "../platform";
import { stopAll, type ScrollCtl } from "./scrollCtl";

export { scroller, type Follow, type Placement, type ScrollCtl } from "./scrollCtl";

/** Windows and Linux: reel scrolls with the wheel itself, faster than the system's 48 px a notch
 * and gliding (notches in a row add up, so it coasts); a Mac's trackpad and wheel keep the
 * system's, which already coast. */
const OWN_WHEEL = family === "windows" || family === "linux";
/** Points a wheel notch moves (it reports lines: three a notch). */
const POINTS_PER_LINE = 40;

/** The page the pointer was last over: a wheel over what floats above it (a card's preview)
 * moves it (`wheelPage`). */
let pointerPage: ScrollCtl | undefined;

/** A page's wheel: stops keyed scrolls and, where reel scrolls it itself (`own`), moves the page
 * along the wheel; not with Shift or a mostly sideways touchpad move (a row under the pointer
 * takes those natively). */
function pageWheel(c: ScrollCtl, e: WheelEvent, own: boolean) {
  stopAll();
  if (!own) return;
  if (e.modifiers.shift || Math.abs(e.delta.x) > Math.abs(e.delta.y)) return;
  const scale = e.deltaMode === "lines" ? POINTS_PER_LINE : 1;
  if (e.delta.y !== 0) c.nudge(e.delta.y * scale);
}

/** A wheel over a view outside every page (a card's preview) moves the page under it, on every
 * desktop: no scroll view is under it to take the wheel natively. */
export const wheelPage = (e: WheelEvent) => {
  if (pointerPage) pageWheel(pointerPage, e, true);
};

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
 * the content is, `onContent` how long the content is. */
export function Scroller(props: {
  ctl: ScrollCtl;
  style?: ViewStyle;
  onScroll?: (e: ScrollEvent) => void;
  onContent?: (length: number) => void;
  /** Off, a drag on it does not scroll it (a bottom sheet at medium takes the drag). */
  scrollable?: () => boolean;
  children: JSX.Element;
}) {
  const c = props.ctl;
  // Our thin bar for pages only: rows of cards show none (a trackpad, the keys and the focus move them).
  const bar = density() === "regular" && !c.horizontal;
  const shown = signal(false);
  let hide = 0;
  const poke = () => {
    if (!bar) return;
    shown.set(true);
    clearTimeout(hide);
    hide = setTimeout(() => shown.set(false), BAR_IDLE);
  };
  return (
    <View
      style={props.style}
      onLayout={(e) => c.sized(c.horizontal ? e.bounds.size.width : e.bounds.size.height, null)}
      onMouseMove={() => {
        if (!c.horizontal) pointerPage = c;
        poke();
      }}
      // Only a page listens: NSH gives a wheel to the nearest listener alone, so a row that
      // listened would keep vertical wheels from its page. A row scrolls natively (Shift + wheel,
      // a sideways wheel or touchpad); the page around it hears every wheel.
      onWheel={c.horizontal ? undefined : (e) => pageWheel(c, e, OWN_WHEEL)}
    >
      <Scroll
        ref={(r: ScrollRef) => c.scroll.set(r)}
        testID={c.domId}
        horizontal={c.horizontal}
        // Where reel moves a page with the wheel itself, the system's wheel is off for it (it would
        // move it too); rows keep the system's.
        scrollable={(c.horizontal || !OWN_WHEEL) && (props.scrollable?.() ?? true)}
        scrollbar={false}
        // The platform's overscroll bounce where it has one (iOS, macOS): content springs back at its edges.
        scrollEventThrottle={16}
        keyboardShouldPersistTaps={c.keepsKeyboard ? "handled" : "never"}
        onScroll={(e: ScrollEvent) => {
          c.remember(c.horizontal ? e.offset.x : e.offset.y);
          poke();
          props.onScroll?.(e);
        }}
        onScrollDragStart={stopAll}
        style={c.horizontal ? undefined : { flex: 1 }}
      >
        <View
          ref={(r: ViewRef) => (c.content = r)}
          onLayout={(e) => {
            const length = c.horizontal ? e.bounds.size.width : e.bounds.size.height;
            c.sized(null, length);
            props.onContent?.(length);
          }}
        >
          {props.children}
        </View>
      </Scroll>
      <If when={bar}>
        <Bar ctl={c} shown={shown} />
      </If>
    </View>
  );
}
