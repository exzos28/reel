// The desktop's window bar (design/navigation.md, "Desktop"): one 52 pt row
// over every page, outside the scroll view. Left to right: the window's own
// controls' room (macOS's traffic lights), Back, the logo on a blurred pill, the nav (Search,
// the pills and Settings, one group, on the same backing), and the room of the system's caption
// buttons (Windows, GNOME). Its empty parts drag the window. Clear over a hero, solid once
// content is under it. The nav sits where Settings says: at the right edge (the default), right
// after the logo, or in the middle of the window.
import { Text, View, windowSize, type JSX, type TextStyle, type ViewStyle } from "nsh";
import { titleBar } from "nsh/desktop";
import { t } from "nsh/i18n";
import { title as titleOf, titleText } from "../catalog";
import backIcon from "../icons/back.svg";
import { Icon } from "../kit/Icon";
import { rounded, row } from "../kit/shape";
import { canGoBack, go, handleBack, route, section, stack, type Destination, type Route } from "../nav";
import { alpha, colors, font, iconPt, u } from "../theme";
import { chrome } from "./chrome";
import { frameSolid as barSolid } from "./frameState";
import { BAR_HEIGHT } from "./metrics";
import { NAV } from "./navItems";
import { navPosition, setupDone } from "../preferences";

/** The bar's height, points (`metrics`); the system's window controls are centred in it. */
export { BAR_HEIGHT };

/** Back's box per system, points: size, corner, where it starts, its fill. */
const BACK = {
  mac: { width: 32, height: 28, radius: 7, icon: 17, fill: "transparent" },
  windows: { width: 40, height: 36, radius: 6, icon: 16, fill: "transparent" },
  linux: { width: 34, height: 34, radius: 8, icon: 16, fill: "#FFFFFF14" },
} as const;
type DesktopChrome = keyof typeof BACK;
const back = () => BACK[chrome as DesktopChrome];

/** Where Back's slot starts from the window's left edge, points: after the
 * traffic lights on a Mac, at the left edge elsewhere. */
export const backLeft = () => (chrome === "mac" ? titleBar().left + 18 : chrome === "windows" ? 6 : 8);

/** Back's box in the window, points: in the bar's slot, or at (20, 12) when
 * the window fills the screen (the player's). */
export function barBackBox(fullScreen = false) {
  const b = back();
  return fullScreen
    ? { top: 12, left: 20, width: b.width }
    : { top: (BAR_HEIGHT - b.height) / 2, left: backLeft(), width: b.width };
}

/** The keystroke Back shows in its tooltip. */
const BACK_KEY = chrome === "mac" ? "⌘[" : "Alt+←";

/** Back's tooltip: "Back to" the page under this one, plain "Back" while a
 * title under it is not loaded. */
function backTip(r: Route): string {
  if (r.name === "title") {
    const s = titleOf(r.id);
    return s ? t("nav.back_to", { page: titleText(s) }) : t("nav.back");
  }
  return t("nav.back_to", { page: r.name === "about" ? t("settings.about.title") : t(`nav.${r.name}`) });
}

const barStyle = (solid: boolean): ViewStyle => ({
  ...row(0),
  position: "absolute",
  top: 0,
  left: 0,
  right: 0,
  height: BAR_HEIGHT,
  zIndex: 10,
  backgroundColor: solid ? alpha(colors.ink(), 0.96) : "transparent",
  boxShadow: solid ? "inset 0 -1px 0 #FFFFFF14" : "none",
});
const backStyle = (enabled: boolean, background?: string): ViewStyle => ({
  width: back().width,
  height: back().height,
  ...rounded(back().radius),
  alignItems: "center",
  justifyContent: "center",
  backgroundColor: background ?? back().fill,
  // Nowhere to go back to: not shown, but its slot stays (the logo does not move).
  opacity: enabled ? 1 : 0,
});
/** The logo's strip (it drags the window): it takes the rest of the left part, or with the nav
 * right after it keeps a gap before the nav. */
