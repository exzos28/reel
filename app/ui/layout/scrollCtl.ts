// Scroll views that follow the remote: the focused block slides to a fixed
// anchor (a shelf's card to the left edge of the content inset, a page's row
// to the upper third), shown whole with room for the focus ring, in a short
// ease-out (a jump when the viewer asks for less motion). Only arrow keys
// move them this way: a pointer press that moves the focus, the wheel and
// the trackpad leave the offset to the viewer. Where to go is decided here;
// going there is the platform's scroll driver's (platform/scroll.ts).
import { effect, reduceMotion, signal, type ScrollRef, type ViewRef } from "nsh";
import { keyed } from "../focus/keys";
import { caps } from "../platform";
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
/** Counts every move of any scroll view where a pointer rests (a desktop): what is anchored to a
 * view that scrolled away (a card's preview) reads it to close, as the pointer under a wheel does
 * not move and says nothing. A TV and touch never count. */
export const scrolled = signal(0);
/** Where each remembered page was left (`scroller({ memory })`). */
const offsets = new Map<string, number>();
/** The page remembered as `memory` opens at its top next time. */
export const forgetScroll = (memory: string) => offsets.delete(memory);
/** The viewer took over (wheel, trackpad, drag): every keyed scroll stops. */
export const stopAll = () => running.forEach((stop) => stop());

export interface ScrollCtl {
  horizontal: boolean;
  /** A tap on its content acts while a keyboard is up (it stays up), instead of only closing the
   * keyboard: Search's recent searches, its results. */
  keepsKeyboard: boolean;
  /** A ref for a block that the scroll view brings to its place whenever
   * `when` turns true by a key; the first time (the screen opening, or
   * coming back to it), it only shows it, at once. */
  follow(when: () => boolean, placement?: Placement): (r: ViewRef) => void;
  /** How far the view is scrolled (points), for `LazyBlock`. */
  offset: ReturnType<typeof signal<number>>;
  /** @internal Where the view is now, from `Scroller`'s scroll events. */
  remember(offset: number): void;
  /** @internal The view's and its content's lengths along its axis, from `Scroller`'s layout: a
   * row whose cards all fit has nowhere to go on (its arrow is off at once, not after a move). */
  sized(viewport: number | null, content: number | null): void;
  /** @internal The scroll view and its content, set by `Scroller`. */
  scroll: ReturnType<typeof signal<ScrollRef | undefined>>;
  content?: ViewRef;
  /** @internal The scroll view's `testID`: a TV's web build finds its element by it (platform/scroll.slide). */
  domId: string;
  /** Moves the view by `delta` points, gliding, within its content: the wheel where reel
   * scrolls it itself (Windows, Linux) and the arrows. Moves in a row add up. */
  nudge(delta: number): void;
  /** Moves the view by most of its length, `dir` 1 forward, -1 back (a row's arrows); by
   * whole cards where the row says how far apart they are (`step`). */
  page(dir: 1 | -1): void;
  /** Glides back to the start (Back on a page, its destination chosen again): through the
   * platform's driver, as every move; a TV's web build moves the content, not the view's own
   * offset, so the view's `scrollTo` would leave it where it is. */
  toStart(): void;
  /** Whether it can move back (`atStart` false) or on (`atEnd` false), from the last measure. */
  atStart: ReturnType<typeof signal<boolean>>;
  atEnd: ReturnType<typeof signal<boolean>>;
}

let scrollers = 0;

/** A scroll view's follower. `anchor` is where a block's start sits, from
 * the viewport's start, given the viewport's length. A page opens where it
 * was left (`memory` names it) or at its top: opening a screen never scrolls
 * it to its focus, so switching screens does not make it jump. */
/** `step`: a row's card width plus its gap, points, where its cards are all one width: its arrows
 * then move it by the cards it shows whole, the next one landing at the anchor. */
