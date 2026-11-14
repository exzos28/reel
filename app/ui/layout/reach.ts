// How many cards of a horizontal row to render: up to the furthest the row has been
// moved to (by the focus or by scrolling) and a few more, never fewer. A row of twenty
// mounts the six or seven a screen shows; the rest mount as the row is moved along, and
// stay (what has been seen does not jump).
import { computed, windowSize } from "nsh";
import type { ScrollCtl } from "./scrollCtl";

/** Cards past the furthest seen one: mounted before the focus or the scroll gets there. */
const AHEAD = 3;

export function rowReach(o: { line: ScrollCtl; focusedAt: () => number | null; step: () => number }) {
  let furthest = 0;
  return computed(() => {
    const focus = (o.focusedAt() ?? -1) + 1;
    const scrolled = Math.ceil(((o.line.offset() ?? 0) + windowSize().width) / Math.max(1, o.step()));
    furthest = Math.max(furthest, focus, scrolled);
    return furthest + AHEAD;
  });
}
