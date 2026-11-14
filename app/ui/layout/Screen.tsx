import { View, type JSX, type ViewStyle } from "nsh";
import { go, route, type Destination } from "../nav";
import { colors, safe, u } from "../theme";
import { NavBar } from "./NavBar";
import { NAV } from "./navItems";
import { navFocus } from "./navState";
import { Scroller, type ScrollCtl } from "./Scroller";

const screenStyle = (): ViewStyle => ({ flex: 1, backgroundColor: colors.ink() });
/** The nav sits over the top of the content (the Home hero runs under it) and
 * scrolls away with it. */
const navStyle: ViewStyle = { position: "absolute", top: 0, left: 0, right: 0, zIndex: 3 };

/** A screen that scrolls as `ctl` follows the focus; `bottom` adds room under
 * its content (TV pixels) to the safe area's. A top-level screen (`nav`) has
 * the nav at the top of its content: the same component at the same place on
 * every one of them, scrolling with the page. */
export function Screen(props: { ctl: ScrollCtl; bottom?: number; nav?: boolean; children: JSX.Element }) {
  return (
    <Scroller ctl={props.ctl} style={screenStyle()}>
      <View style={{ paddingBottom: safe().y + u(props.bottom ?? 0) }}>
        {props.children}
        <If when={props.nav}>
          <View style={navStyle}>
            <NavBar
              current={() => route().name as Destination}
              focused={() => navFocus().at()}
              onPick={(i) => go(NAV[i].id)}
            />
          </View>
        </If>
      </View>
    </Scroller>
  );
}