const logoRoom = (afterBack: boolean, grow: boolean): ViewStyle => ({
  ...row(0),
  alignSelf: "stretch",
  paddingLeft: afterBack ? (chrome === "mac" ? 12 : 14) : 8,
  ...(grow ? { flex: 1 } : { paddingRight: 20 }),
});
const tipStyle = (): ViewStyle => ({ ...row(6), paddingHorizontal: 9, paddingVertical: 5, ...rounded(6), backgroundColor: colors.raise() });
const tipText = (color: string): TextStyle => ({ fontFamily: font, fontSize: 12, fontWeight: 500, color });
/** The logo's dark, blurred backing, as the nav's: the red stays readable over any still. */
const logoPill = (solid: boolean): ViewStyle => ({ paddingHorizontal: 11, paddingVertical: 4, ...rounded(999), ...glass(solid) });
const logoStyle = (): TextStyle => ({ fontFamily: font, fontSize: 20, fontWeight: 700, letterSpacing: -0.3, color: colors.red() });
/** What the bar's controls float on: a translucent fill and a blur of what scrolls under them. */
const glass = (solid: boolean): ViewStyle => ({
  backgroundColor: solid ? alpha(colors.card(), 0.9) : alpha(colors.card(), 0.62),
  backdropFilter: "blur(18px)",
});
const groupStyle = (solid: boolean): ViewStyle => ({
  ...row(2, "stretch"),
  padding: 3,
  ...rounded(10),
  ...glass(solid),
});
const pillStyle = (selected: boolean): ViewStyle => ({
  ...row(6),
  height: 28,
  paddingHorizontal: 12,
  ...rounded(7),
  backgroundColor: selected ? colors.nav() : "transparent",
});
const pillText = (selected: boolean): TextStyle => ({ fontFamily: font, fontSize: 13, fontWeight: 500, color: selected ? colors.snow() : colors.dim() });
const roundStyle = (selected: boolean, solid: boolean): ViewStyle => ({
  width: 34,
  height: 34,
  ...rounded(999),
  alignItems: "center",
  justifyContent: "center",
  ...glass(solid),
  ...(selected ? { backgroundColor: colors.nav() } : {}),
});
/** Points as TV pixels, for `Icon`'s size. */
const pt = iconPt;
/** The bar's left part (the system's room, Back, the logo) and its right part (the system's
 * room): with the nav in the middle both take half of what is left, so it is centred in the
 * window; elsewhere the one away from the nav takes it all. */
const sideStyle = (grow: boolean): ViewStyle => ({ ...row(0), alignSelf: "stretch", ...(grow ? { flex: 1 } : {}) });

/** Back in the bar's slot: the page it goes to and the shortcut as a tooltip.
 * Hidden on a root on a Mac (it keeps its slot, so the logo stays put); none there elsewhere. */
export function BarBack(props: { onPress: () => void; enabled: () => boolean; tip: () => string; background?: string }) {
  const tip = (): JSX.Element => (
    <View style={tipStyle()}>
      <Text style={tipText(colors.snow())}>{props.tip()}</Text>
      <Text style={tipText(colors.ash())}>{BACK_KEY}</Text>
    </View>
  );
  return (
    <View
      role="button"
      accessibilityLabel={props.tip()}
      disabled={!props.enabled()}
      tooltip={props.enabled() ? tip() : undefined}
      onPress={props.onPress}
      hoverStyle={props.enabled() ? { backgroundColor: colors.raise() } : undefined}
      style={backStyle(props.enabled(), props.background)}
    >
      <Icon src={() => backIcon} size={pt(back().icon)} />
    </View>
  );
}

const pills = NAV.filter((n) => n.pill);
/** The round buttons either side of the pills: Search before Home, Settings after Anime. */
const searchButton = NAV.filter((n) => n.id === "search");
const settingsButton = NAV.filter((n) => n.id === "settings");

/** A window narrower than this shows the pills as icons alone, so the bar fits down to the window's least width. */
const ICONS_ONLY_BELOW = 900;
const iconsOnly = () => windowSize().width < ICONS_ONLY_BELOW;
/** The nav in the middle with its pills as icons (Search, five pills, Settings), and what the logo
 * takes beside Back (its pill, the gap before it and some air before the nav), points. */
