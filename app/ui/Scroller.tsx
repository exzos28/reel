// Scroll views that follow the remote: the focused block slides to a fixed
// anchor (a shelf's card to the left edge of the content inset, a page's row
// to the upper third), shown whole with room for the focus ring, in a short
// ease-out (a jump when the viewer asks for less motion). Only arrow keys
// move them this way: a pointer press that moves the focus, the wheel and
// the trackpad leave the offset to the viewer. On a Mac a thin bar of our
// own replaces the system's; a TV and a phone show none.
import { effect, reduceMotion, Scroll, signal, View, type JSX, type ScrollRef, type ViewRef, type ViewStyle } from "nsh";
import { Scrollbar } from "nsh/base";
import { anchorOffset, easeOut, nearestOffset } from "./anchor";
import { alpha, colors, density, ringRoom, u } from "./theme";

/** How long a keyed scroll takes, ms. */
const DURATION = 200;
/** How long the bar stays after the last scroll or pointer move, ms. */
const BAR_IDLE = 1000;

/** When an arrow key last moved the focus (`byKeys`). */
let keyedAt = -Infinity;
const keyed = () => performance.now() - keyedAt < 250;

/** Arrow-key bindings that mark their moves as keyed, so the scroll views
 * follow the focus they move (and not one a pointer press moved). */
export function byKeys(bindings: Record<string, (e: { keystroke: string }) => void>) {
  const out: typeof bindings = {};
  for (const [key, run] of Object.entries(bindings)) {
    out[key] = (e) => {
      keyedAt = performance.now();
      run(e);
    };
  }
  return out;
}

/** Where a followed block goes: to the anchor, only as far as needed to show
 * it whole, or to the start of the content. */
export type Placement = "anchor" | "nearest" | "start";

const running = new Set<() => void>();
/** The viewer took over (wheel, trackpad, drag): every keyed scroll stops. */
const stopAll = () => running.forEach((stop) => stop());

export interface ScrollCtl {
  horizontal: boolean;
  /** A ref for a block that the scroll view brings to its place whenever
   * `when` turns true by a key; the first time (the screen opening, or
   * coming back to it), it only shows it, at once. */
  follow(when: () => boolean, placement?: Placement): (r: ViewRef) => void;
  /** @internal The scroll view and its content, set by `Scroller`. */
  scroll: ReturnType<typeof signal<ScrollRef | undefined>>;
  content?: ViewRef;
}

/** A scroll view's follower. `anchor` is where a block's start sits, from
 * the viewport's start, given the viewport's length. */
export function scroller(opts: { horizontal?: boolean; anchor: (viewport: number) => number }): ScrollCtl {
  const horizontal = !!opts.horizontal;
  let frame = 0;
  let at = 0;
  const stop = () => {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    running.delete(stop);
  };
  const set = (v: number) => {
    at = v;
    ctl.scroll()?.scrollTo(horizontal ? { x: v, animated: false } : { y: v, animated: false });
  };
  const go = (target: number, animate: boolean) => {
    stop();
    if (!animate || reduceMotion() || Math.abs(target - at) < 1) return set(target);
    const from = at;
    const t0 = performance.now();
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / DURATION);
      set(from + (target - from) * easeOut(p));
      frame = p < 1 ? requestAnimationFrame(step) : 0;
      if (!frame) running.delete(stop);
    };
    running.add(stop);
    frame = requestAnimationFrame(step);
  };
  const place = async (block: ViewRef, placement: Placement, first: boolean) => {
    const scroll = ctl.scroll();
    if (!scroll || !ctl.content) return;
    const [b, s, c] = await Promise.all([block.measure(), scroll.measure(), ctl.content.measure()]);
    if (!b || !s || !c) return;
    const axis = horizontal ? "x" : "y";
    const length = horizontal ? "width" : "height";
    const current = s.pagePosition[axis] - c.pagePosition[axis];
    if (!frame) at = current;
    const start = b.pagePosition[axis] - c.pagePosition[axis];
    const geometry = {
      start,
      end: start + b.bounds.size[length],
      viewport: s.bounds.size[length],
      content: c.bounds.size[length],
      pad: ringRoom(),
    };
    const target =
      placement === "start" ? 0
      : placement === "nearest" || (first && !horizontal) ? nearestOffset(geometry, current)
      : anchorOffset({ ...geometry, anchor: opts.anchor(geometry.viewport) });
    go(target, !first);
  };
  const ctl: ScrollCtl = {
    horizontal,
    scroll: signal<ScrollRef | undefined>(),
    follow(when, placement = "anchor") {
      let ref: ViewRef | undefined;
      let first = true;
      effect(() => {
        const on = when();
        const initial = first;
        first = false;
        if (!on || (!initial && !keyed())) return;
        // After this turn: the refs are set and the changes laid out.
        Promise.resolve().then(() => ref && place(ref, placement, initial));
      });
      return (r: ViewRef) => (ref = r);
    },
  };
  return ctl;
}

/** The scroll view of a `scroller`: hides the system's indicator, draws our
 * own bar on a Mac. `style` is the outer view's (size, background). */
export function Scroller(props: { ctl: ScrollCtl; style?: ViewStyle; children: JSX.Element }) {
  const c = props.ctl;
  const bar = density === "regular";
  const shown = signal(false);
  let hide = 0;
  const poke = () => {
    if (!bar) return;
    shown.set(true);
    clearTimeout(hide);
    hide = setTimeout(() => shown.set(false), BAR_IDLE);
  };
  const thickness = Math.max(10, u(18));
  return (
    <View style={props.style} onMouseMove={poke} onWheel={stopAll}>
      <Scroll
        ref={(r: ScrollRef) => c.scroll.set(r)}
        horizontal={c.horizontal}
        scrollbar={false}
        scrollEventThrottle={16}
        onScroll={poke}
        onScrollDragStart={stopAll}
        style={c.horizontal ? undefined : { flex: 1 }}
      >
        <View ref={(r: ViewRef) => (c.content = r)}>{props.children}</View>
      </Scroll>
      <If when={bar}>
        <View
          style={{
            position: "absolute",
            ...(c.horizontal ? { left: 0, right: 0, bottom: 0, height: thickness } : { top: 0, bottom: 0, right: 0, width: thickness }),
            opacity: shown() ? 1 : 0,
            pointerEvents: shown() ? "box-none" : "none",
            transitionProperty: "opacity",
            transitionDuration: shown() ? 120 : 300,
            transitionTimingFunction: "ease-out",
          }}
        >
          <Scrollbar
            scroll={c.scroll()}
            axis={c.horizontal ? "horizontal" : "vertical"}
            mode="always"
            minThumbLength={u(64)}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              padding: Math.max(3, u(5)),
              alignItems: c.horizontal ? "stretch" : "flex-end",
              justifyContent: c.horizontal ? "flex-end" : "flex-start",
            }}
            thumbStyle={{
              ...(c.horizontal ? { height: Math.max(4, u(6)) } : { width: Math.max(4, u(6)) }),
              borderRadius: 999,
              backgroundColor: alpha(colors.ash(), 0.55),
            }}
          />
        </View>
      </If>
    </View>
  );
}
