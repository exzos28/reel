// The nav on touch (design/navigation.md, "Tablet" and "Phone"). The tabs are
// Home, Movies, Shows, Anime and Search; Settings is a button that pushes it
// on the current tab. Phone: a bottom tab bar on every page but the player,
// and a head over a root page (logo, Settings) that scrolls away with it.
// Tablet: one top row on every page: the logo (Back in its place on a deeper
// page), the floating tabs centred, Add to list on a title, Settings; solid
// once content is under it.
import { safeArea, Scroll, Text, View, windowSize, type TextStyle, type ViewStyle } from "nsh";
import { t } from "nsh/i18n";
import { title as titleOf, titleText, toggleList } from "../catalog";
import backIcon from "../icons/back.svg";
import settingsIcon from "../icons/settings.svg";
import { Icon } from "../kit/Icon";
import { rounded, row } from "../kit/shape";
import { canGoBack, go, handleBack, openSettings, route, section, stack, type Route } from "../nav";
import { look } from "../platform/look";
import { alpha, colors, font, u } from "../theme";
import { ListToggle } from "./ListToggle";
import { NAV } from "./navItems";
import { barSolid } from "./WindowBar";

/** The tabs: the nav's destinations but Settings. */
const TABS = NAV.filter((n) => n.id !== "settings");
/** Android's Material bar, else iOS's. */
const android = look.system === "material";
/** Points as TV pixels, for `Icon`'s size. */
const pt = (points: number) => points / u(1);

/** The phone's tab bar, points: its row over the home indicator / gesture area. */
const TAB_ROW = android ? 80 : 49;
/** How tall the phone's tab bar is with the system's area under it. */
export const tabBarHeight = () => TAB_ROW + safeArea().bottom;
/** The tablet's top row under the status bar, points. */
export const TOP_ROW = 60;
export const topRowBottom = () => safeArea().top + TOP_ROW;

const isSettings = () => route().name === "settings" || route().name === "about";

const disc = (size: number, selected = false): ViewStyle => ({
  width: size,
  height: size,
  ...rounded(999),
  alignItems: "center",
  justifyContent: "center",
  backgroundColor: selected ? colors.nav() : alpha(colors.card(), 0.78),
});
const logoStyle = (): TextStyle => ({ fontFamily: font, fontSize: 22, fontWeight: 700, letterSpacing: -0.3, color: colors.red() });

function Logo() {
  return <Text style={logoStyle()}>{t("app.name")}</Text>;
}

/** Settings, a round button: it pushes Settings on the current tab. */
function SettingsButton(props: { size: number }) {
  return (
    <View role="button" accessibilityLabel={t("nav.settings")} onPress={openSettings} style={disc(props.size, isSettings())}>
      <Icon src={() => settingsIcon} size={pt(props.size * 0.47)} color={() => (isSettings() ? colors.snow() : colors.dim())} />
    </View>
  );
}

// ---- Phone ---------------------------------------------------------------

const tabBarStyle = (): ViewStyle => ({
  position: "absolute",
  left: 0,
  right: 0,
  bottom: 0,
  height: tabBarHeight(),
  paddingTop: android ? 12 : 6,
  backgroundColor: colors.ink(),
  borderTopWidth: 1,
  borderTopColor: colors.card(),
  zIndex: 10,
});
const tabStyle: ViewStyle = { width: 70, alignItems: "center", gap: android ? 4 : 3 };
/** The tabs in a row that scrolls sideways when they do not fit (six of 70 pt on a 412 pt
 * phone); when they fit, they spread over the width as before. */
const tabRowStyle = (): ViewStyle => ({
  flexDirection: "row",
  justifyContent: "space-around",
  alignItems: "flex-start",
  paddingHorizontal: 8,
  minWidth: windowSize().width,
});
const indicatorStyle = (on: boolean): ViewStyle => ({
  width: android ? 64 : 52,
  height: android ? 32 : 30,
  ...rounded(android ? 16 : 9),
  alignItems: "center",
  justifyContent: "center",
  backgroundColor: on ? colors.raise() : "transparent",
});
const tabText = (on: boolean): TextStyle => ({ fontFamily: font, fontSize: android ? 12 : 10.5, fontWeight: 500, color: on ? colors.snow() : colors.ash() });

/** The phone's bottom tab bar. Tapping the selected tab pops it to its root. */
export function PhoneTabBar() {
  return (
    <View testID="tab-bar" style={tabBarStyle()}>
      <Scroll horizontal scrollbar={false} bounces={false}>
      <View style={tabRowStyle()}>
      <Each of={TABS} key={(n) => n.id}>
        {(n) => {
          const on = () => section() === n().id;
          return (
            <View role="tab" accessibilityLabel={t(`nav.${n().id}`)} accessibilityState={{ selected: on() }} onPress={() => go(n().id)} style={tabStyle}>
              <View style={indicatorStyle(on())}>
                <Icon src={() => n().icon} size={pt(21)} color={() => (on() ? colors.snow() : colors.ash())} />
              </View>
              <Text style={tabText(on())}>{t(`nav.${n().id}`)}</Text>
            </View>
          );
        }}
      </Each>
      </View>
      </Scroll>
    </View>
  );
}