const ICONS_NAV_WIDTH = 300;
const LOGO_ROOM = 96;
/** The logo stays while the bar's left part, beside Back, has room for it: only a nav in the middle
 * can leave it none, in the narrowest windows (and on a Mac, whose traffic lights take part of that side). */
const logoFits = () =>
  navPosition() !== "center" || !iconsOnly() || (windowSize().width - ICONS_NAV_WIDTH) / 2 >= backLeft() + back().width + LOGO_ROOM;

function Pills(props: { solid: () => boolean }) {
  const selected = (id: Destination) => section() === id;
  return (
    <View style={groupStyle(props.solid())}>
      <Each of={pills} key={(n) => n.id}>
        {(n) => (
          <View
            role="button"
            accessibilityLabel={t(`nav.${n().id}`)}
            onPress={() => go(n().id)}
            hoverStyle={{ backgroundColor: colors.raise() }}
            style={pillStyle(selected(n().id))}
          >
            <Icon src={() => n().icon} size={pt(15)} color={() => (selected(n().id) ? colors.snow() : colors.dim())} />
            <If when={!iconsOnly()}>
              <Text style={pillText(selected(n().id))}>{t(`nav.${n().id}`)}</Text>
            </If>
          </View>
        )}
      </Each>
    </View>
  );
}

/** One of the bar's round buttons (Search, Settings). */
function RoundButtons(props: { items: typeof NAV }) {
  return (
    <Each of={props.items} key={(n) => n.id}>
      {(n) => (
        <View
          role="button"
          accessibilityLabel={t(`nav.${n().id}`)}
          onPress={() => go(n().id)}
          hoverStyle={{ backgroundColor: colors.raise() }}
          style={roundStyle(section() === n().id, barSolid())}
        >
          <Icon src={() => n().icon} size={pt(15)} color={() => (section() === n().id ? colors.snow() : colors.dim())} />
        </View>
      )}
    </Each>
  );
}

export function WindowBar() {
  const tip = () => {
    const s = stack();
    return s.length > 1 ? backTip(s[s.length - 2]) : t("nav.back");
  };
  /** A Mac keeps Back's slot on a root, disabled; elsewhere it is only on deeper pages. */
  const showBack = () => chrome === "mac" || canGoBack();
  /** The first-run setup has the window to itself: no Back, logo, tabs or buttons to leave it by
   * (the setup shows its own logo). */
  const inSetup = () => setupDone() === false;
  return (
    <If when={!inSetup()} else={<View desktop={{ windowDrag: true }} style={barStyle(false)} />}>
    <View style={barStyle(barSolid())}>
      {/* The sides: with the nav in the middle both take half of what is left, so it is centred in
          the window; elsewhere the one away from the nav takes it all. */}
      <View style={sideStyle(navPosition() !== "left")}>
        <View desktop={{ windowDrag: true }} style={{ width: backLeft(), alignSelf: "stretch" }} />
        <If when={showBack()}>
          <BarBack onPress={handleBack} enabled={canGoBack} tip={tip} />
        </If>
        <View desktop={{ windowDrag: true }} style={logoRoom(showBack(), navPosition() !== "left")}>
          <If when={logoFits()}>
            <View style={logoPill(barSolid())}>
              <Text style={logoStyle()}>{t("app.name")}</Text>
            </View>
          </If>
        </View>
      </View>
      <View testID={`window-nav-${navPosition()}`} style={row(6)}>
        <RoundButtons items={searchButton} />
        <Pills solid={barSolid} />
        <RoundButtons items={settingsButton} />
      </View>
      <View style={sideStyle(navPosition() !== "right")}>
        <View desktop={{ windowDrag: true }} style={{ flex: 1, alignSelf: "stretch" }} />
        <View desktop={{ windowDrag: true }} style={{ width: titleBar().right + (chrome === "mac" ? 16 : 10), alignSelf: "stretch" }} />
      </View>
    </View>
    </If>
  );
}
