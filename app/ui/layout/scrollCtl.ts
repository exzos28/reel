// Scroll views that follow the remote: the focused block slides to a fixed
// anchor (a shelf's card to the left edge of the content inset, a page's row
// to the upper third), shown whole with room for the focus ring, in a short
// ease-out (a jump when the viewer asks for less motion). Only arrow keys
// move them this way: a pointer press that moves the focus, the wheel and
// the trackpad leave the offset to the viewer.
import { effect, platform, reduceMotion, signal, type ScrollRef, type ViewRef } from "nsh";
import { keyed } from "../focus/keys";
import { density, ringRoom, safe } from "../theme";
import { anchorOffset, easeOut, nearestOffset } from "./anchor";

/** How long a keyed scroll takes, ms. */
const DURATION = 200;

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
}

/** A scroll view's follower. `anchor` is where a block's start sits, from
 * the viewport's start, given the viewport's length. A page opens where it
 * was left (`memory` names it) or at its top: opening a screen never scrolls
 * it to its focus, so switching screens does not make it jump. */
/** The web build (a Samsung TV): the app's code runs in a frame the browser does not
 * draw, where requestAnimationFrame never calls back and steps sent one by one arrive in
 * bursts; the browser's own smooth scrolling animates there instead. */
const webBuild = platform.os === "web";

export function scroller(opts: { horizontal?: boolean; anchor: (viewport: number) => number; memory?: string }): ScrollCtl {
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
    if (webBuild) {
      at = target;
      ctl.scroll()?.scrollTo(horizontal ? { x: target, animated: true } : { y: target, animated: true });
      return;
    }
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
    if (first && !horizontal) {
      go(opts.memory ? (offsets.get(opts.memory) ?? 0) : 0, false);
      return;
    }
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
      // On a TV a block is kept clear of the title-safe edge too (the set may crop it).
      pad: density === "ten-foot" ? Math.max(ringRoom(), safe().y) : ringRoom(),
    };
    const target =
      placement === "start" ? 0
      : placement === "nearest" ? nearestOffset(geometry, current)
      : anchorOffset({ ...geometry, anchor: opts.anchor(geometry.viewport) });
    go(target, !first);
  };
  const ctl: ScrollCtl = {
    horizontal,
    offset: signal(0),
    remember(offset) {
      ctl.offset.set(offset);
      if (!frame) at = offset;
      if (opts.memory) offsets.set(opts.memory, offset);
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
