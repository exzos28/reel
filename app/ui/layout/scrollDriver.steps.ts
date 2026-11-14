// The native apps' driver: the scroll view's own offset, stepped every animation frame
// with an ease-out (scrollDriver.ts).
import { easeOut } from "./anchor";
import type { DriverHost, ScrollDriver } from "./scrollDriver";

/** How long a glide takes, ms. */
const DURATION = 200;

export function stepDriver(host: DriverHost): ScrollDriver {
  let at = 0;
  let frame = 0;
  const set = (v: number) => {
    at = v;
    host.scroll()?.scrollTo(host.horizontal ? { x: v, animated: false } : { y: v, animated: false });
  };
  const stop = () => {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
  };
  return {
    to(target, animate) {
      stop();
      if (!animate) return set(target);
      const from = at;
      const t0 = performance.now();
      const step = (now: number) => {
        const p = Math.min(1, (now - t0) / DURATION);
        set(from + (target - from) * easeOut(p));
        frame = p < 1 ? requestAnimationFrame(step) : 0;
      };
      frame = requestAnimationFrame(step);
    },
    stop,
    moving: () => frame !== 0,
    at: () => at,
    sync: (offset) => {
      if (!frame) at = offset;
    },
  };
}