export function scroller(opts: { horizontal?: boolean; anchor: (viewport: number) => number; memory?: string; step?: () => number; keepsKeyboard?: boolean }): ScrollCtl {
  const horizontal = !!opts.horizontal;
  /** The view's and its content's lengths along its axis, points (0: not laid out yet). */
  let lengths = { viewport: 0, content: 0 };
  const remember = (offset: number) => {
    if (caps.windowBar) scrolled.set(scrolled() + 1);
    // The row's arrows: back is off at the start; on is off at the end, wherever the move came from
    // (the arrows, the keys, a trackpad), once the row's lengths are known (`sized`); before that,
    // only where a move found the end, until the view moves back from it.
    if (lengths.viewport && lengths.content) ctl.atEnd.set(offset >= lengths.content - lengths.viewport - 1);
    else if ((ctl.offset() ?? 0) > offset) ctl.atEnd.set(false);
    ctl.atStart.set(offset <= 1);
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
      pad: density() === "ten-foot" ? Math.max(ringRoom(), safe().y) : ringRoom(),
    };
    // A TV keeps one focus line: up and down move the page under it, never the focus over
    // a page standing still (only where the page cannot move: its very top and end).
    const fixedLine = caps.remote && !horizontal;
    const target =
      placement === "start" ? 0
      : placement === "nearest" && !fixedLine ? nearestOffset(geometry, current)
      : anchorOffset({ ...geometry, anchor: opts.anchor(geometry.viewport) });
    if (perf.on && !horizontal && !first) {
      console.log(`[perf] scroll ${Math.round(current)} → ${Math.round(target)} (block ${Math.round(start)}, view ${Math.round(geometry.viewport)}, content ${Math.round(geometry.content)}): sent ${Math.round(performance.now() - t0)} ms after the key`);
    }
    go(target, !first);
  };
  /** The view's and its content's lengths, measured now. */
  const extent = async () => {
    const scroll = ctl.scroll();
    if (!scroll || !ctl.content) return null;
    const [s, c] = await Promise.all([scroll.measure(), ctl.content.measure()]);
    if (!s || !c) return null;
    const length = horizontal ? "width" : "height";
    return { viewport: s.bounds.size[length], content: c.bounds.size[length] };
  };
  /** How far a row's arrow moves it: by the cards it shows whole (`step`), from the card at
   * its anchor, so the next card lands there; without a step, by most of the view. */
  const pageDelta = (dir: 1 | -1, viewport: number) => {
    const step = opts.step?.() ?? 0;
    if (step <= 0) return dir * viewport * 0.85;
    const cards = Math.max(1, Math.floor((viewport - opts.anchor(viewport)) / step));
    const from = heading ?? driver.at();
    // The card at the anchor now (a trackpad may have left the row between two).
    const at = dir > 0 ? Math.floor(from / step + 0.01) : Math.ceil(from / step - 0.01);
    return (at + dir * cards) * step - from;
  };
  /** Where a glide of `nudge` is heading (several wheel notches add up to it). */
  let heading: number | null = null;
  const nudge = async (delta: number) => {
    const e = await extent();
    if (!e) return;
    const end = Math.max(0, e.content - e.viewport);
    const from = heading ?? driver.at();
    const target = Math.min(end, Math.max(0, from + delta));
    heading = target;
    ctl.atStart.set(target <= 1);
    ctl.atEnd.set(target >= end - 1);
    go(target, true);
    setTimeout(() => heading === target && (heading = null), 400);
  };
  const sized = (viewport: number | null, content: number | null) => {
    lengths = { viewport: viewport ?? lengths.viewport, content: content ?? lengths.content };
    if (!lengths.viewport || !lengths.content) return;
    ctl.atEnd.set((ctl.offset() ?? 0) >= lengths.content - lengths.viewport - 1);
  };
  const ctl: ScrollCtl = {
    keepsKeyboard: !!opts.keepsKeyboard,
    horizontal,
    domId,
    sized,
    nudge,
    page(dir) {
      extent().then((e) => e && nudge(pageDelta(dir, e.viewport)));
    },
    toStart() {
      heading = null;
      go(0, true);
    },
    atStart: signal(true),
    atEnd: signal(false),
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
