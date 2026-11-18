// A row that scrolls sideways (cards, people, seasons, filters): its first item at the page's
// inset and its last one ending there, room for the focus ring above and below, and what
// passes under the inset fading out at the row's edges. The fades sit in the inset, so
// at either end nothing is under them: they need no state. On a wide desktop window the row
// is the content column's, and a little more (`railLead`): the next card peeks out beside it.
import { View, type JSX, type ViewStyle } from "nsh";
import { alpha, colors, ringRoom, safe, u } from "../theme";
import { centering } from "./chrome";
import { Scroller, type ScrollCtl } from "./Scroller";

/** How far past the content column a wide desktop window shows a row, points. */
const PEEK = 64;

/** Where a row's first item stands from the row's own left edge, points: the page's inset, or
 * on a wide desktop window (the row clipped to the content column) the peek beside the column.
 * The anchor rows put their focused item at. */
export const railLead = () => {
  const inset = safe().x;
  // Off a wide desktop window `centering` is 0 and the lead is the inset.
  return Math.min(inset, Math.max(inset - centering(), PEEK));
};
/** What a row leaves out on either side of a wide desktop window, points (0 elsewhere). */
const railMargin = () => safe().x - railLead();

const outerStyle = (): ViewStyle => ({ marginHorizontal: railMargin() });
const rowStyle = (gap: number, top: number, bottom: number): ViewStyle => ({
  flexDirection: "row",
  gap: u(gap),
  paddingHorizontal: railLead(),
  paddingTop: Math.max(u(top), ringRoom()),
  paddingBottom: Math.max(u(bottom), ringRoom()),
});
/** A fade at one edge, as wide as the lead (at most 40 points). */
const fadeStyle = (side: "left" | "right"): ViewStyle => ({
  position: "absolute",
  top: 0,
  bottom: 0,
  [side]: 0,
  width: Math.min(railLead(), 40),
  pointerEvents: "none",
  backgroundImage: `linear-gradient(${side === "left" ? 90 : 270}deg, ${colors.ink()} 0%, ${alpha(colors.ink(), 0)} 100%)`,
});

/** `gap` between items and the room above and below them (`top`, `bottom`), TV pixels. */
export function Rail(props: { ctl: ScrollCtl; gap: number; top?: number; bottom?: number; children: JSX.Element }) {
  return (
    <View style={outerStyle()}>
      <Scroller ctl={props.ctl}>
        <View style={rowStyle(props.gap, props.top ?? 0, props.bottom ?? 0)}>{props.children}</View>
      </Scroller>
      <View style={fadeStyle("left")} />
      <View style={fadeStyle("right")} />
    </View>
  );
}
