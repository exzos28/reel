// Which cards of a horizontal row to mount: a window around the ones in view (the focused
// card and where the row is scrolled to), a few behind and ahead. The cards left behind
// give way to one blank as wide as they were, so the row keeps its length and its cards
// their places. A row of twenty keeps eight or ten in the page.
import { computed, View, windowSize } from "nsh";
import { u } from "../theme";
import type { ScrollCtl } from "./scrollCtl";

/** Cards kept before the first in view and after the last. */
const BEHIND = 2;
const AHEAD = 3;

export interface RowWindow {
  /** The first card mounted and the one after the last. */
  from: number;
  to: number;
}

/** `step`: a card's width plus the gap, points. */
export function rowWindow(o: { line: ScrollCtl; focusedAt: () => number | null; step: () => number }) {
  return computed<RowWindow>(() => {
    const step = Math.max(1, o.step());
    const first = Math.floor((o.line.offset() ?? 0) / step);
    const shown = Math.ceil(windowSize().width / step) + 1;
    const focus = o.focusedAt();
    const lo = focus == null ? first : Math.min(focus, first);
    const hi = focus == null ? first + shown : Math.max(focus + shown, first + shown);
    return { from: Math.max(0, lo - BEHIND), to: hi + AHEAD };
  }, { equals: (a, b) => a.from === b.from && a.to === b.to });
}

/** The blank for the cards before the window (`gap`: the row's gap, TV pixels). */
export function RowGap(props: { window: () => RowWindow; step: () => number; gap: number }) {
  return (
    <If when={props.window().from > 0}>
      <View style={{ width: props.window().from * props.step() - u(props.gap) }} />
    </If>
  );
}
