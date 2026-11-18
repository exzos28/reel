// The native apps' driver: the scroll view's own offset, stepped every animation frame
// with an ease-out (scroll.ts).
import { easeOut } from "../layout/anchor";
import type { DriverHost, ScrollDriver } from "./scroll";

/** How long a glide takes, ms. */
const DURATION = 200;
/** A coast (the wheel's) closes the distance to where it is heading exponentially: after this
 * many ms it has covered 63% of what was left, so it starts quick and dies away softly. */
const COAST = 120;

export function stepDriver(host: DriverHost): ScrollDriver {
  let at = 0;
  let frame = 0;
  /** A coast runs, heading for `aim`. */
  let coasting = false;
  let aim = 0;
  const set = (v: number) => {
    at = v;
    host.scroll()?.scrollTo(host.horizontal ? { x: v, animated: false } : { y: v, animated: false });
  };
  const stop = () => {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    coasting = false;
  };
  return {
    to(target, animate, coast) {
      if (animate && coast) {
        aim = target;
        if (coasting) return;
        stop();
        coasting = true;
        let last = performance.now();
        const chase = (now: number) => {
          const dt = Math.min(50, now - last);
          last = now;
          const next = at + (aim - at) * (1 - Math.exp(-dt / COAST));
          if (Math.abs(aim - next) < 0.5) {
            set(aim);
            frame = 0;
            coasting = false;
            return;
          }
          set(next);
          frame = requestAnimationFrame(chase);
        };
        frame = requestAnimationFrame(chase);
        return;
      }
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
