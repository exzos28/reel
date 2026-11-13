import { View, type JSX, type ViewStyle } from "nsh";
import { colors, safe, u } from "../theme";
import { Scroller, type ScrollCtl } from "./Scroller";

const screenStyle = (): ViewStyle => ({ flex: 1, backgroundColor: colors.ink() });

/** A screen that scrolls as `ctl` follows the focus; `bottom` adds room
 * under its content (TV pixels) to the safe area's. */
export function Screen(props: { ctl: ScrollCtl; bottom?: number; children: JSX.Element }) {
  return (
    <Scroller ctl={props.ctl} style={screenStyle()}>
      <View style={{ paddingBottom: safe().y + u(props.bottom ?? 0) }}>{props.children}</View>
    </Scroller>
  );
}
