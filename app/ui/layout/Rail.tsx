// A row that scrolls sideways (cards, people, seasons, filters): its first item at the page's
// inset and its last one ending there, room for the focus ring above and below, and what
// passes under the inset fading out at the screen's edges. The fades sit in the inset, so
// at either end nothing is under them: they need no state.
import { View, type JSX, type ViewStyle } from "nsh";
import { alpha, colors, ringRoom, safe, u } from "../theme";
import { Scroller, type ScrollCtl } from "./Scroller";

const rowStyle = (gap: number, top: number, bottom: number): ViewStyle => ({
  flexDirection: "row",
  gap: u(gap),
  paddingHorizontal: safe().x,
  paddingTop: Math.max(u(top), ringRoom()),
  paddingBottom: Math.max(u(bottom), ringRoom()),
});
/** A fade at one edge, as wide as the inset (at most 40 points). */
const fadeStyle = (side: "left" | "right"): ViewStyle => ({
  position: "absolute",
  top: 0,
  bottom: 0,
  [side]: 0,
  width: Math.min(safe().x, 40),
  pointerEvents: "none",
  backgroundImage: `linear-gradient(${side === "left" ? 90 : 270}deg, ${colors.ink()} 0%, ${alpha(colors.ink(), 0)} 100%)`,
});

/** `gap` between items and the room above and below them (`top`, `bottom`), TV pixels. */
export function Rail(props: { ctl: ScrollCtl; gap: number; top?: number; bottom?: number; children: JSX.Element }) {
  return (
    <View>
      <Scroller ctl={props.ctl}>
        <View style={rowStyle(props.gap, props.top ?? 0, props.bottom ?? 0)}>{props.children}</View>
      </Scroller>
      <View style={fadeStyle("left")} />
      <View style={fadeStyle("right")} />
    </View>
  );
}
