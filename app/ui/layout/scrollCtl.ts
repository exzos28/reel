// Scroll views that follow the remote: the focused block slides to a fixed
// anchor (a shelf's card to the left edge of the content inset, a page's row
// to the upper third), shown whole with room for the focus ring, in a short
// ease-out (a jump when the viewer asks for less motion). Only arrow keys
// move them this way: a pointer press that moves the focus, the wheel and
// the trackpad leave the offset to the viewer. Where to go is decided here;
// going there is the platform's scroll driver's (platform/scroll.ts).
import { effect, reduceMotion, signal, type ScrollRef, type ViewRef } from "nsh";
import { keyed } from "../focus/keys";
import { perf } from "../platform/diagnostics";
import { density, ringRoom, safe } from "../theme";
import { anchorOffset, nearestOffset } from "./anchor";
import { scrollDriver } from "../platform/scroll";

/** Where a followed block goes: to the anchor, only as far as needed to show
 * it whole, or to the start of the content. */
export type Placement = "anchor" | "nearest" | "start";

/** A block's ref that a scroll view follows while `when` holds (`ScrollCtl.follow`). */
export type Follow = (when: () => boolean) => (r: ViewRef) => void;

const running = new Set<() => void>();
/** Where each remembered page was left (`scroller({ memory })`). */
const offsets = new Map<string, number>();
/** The page remembered as `memory` opens at its top next time. */
export const forgetScroll = (memory: string) => offsets.delete(memory);
/** The viewer took over (wheel, trackpad, drag): every keyed scroll stops. */
export const stopAll = () => running.forEach((stop) => stop());

export interface ScrollCtl {
  horizontal: boolean;
  /** A ref for a block that the scroll view brings to its place whenever
   * `when` turns true by a key; the first time (the screen opening, or
   * coming back to it), it only shows it, at once. */
  follow(when: () => boolean, placement?: Placement): (r: ViewRef) => void;
  /** How far the view is scrolled (points), for `LazyBlock`. */
  offset: ReturnType<typeof signal<number>>;
  /** @internal Where the view is now, from `Scroller`'s scroll events. */
  remember(offset: number): void;
  /** @internal The scroll view and its content, set by `Scroller`. */
  scroll: ReturnType<typeof signal<ScrollRef | undefined>>;
  content?: ViewRef;
  /** @internal The scroll view's `testID`: a TV's web build finds its element by it (platform/scroll.slide). */
  domId: string;
}

let scrollers = 0;

/** A scroll view's follower. `anchor` is where a block's start sits, from
 * the viewport's start, given the viewport's length. A page opens where it
 * was left (`memory` names it) or at its top: opening a screen never scrolls
 * it to its focus, so switching screens does not make it jump. */
export function scroller(opts: { horizontal?: boolean; anchor: (viewport: number) => number; memory?: string }): ScrollCtl {
  const horizontal = !!opts.horizontal;
  const remember = (offset: number) => {
    ctl.offset.set(offset);
    if (opts.memory) offsets.set(opts.memory, offset);
  };
  const domId = `scroll-${++scrollers}`;
  const driver = scrollDriver({ horizontal, domId, scroll: () => ctl.scroll(), rest: remember });
  const stop = () => {
    driver.stop();
    running.delete(stop);
  };
  const go = (target: number, animate: boolean) => {
    const glide = animate && !reduceMotion() && Math.abs(target - driver.at()) >= 1;
    if (glide) running.add(stop);
    driver.to(target, glide);
  };
  const place = async (block: ViewRef, placement: Placement, first: boolean) => {
    if (first && !horizontal) {
      go(opts.memory ? (offsets.get(opts.memory) ?? 0) : 0, false);
      return;
    }
    const t0 = performance.now();
    const scroll = ctl.scroll();
    if (!scroll || !ctl.content) return;
    const [b, s, c] = await Promise.all([block.measure(), scroll.measure(), ctl.content.measure()]);
    if (!b || !s || !c) return;
    const axis = horizontal ? "x" : "y";
    const length = horizontal ? "width" : "height";
    const current = s.pagePosition[axis] - c.pagePosition[axis];
    driver.sync(current);
    const start = b.pagePosition[axis] - c.pagePosition[axis];
    const geometry = {
      start,
      end: start + b.bounds.size[length],
      viewport: s.bounds.size[length],
      content: c.bounds.size[length],
      // On a TV a block is kept clear of the title-safe edge too (the set may crop it).
      pad: density === "ten-foot" ? Math.max(ringRoom(), safe().y) : ringRoom(),
    };
    // A TV keeps one focus line: up and down move the page under it, never the focus over
    // a page standing still (only where the page cannot move: its very top and end).
    const fixedLine = density === "ten-foot" && !horizontal;
    const target =
      placement === "start" ? 0
      : placement === "nearest" && !fixedLine ? nearestOffset(geometry, current)
      : anchorOffset({ ...geometry, anchor: opts.anchor(geometry.viewport) });
    if (perf.on && !horizontal && !first) {
      console.log(`[perf] scroll ${Math.round(current)} → ${Math.round(target)} (block ${Math.round(start)}, view ${Math.round(geometry.viewport)}, content ${Math.round(geometry.content)}): sent ${Math.round(performance.now() - t0)} ms after the key`);
    }
    go(target, !first);
  };
  const ctl: ScrollCtl = {
    horizontal,
    domId,
    offset: signal(0),
    remember(offset) {
      remember(offset);
      driver.sync(offset);
    },
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
