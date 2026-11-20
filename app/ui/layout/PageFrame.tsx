// A page's frame: everything around a screen's content on every family, so a screen renders
// only its content. It owns:
// - what sits over the page (`metrics`): a TV's nav (root pages, scrolling away), a phone's
//   head (root pages, scrolling away), its Back head (deep pages, fixed), its discs over a
//   title's hero; a desktop's window bar and the tablet's top row are the app's, over all
//   pages, and turn solid by this page's scroll (`frameSolid`, the page on top only);
// - the page's title, at the same place on every page of a family;
// - a title's header action (Add to list): a TV's top-right, a phone's disc across from Back,
//   in the bar a scrolled title turns into (a desktop and a tablet carry it in their bars);
// - the room under the content (the system's area, the tab bar, a TV's tail);
// - on touch, a scrim under the status bar: over a hero a fade, solid once content is under it;
//   solid from the start on a page without one;
// - a phone's pinned foot (the setup's main button): under the scrolling content, above the home
//   indicator, within the thumb's reach (`footPinned`; elsewhere the screen keeps it inline).
import { computed, effect, safeArea, Text, View, windowSize, type JSX, type TextStyle, type ViewRef, type ViewStyle } from "nsh";
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
import { PhoneBackHead, PhoneHead, PhoneTitleBar } from "./TouchNav";

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
/** A TV title's header action, at the title-safe corner (a phone's is in its title bar). */
const actionStyle = (): ViewStyle => ({ position: "absolute", top: safe().y, right: safe().x, zIndex: 3 });
/** A phone's title: the bar over it, not the content's (it stays as the page scrolls). */
const phoneTitle = frame.nav === "tab-bar";
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

/** Whether a page's `foot` is pinned under its content (a phone); elsewhere the frame does not
 * show it and the screen lays its actions out inline. */
export const footPinned = () => frame.nav === "tab-bar";
const footStyle = (): ViewStyle => ({
  paddingHorizontal: safe().x,
  paddingTop: u(20),
  paddingBottom: safeArea().bottom + u(20),
  backgroundColor: colors.ink(),
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
  /** A title's header action (Add to list); `plain`: it stands in a bar, not over a hero (a
   * phone's scrolled title), so it drops its disc's fill. */
  action?: (plain: () => boolean) => JSX.Element;
  /** The name a phone's bar shows once the page has scrolled past its hero (a title's). */
  barTitle?: () => string;
  /** More room under the content, TV pixels. */
  bottom?: number;
  /** The page's main action, pinned under the content where `footPinned()`. */
  foot?: JSX.Element;
  /** Whether this page is the one on top, where several are mounted outside the app's stack
   * (the setup's steps); the stack's route says it otherwise. */
  top?: () => boolean;
  children: JSX.Element;
}) {
  const m = () => metrics(props.kind);
  const root = props.kind === "root";
  const pinned = () => !!props.foot && footPinned();
  const top = props.top ?? onTop();
  // The bars over the page turn solid once content is under them: past the top, or past the
  // hero's still on a page that opens with one (its text runs on under it, over the ink). This
  // page's own (its bar and scrim: a page kept under the top one keeps its own state); the app's
  // bars (a desktop's window bar, the tablet's top row) hear the page on top.
  const solid = computed(() => {
    const under = props.hero == null ? 0 : heroBoxNow(props.hero).height - m().headBottom;
    return (props.ctl.offset() ?? 0) > under;
  });
  effect(() => {
    if (top()) frameSolid.set(solid());
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
      {/* First in the tree so a screen reader reaches Back first; it is drawn over the page. */}
      <If when={props.kind === "title" && phoneTitle}>
        <PhoneTitleBar
          testID={top() ? (solid() ? "title-bar" : "title-discs") : undefined}
          solid={solid}
          title={props.barTitle}
          action={props.action?.(solid)}
        />
      </If>
      <Scroller ctl={props.ctl} style={screenStyle()}>
        <View style={{ paddingBottom: (pinned() ? u(24) : m().bottomRoom) + u(props.bottom ?? 0) + tvTail() }}>
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
          <If when={props.action && frame.listInPage && !phoneTitle}>
            <View style={actionStyle()}>{props.action!(() => false)}</View>
          </If>
        </View>
      </Scroller>
      <If when={pinned()}>
        <View testID="page-foot" style={footStyle()}>
          {props.foot}
        </View>
      </If>
      <If when={props.kind === "deep" && frame.nav === "tab-bar"}>
        <PhoneBackHead />
      </If>
      <If when={caps.touch}>
        <View testID={top() ? (props.hero == null || solid() ? "status-scrim-solid" : "status-scrim") : undefined} style={scrimStyle(props.hero == null || solid())} />
      </If>
    </View>
  );
}
