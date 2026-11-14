import { View, type JSX, type ViewStyle } from "nsh";
import { ringRoom, safe, u } from "../theme";
import { Scroller, type ScrollCtl } from "./Scroller";

/** The row inside the safe area, with room for the focus ring above and
 * below (at least `top` and `bottom` TV pixels). */
const shelfRow = (gap: number, top: number, bottom: number): ViewStyle => ({
  flexDirection: "row",
  gap: u(gap),
  paddingHorizontal: safe().x,
  paddingTop: Math.max(u(top), ringRoom()),
  paddingBottom: Math.max(u(bottom), ringRoom()),
});

/** A horizontal row of cards that scrolls as `ctl` follows the focus. */
export function Shelf(props: { ctl: ScrollCtl; gap: number; top: number; bottom: number; children: JSX.Element }) {
  return (
    <Scroller ctl={props.ctl}>
      <View style={shelfRow(props.gap, props.top, props.bottom)}>{props.children}</View>
    </Scroller>
  );
}
