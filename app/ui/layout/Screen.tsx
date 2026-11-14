import { effect, View, windowSize, type JSX, type ViewStyle } from "nsh";
import { go, section, toTop } from "../nav";
import { caps } from "../platform";
import { colors, safe, u } from "../theme";
import { frame } from "./chrome";
import { PhoneHead, tabBarHeight } from "./TouchNav";
import { NavBar } from "./NavBar";
import { NAV } from "./navItems";
import { navFocus } from "./navState";
import { Scroller, type ScrollCtl } from "./Scroller";
import { BAR_HEIGHT, barSolid } from "./WindowBar";

const screenStyle = (): ViewStyle => ({ flex: 1, backgroundColor: colors.ink() });
/** On a TV, room under the content so its last rows still rise to the focus line (a third
 * down the screen): what is left of the screen under the line, less a row's height. */
const tvTail = () => (caps.remote ? Math.max(0, (windowSize().height * 2) / 3 - u(TV_ROW)) : 0);
/** A typical row on a TV (a shelf's title and its cards), TV pixels. */
const TV_ROW = 340;
/** The nav sits over the top of the content (the Home hero runs under it) and
 * scrolls away with it. */
const navStyle: ViewStyle = { position: "absolute", top: 0, left: 0, right: 0, zIndex: 3 };

/** A screen that scrolls as `ctl` follows the focus; `bottom` adds room under
 * its content (TV pixels) to the safe area's. A top-level screen (`nav`) has
 * the nav at the top of its content (a TV's and touch's for now): the same
 * component at the same place on every one of them, scrolling with the page.
 * A desktop's nav is the window bar, solid once content is under it: past
 * the top, or past the hero (`hero`, its height in TV pixels) on a page
 * that opens with one. */
export function Screen(props: { ctl: ScrollCtl; bottom?: number; nav?: boolean; hero?: number; children: JSX.Element }) {
  if (frame.nav === "window-bar" || frame.nav === "top-row") {
    const ctl = props.ctl;
    effect(() => {
      const hero = props.hero;
      const under = hero == null ? 0 : u(hero) - BAR_HEIGHT;
      // (The tablet's top row turns solid the same way.)
      barSolid.set((ctl.offset() ?? 0) > under);
    });
  }
  // The destination chosen again in the nav: its page goes back to the top.
  let seen = toTop();
  effect(() => {
    if (toTop() === seen) return;
    seen = toTop();
    props.ctl.scroll()?.scrollTo({ y: 0, animated: true });
  });
  return (
    <Scroller ctl={props.ctl} style={screenStyle()}>
      <View style={{ paddingBottom: safe().y + u(props.bottom ?? 0) + tvTail() + (frame.nav === "tab-bar" ? tabBarHeight() : 0) }}>
        {props.children}
        <If when={props.nav && frame.nav === "tab-bar"}>
          <PhoneHead />
        </If>
        <If when={props.nav && frame.nav === "page"}>
          <View style={navStyle}>
            <NavBar
              current={section}
              focused={() => navFocus().at()}
              onPick={(i) => go(NAV[i].id)}
            />
          </View>
        </If>
      </View>
    </Scroller>
  );
}
