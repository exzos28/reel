// A page's frame: everything around a screen's content on every family, so a screen renders
// only its content. It owns:
// - what sits over the page (`metrics`): a TV's nav (root pages, scrolling away), a phone's
//   head (root pages, scrolling away), its Back head (deep pages, fixed), its discs over a
//   title's hero; a desktop's window bar and the tablet's top row are the app's, over all
//   pages, and turn solid by this page's scroll (`frameSolid`, the page on top only);
// - the page's title, at the same place on every page of a family;
// - a title's header action (Add to list): a TV's top-right, a phone's disc across from Back
//   (a desktop and a tablet carry it in their bars);
// - the room under the content (the system's area, the tab bar, a TV's tail);
// - on touch, a scrim under the status bar, solid once content is under it.
import { effect, safeArea, Text, View, windowSize, type JSX, type TextStyle, type ViewRef, type ViewStyle } from "nsh";
import { pageTitle } from "../kit/text";
import { go, section, toTop } from "../nav";
import { caps } from "../platform";
import { alpha, colors, safe, u } from "../theme";
import { frame } from "./chrome";
import { frameSolid, onTop } from "./frameState";
import { heroBoxNow, metrics, type PageKind } from "./metrics";
import { NavBar } from "./NavBar";
import { NAV } from "./navItems";
import { navFocus } from "./navState";
import { Scroller, type ScrollCtl } from "./Scroller";
import { PhoneBackHead, PhoneHead, PhoneTitleBack, phoneDisc } from "./TouchNav";

const screenStyle = (): ViewStyle => ({ flex: 1, backgroundColor: colors.ink() });
/** On a TV, room under the content so its last rows still rise to the focus line (a third
 * down the screen): what is left of the screen under the line, less a row's height. */
const tvTail = () => (caps.remote ? Math.max(0, (windowSize().height * 2) / 3 - u(TV_ROW)) : 0);
/** A typical row on a TV (a shelf's title and its cards), TV pixels. */
const TV_ROW = 340;
/** A TV's nav sits over the top of the content (the Home hero runs under it) and scrolls
 * away with it. */
const navStyle: ViewStyle = { position: "absolute", top: 0, left: 0, right: 0, zIndex: 3 };
const titleStyle = (gap: number): TextStyle => ({ ...pageTitle(), paddingHorizontal: safe().x, marginTop: gap });
/** A title's header action: a phone's disc across from Back; a TV's at the title-safe corner. */
const actionStyle = (): ViewStyle =>
  frame.nav === "tab-bar" ? phoneDisc("right") : { position: "absolute", top: safe().y, right: safe().x, zIndex: 3 };
/** The status bar's scrim: a fade over a hero, solid once content is under it. */
const scrimStyle = (solid: boolean): ViewStyle => ({
  position: "absolute",
  top: 0,
  left: 0,
  right: 0,
  height: safeArea().top,
  zIndex: 9,
  pointerEvents: "none",
  ...(solid
    ? { backgroundColor: alpha(colors.ink(), 0.96) }
    : { backgroundImage: `linear-gradient(180deg, ${alpha(colors.ink(), 0.7)} 0%, ${alpha(colors.ink(), 0)} 100%)` }),
});

export function PageFrame(props: {
  ctl: ScrollCtl;
  kind: PageKind;
  /** The page's title, where the frame puts titles. */
  title?: () => string;
  /** The ref of the page's top (the room for what is over it, and the title): a block the
   * page brings back to the top. */
  topRef?: (r: ViewRef) => void;
  /** The page opens with a hero this tall (TV pixels) running under what is over it. */
  hero?: number;
  /** A title's header action (Add to list). */
  action?: JSX.Element;
  /** More room under the content, TV pixels. */
  bottom?: number;
  children: JSX.Element;
}) {
  const m = () => metrics(props.kind);
  const root = props.kind === "root";
  const top = onTop();
  // The bars over the page turn solid once content is under them: past the top, or past the
  // hero on a page that opens with one. Only the page on top says so.
  effect(() => {
    if (!top()) return;
    const under = props.hero == null ? 0 : heroBoxNow(props.hero).height - m().headBottom;
    frameSolid.set((props.ctl.offset() ?? 0) > under);
  });
  // The destination chosen again in the nav: its page goes back to the top.
  let seen = toTop();
  effect(() => {
    if (toTop() === seen) return;
    seen = toTop();
    props.ctl.scroll()?.scrollTo({ y: 0, animated: true });
  });
  return (
    <View style={{ flex: 1 }}>
      <Scroller ctl={props.ctl} style={screenStyle()}>
        <View style={{ paddingBottom: m().bottomRoom + u(props.bottom ?? 0) + tvTail() }}>
          {/* What is over the page takes its room (a hero runs under it instead). */}
          <View ref={props.topRef}>
            <If when={props.hero == null}>
              <View style={{ height: m().headBottom }} />
            </If>
            <If when={props.title}>
              <Text style={titleStyle(m().titleTop - m().headBottom)}>{props.title!()}</Text>
            </If>
          </View>
          {props.children}
          <If when={root && frame.nav === "tab-bar"}>
            <PhoneHead />
          </If>
          <If when={root && frame.nav === "page"}>
            <View style={navStyle}>
              <NavBar current={section} focused={() => navFocus().at()} onPick={(i) => go(NAV[i].id)} />
            </View>
          </If>
          <If when={props.kind === "title" && frame.nav === "tab-bar"}>
            <PhoneTitleBack />
          </If>
          <If when={props.action && frame.listInPage}>
            <View style={actionStyle()}>{props.action}</View>
          </If>
        </View>
      </Scroller>
      <If when={props.kind === "deep" && frame.nav === "tab-bar"}>
        <PhoneBackHead />
      </If>
      <If when={caps.touch}>
        <View style={scrimStyle(frameSolid())} />
      </If>
    </View>
  );
}
