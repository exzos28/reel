// The desktop's window bar (design/navigation.md, "Desktop"): one 52 pt row
// over every page, outside the scroll view. Left to right: the window's own
// controls' room (macOS's traffic lights), Back, the logo, the page's action
// (a title's Add to list), the nav pills, search and settings, the room of
// the system's caption buttons (Windows, GNOME). Its empty parts drag the
// window. Clear over a hero, solid once content is under it.
import { Text, View, type JSX, type TextStyle, type ViewStyle } from "nsh";
import { titleBar } from "nsh/desktop";
import { t } from "nsh/i18n";
import { title as titleOf, titleText, toggleList } from "../catalog";
import backIcon from "../icons/back.svg";
import { Icon } from "../kit/Icon";
import { rounded, row } from "../kit/shape";
import { canGoBack, go, handleBack, route, section, stack, type Destination, type Route } from "../nav";
import { alpha, colors, font, iconPt, u } from "../theme";
import { chrome } from "./chrome";
import { frameSolid as barSolid } from "./frameState";
import { BAR_HEIGHT } from "./metrics";
import { ListToggle } from "./ListToggle";
import { NAV } from "./navItems";
import { setupDone } from "../preferences";

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
  opacity: enabled ? 1 : 0.32,
});
const tipStyle = (): ViewStyle => ({ ...row(6), paddingHorizontal: 9, paddingVertical: 5, ...rounded(6), backgroundColor: colors.raise() });
const tipText = (color: string): TextStyle => ({ fontFamily: font, fontSize: 12, fontWeight: 500, color });
const logoStyle = (): TextStyle => ({ fontFamily: font, fontSize: 20, fontWeight: 700, letterSpacing: -0.3, color: colors.red() });
const groupStyle = (solid: boolean): ViewStyle => ({
  ...row(2, "stretch"),
  padding: 3,
  ...rounded(10),
  backgroundColor: solid ? colors.card() : alpha(colors.card(), 0.82),
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
  backgroundColor: selected ? colors.nav() : solid ? colors.card() : alpha(colors.card(), 0.82),
});
/** Points as TV pixels, for `Icon`'s size. */
const pt = iconPt;

/** Back in the bar's slot: the page it goes to and the shortcut as a tooltip.
 * Disabled on a root on a Mac (it keeps its slot); none there elsewhere. */
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
      hoverStyle={{ backgroundColor: colors.raise() }}
      style={backStyle(props.enabled(), props.background)}
    >
      <Icon src={() => backIcon} size={pt(back().icon)} />
    </View>
  );
}

const pills = NAV.filter((n) => n.pill);
const buttons = NAV.filter((n) => !n.pill);

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
            <Text style={pillText(selected(n().id))}>{t(`nav.${n().id}`)}</Text>
          </View>
        )}
      </Each>
    </View>
  );
}

/** A title's Add to list, before the nav. */
function PageAction() {
  const shown = () => {
    const r = route();
    if (r.name !== "title") return null;
    const s = titleOf(r.id);
    return s ? { id: r.id, inList: s.inList } : null;
  };
  return (
    <If when={shown()}>
      {(s) => (
        <View style={{ marginRight: 10 }}>
          <ListToggle inList={() => s().inList} focused={() => false} onPress={() => toggleList(s().id)} />
        </View>
      )}
    </If>
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
      <View desktop={{ windowDrag: true }} style={{ width: backLeft(), alignSelf: "stretch" }} />
      <If when={showBack()}>
        <BarBack onPress={handleBack} enabled={canGoBack} tip={tip} />
      </If>
      <View desktop={{ windowDrag: true }} style={{ ...row(0), flex: 1, alignSelf: "stretch", paddingLeft: showBack() ? (chrome === "mac" ? 12 : 14) : 8 }}>
        <Text style={logoStyle()}>{t("app.name")}</Text>
      </View>
      <PageAction />
      <View style={row(6)}>
        <Pills solid={barSolid} />
        <Each of={buttons} key={(n) => n.id}>
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
      </View>
      <View desktop={{ windowDrag: true }} style={{ width: titleBar().right + (chrome === "mac" ? 16 : 10), alignSelf: "stretch" }} />
    </View>
    </If>
  );
}