const headStyle = (): ViewStyle => ({
  ...row(0),
  justifyContent: "space-between",
  position: "absolute",
  top: safeArea().top,
  left: 20 + safeArea().left,
  right: 20 + safeArea().right,
  height: 44,
  zIndex: 3,
});

/** The top of a phone's root page: the logo and Settings; it scrolls away with the page. */
export function PhoneHead() {
  return (
    <View style={headStyle()}>
      <Logo />
      <SettingsButton size={36} />
    </View>
  );
}

// ---- Tablet --------------------------------------------------------------

const topRowStyle = (solid: boolean): ViewStyle => ({
  ...row(0),
  position: "absolute",
  top: 0,
  left: 0,
  right: 0,
  height: topRowBottom(),
  paddingTop: safeArea().top,
  paddingHorizontal: 24,
  zIndex: 10,
  backgroundColor: solid ? alpha(colors.ink(), 0.96) : "transparent",
});
const tabsStyle = (): ViewStyle => ({
  ...row(2),
  position: "absolute",
  top: safeArea().top + (TOP_ROW - 44) / 2,
  left: 0,
  right: 0,
  justifyContent: "center",
  pointerEvents: "box-none",
});
const tabsGroup = (solid: boolean): ViewStyle => ({
  ...row(2),
  height: 44,
  padding: 4,
  ...rounded(22),
  backgroundColor: solid ? colors.card() : alpha(colors.card(), 0.85),
});
const topTab = (on: boolean, iconOnly: boolean): ViewStyle => ({
  ...row(7),
  height: 36,
  paddingHorizontal: iconOnly ? 12 : 16,
  ...rounded(18),
  backgroundColor: on ? colors.nav() : "transparent",
});
const topTabText = (on: boolean): TextStyle => ({ fontFamily: font, fontSize: 15, fontWeight: 500, color: on ? colors.snow() : colors.dim() });
const capsuleStyle = (): ViewStyle => ({ ...row(2), height: 40, paddingLeft: 8, paddingRight: 14, ...rounded(20), backgroundColor: alpha(colors.card(), 0.78) });
const capsuleText = (): TextStyle => ({ fontFamily: font, fontSize: 16, fontWeight: 500, color: colors.snow() });

/** What the page under this one is called ("‹ Movies"). */
function underName(): string {
  const s = stack();
  const r: Route | undefined = s[s.length - 2];
  if (!r) return "";
  if (r.name === "title") {
    const x = titleOf(r.id);
    return x ? titleText(x) : t("nav.back");
  }
  return r.name === "about" ? t("settings.about.title") : t(`nav.${r.name}`);
}

/** Back in the logo's place: iPad's "‹ Movies" capsule; Android's ← disc, then the logo. */
function TabletBack() {
  return (
    <If
      when={android}
      else={
        <View role="button" accessibilityLabel={t("nav.back_to", { page: underName() })} onPress={handleBack} style={capsuleStyle()}>
          <Icon src={() => backIcon} size={pt(20)} />
          <Text style={capsuleText()}>{underName()}</Text>
        </View>
      }
    >
      <View style={row(12)}>
        <View role="button" accessibilityLabel={t("nav.back_to", { page: underName() })} onPress={handleBack} style={disc(40)}>
          <Icon src={() => backIcon} size={pt(20)} />
        </View>
        <Logo />
      </View>
    </If>
  );
}

/** A title's Add to list in the row, left of Settings. */
function RowListToggle() {
  const shown = () => {
    const r = route();
    if (r.name !== "title") return null;
    const s = titleOf(r.id);
    return s ? { id: r.id, inList: s.inList } : null;
  };
  return (
    <If when={shown()}>
      {(s) => <ListToggle inList={() => s().inList} focused={() => false} onPress={() => toggleList(s().id)} />}
    </If>
  );
}

/** The tablet's top row. */
export function TabletTopRow() {
  return (
    <View testID="top-row" style={topRowStyle(barSolid())}>
      <View style={tabsStyle()}>
        <View style={tabsGroup(barSolid())}>
          <Each of={TABS} key={(n) => n.id}>
            {(n) => {
              const on = () => section() === n().id && !isSettings();
              const iconOnly = n().id === "search";
              return (
                <View role="tab" accessibilityLabel={t(`nav.${n().id}`)} accessibilityState={{ selected: on() }} onPress={() => go(n().id)} style={topTab(on(), iconOnly)}>
                  <Icon src={() => n().icon} size={pt(17)} color={() => (on() ? colors.snow() : colors.dim())} />
                  <If when={!iconOnly}>
                    <Text style={topTabText(on())}>{t(`nav.${n().id}`)}</Text>
                  </If>
                </View>
              );
            }}
          </Each>
        </View>
      </View>
      <If when={canGoBack()} else={<Logo />}>
        <TabletBack />
      </If>
      <View style={{ flex: 1 }} />
      <View style={row(10)}>
        <RowListToggle />
        <SettingsButton size={40} />
      </View>
    </View>
  );
}
