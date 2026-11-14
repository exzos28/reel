import { View, type JSX, type ScrollEvent, type ViewStyle } from "nsh";
import { colors, safe, u } from "../theme";
import { navCovered } from "./navState";
import { Scroller, type ScrollCtl } from "./Scroller";

const screenStyle = (): ViewStyle => ({ flex: 1, backgroundColor: colors.ink() });

/** A screen that scrolls as `ctl` follows the focus; `bottom` adds room
 * under its content (TV pixels) to the safe area's. Under the shared nav,
 * `navClear` says how far it scrolls (TV pixels) before content runs under
 * the nav. */
export function Screen(props: { ctl: ScrollCtl; bottom?: number; navClear?: number; children: JSX.Element }) {
  const onScroll = (e: ScrollEvent) => {
    if (props.navClear != null) navCovered.set(e.offset.y > u(props.navClear));
  };
  return (
    <Scroller ctl={props.ctl} style={screenStyle()} onScroll={onScroll}>
      <View style={{ paddingBottom: safe().y + u(props.bottom ?? 0) }}>{props.children}</View>
    </Scroller>
  );
}
