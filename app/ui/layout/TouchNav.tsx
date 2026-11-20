// The nav on touch (design/navigation.md, "Tablet" and "Phone"). The tabs are
// Home, Movies, Shows, Anime and Search. Phone: a bottom tab bar (Home, Search, Saved, Settings)
// on every page but the player, and a head over a root page (the logo; on a category's page
// Home's tabs: All, Movies, Series, Cartoons, Anime) that scrolls away with it.
// Tablet: one top row on every page: the logo (Back in its place on a deeper
// page), the floating tabs centred, Add to list on a title, Saved and Settings (sections of their
// own, each its own stack); solid once content is under it. A tablet's narrow window is a phone's.
import { safeArea, signal, Text, View, windowSize, type ImageAsset, type JSX, type TextStyle, type ViewStyle } from "nsh";
import { t } from "nsh/i18n";
import { person as personOf, title as titleOf, titleText, toggleList } from "../catalog";
import backIcon from "../icons/back.svg";
import settingsIcon from "../icons/settings.svg";
import { Icon } from "../kit/Icon";
import { rounded, row } from "../kit/shape";
import { canGoBack, CATEGORIES, go, goHomeTab, handleBack, isCategory, openCategory, route, section, stack, type Destination, type Route } from "../nav";
import { look } from "../platform/look";
import { alpha, colors, font, iconPt, targetSlop, u } from "../theme";
import { ListToggle } from "./ListToggle";
import { NAV } from "./navItems";
import { frameSolid } from "./frameState";
import { windowControlsRoom } from "./chrome";
import { CATEGORY_ROW, PHONE_BACK_HEAD, PHONE_HEAD, PHONE_TITLE_BAR, phoneRail, railWidth, TAB_ROW, TOP_ROW } from "./metrics";
import { Rail, railLead } from "./Rail";
import { scroller } from "./scrollCtl";
import savedIcon from "../icons/saved.svg";
import searchIcon from "../icons/search.svg";
import { librarySupported, savingOverall, watchSaved } from "../library";
import { Pressable } from "../kit/Pressable";
import { ProgressRing } from "../kit/SaveMark";

/** The tabs: the nav's destinations but Settings. */
const TABS = NAV.filter((n) => n.id !== "settings" && n.id !== "saved");
/** Android's Material bar, else iOS's. */
const android = look.system === "material";
/** Points as TV pixels, for `Icon`'s size. */
const pt = iconPt;

/** How tall the phone's tab bar is with the system's area under it. */
const tabBarHeight = () => TAB_ROW + safeArea().bottom;
const topRowBottom = () => safeArea().top + TOP_ROW;

/** A page of Settings is shown: its own section, or (a phone's) on top of a tab. */
const isSettings = () => section() === "settings" || route().name === "settings" || route().name === "about" || route().name === "interface";

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

/** Settings, a round button (a 44 pt touch area): a section of its own, like Saved (its own
 * stack; chosen again, its root). */
const settingsOn = () => section() === "settings";
function SettingsButton(props: { size: number }) {
  return (
    <Pressable
      testID={settingsOn() ? "settings-button-on" : "settings-button"}
      role="button"
      accessibilityLabel={t("nav.settings")}
      accessibilityState={{ selected: settingsOn() }}
      haptic={!settingsOn()}
      onPress={() => go("settings")}
      hitSlop={targetSlop(props.size)}
      style={disc(props.size, settingsOn())}
    >
      <Icon src={() => settingsIcon} size={pt(props.size * 0.47)} color={() => (settingsOn() ? colors.snow() : colors.dim())} />
    </Pressable>
  );
}

// ---- Phone ---------------------------------------------------------------

const tabBarStyle = (): ViewStyle => ({
  flexDirection: "row",
  position: "absolute",
  left: 0,
  right: 0,
  bottom: 0,
  height: tabBarHeight(),
  paddingTop: android ? 12 : 6,
  paddingHorizontal: 8 + Math.max(safeArea().left, safeArea().right),
  backgroundColor: colors.ink(),
  borderTopWidth: 1,
  borderTopColor: colors.card(),
  zIndex: 10,
});
/** Landscape: the tabs in a column at the left, centred in the height. */
const railStyle = (): ViewStyle => ({
  position: "absolute",
  top: 0,
  bottom: 0,
  left: 0,
  width: railWidth(),
  paddingLeft: safeArea().left,
  justifyContent: "center",
  gap: 6,
  backgroundColor: colors.ink(),
  borderRightWidth: 1,
  borderRightColor: colors.card(),
  zIndex: 10,
});
/** A tab: an equal share of the bar's width (a rail's row), at least 48 pt tall. */
const tabStyle = (inRail: boolean): ViewStyle => ({ ...(inRail ? { height: 60 } : { flex: 1 }), minHeight: 48, alignItems: "center", gap: android ? 4 : 3 });
const indicatorStyle = (on: boolean): ViewStyle => ({
  width: android ? 64 : 52,
  height: android ? 32 : 30,
  ...rounded(android ? 16 : 9),
  alignItems: "center",
  justifyContent: "center",
  backgroundColor: on ? colors.raise() : "transparent",
});
const tabText = (on: boolean): TextStyle => ({ fontFamily: font, fontSize: android ? 12 : 10.5, fontWeight: 500, color: on ? colors.snow() : colors.ash() });

/** The Saved tab's mark while anything saves: a small ring of how much of it is saved, at the
 * icon's top right (design/offline-downloads.md). */
const markStyle = (): ViewStyle => ({ position: "absolute", top: 0, right: android ? 16 : 10 });

/** The phone's tabs: Home (the categories, chosen at the top of its page), Search, Saved where
 * this device saves, Settings. */
const PHONE_TABS: { id: Destination; label: string; icon: ImageAsset; on: () => boolean; go: () => void }[] = [
  { id: "home", label: "nav.home", icon: NAV[0].icon, on: () => isCategory(section()) && !isSettings(), go: goHomeTab },
  { id: "search", label: "nav.search", icon: searchIcon, on: () => section() === "search" && !isSettings(), go: () => go("search") },
  ...(librarySupported ? [{ id: "saved" as const, label: "nav.saved", icon: savedIcon, on: () => section() === "saved" && !isSettings(), go: () => go("saved") }] : []),
  { id: "settings", label: "nav.settings", icon: settingsIcon, on: () => section() === "settings", go: () => go("settings") },
];

function Tab(props: { label: string; icon: ImageAsset; on: () => boolean; inRail: boolean; saving?: boolean; onPress: () => void }) {
  return (
    <Pressable haptic={!props.on()} role="tab" accessibilityLabel={props.label} accessibilityState={{ selected: props.on() }} onPress={props.onPress} style={tabStyle(props.inRail)}>
      <View style={indicatorStyle(props.on())}>
        <Icon src={() => props.icon} size={pt(21)} color={() => (props.on() ? colors.snow() : colors.ash())} />
        <If when={props.saving && savingOverall().saving}>
          <View testID="saved-progress" style={markStyle()}>
            <ProgressRing progress={() => savingOverall().progress} size={12} stroke={2.5} background={() => (props.on() ? colors.raise() : colors.ink())} />
          </View>
        </If>
      </View>
      <Text style={tabText(props.on())}>{props.label}</Text>
    </Pressable>
  );
}

/** The phone's tabs: a bar under the content, or (held sideways) a rail at its left. Tapping
 * the selected tab pops it to its root. */
export function PhoneTabBar() {
  watchSaved();
  return (
    <View
      testID={phoneRail() ? "nav-rail" : "tab-bar"}
      role="tablist"
      accessibilityLabel={t("nav.sections")}
      style={phoneRail() ? railStyle() : tabBarStyle()}
    >
      <Each of={PHONE_TABS} key={(n) => n.id}>
        {(n) => <Tab label={t(n().label)} icon={n().icon} on={n().on} inRail={phoneRail()} saving={n().id === "saved"} onPress={n().go} />}
      </Each>
    </View>
  );
}

// ---- The categories at the top of a phone's Home ---------------------------------------

/** Their icons: the nav's (All is Home's). */
const categoryIcon = (id: Destination) => NAV.find((n) => n.id === id)?.icon ?? NAV[0].icon;
const categoryTabStyle = (on: boolean): ViewStyle => ({
  ...row(6),
  height: CATEGORY_ROW,
  borderBottomWidth: 2,
  borderBottomColor: on ? colors.red() : "transparent",
});
const categoryText = (on: boolean): TextStyle => ({ fontFamily: font, fontSize: 16, fontWeight: on ? 600 : 500, color: on ? colors.snow() : colors.ash() });

/** All, Movies, Series, Cartoons, Anime: what Home shows, the chosen one underlined in red. A row
 * that scrolls sideways where it does not fit; the chosen one shows. */
function CategoryTabs() {
  const tabs = scroller({ horizontal: true, anchor: railLead });
  return (
    <View role="tablist" accessibilityLabel={t("nav.categories")} style={{ borderBottomWidth: 1, borderBottomColor: colors.card(), paddingLeft: Math.max(0, windowControlsRoom() - 20) }}>
      <Rail ctl={tabs} gap={40}>
        <Each of={CATEGORIES} key={(c) => c}>
          {(c) => {
            const on = () => section() === c();
            return (
              <Pressable haptic={!on()} ref={tabs.follow(on)} role="tab" accessibilityLabel={t(c() === "home" ? "nav.all" : `nav.${c()}`)} accessibilityState={{ selected: on() }} onPress={() => openCategory(c())} style={categoryTabStyle(on())}>
                <Icon src={() => categoryIcon(c())} size={pt(18)} color={() => (on() ? colors.snow() : colors.ash())} />
                <Text style={categoryText(on())}>{t(c() === "home" ? "nav.all" : `nav.${c()}`)}</Text>
              </Pressable>
            );
          }}
        </Each>
      </Rail>
    </View>
  );
}

/** On a category's page the head is a bar of its own (the page's ink, a hairline under the tabs):
 * the hero's still starts under it, and the tabs read over nothing but ink. */
const headColumnStyle = (veiled: boolean): ViewStyle => ({
  position: "absolute",
  top: 0,
  paddingTop: safeArea().top,
  left: 0,
  right: 0,
  zIndex: 3,
  backgroundColor: veiled ? colors.ink() : "transparent",
});
const headStyle = (): ViewStyle => ({
  ...row(0),
  justifyContent: "space-between",
  height: PHONE_HEAD,
  paddingLeft: 20 + safeArea().left,
  paddingRight: 20 + safeArea().right,
});

/** The top of a phone's root page: nothing of reel's (no logo: the room is the content's); a
 * category's has Home's tabs instead (`PhoneCategoryBar`). */
export function PhoneHead() {
  return null;
}

/** Over a category's root page: Home's tabs, a bar that stays (the page scrolls
 * under it) and stays the same while the category changes: the tabs do not jump. Not over a
 * page pushed on a category (a title). */
export function PhoneCategoryBar() {
  return (
    <If when={isCategory(section()) && !canGoBack()}>
      <View testID="category-bar" style={{ ...headColumnStyle(true), zIndex: 10 }}>
        <CategoryTabs />
      </View>
    </If>
  );
}

/** How long the title bar takes to come and go, ms. */
const BAR_FADE = 200;
/** A disc's fill fading out where it becomes a bar's plain button. */
const fadeFill = (plain: boolean): ViewStyle => ({ ...(plain ? { backgroundColor: "transparent" } : {}), transitionProperty: "colors", transitionDuration: BAR_FADE });

/** Back, a disc (40 across, a 44 pt touch area); `plain`, its fill fades out (a bar's plain ‹).
 * Also the setup's, in its logo's place. */
export function BackDisc(props: { label?: () => string; plain?: () => boolean }) {
  return (
    <Pressable role="button" accessibilityLabel={props.label?.() ?? t("nav.back")} onPress={handleBack} hitSlop={targetSlop(40)} style={{ ...disc(40), ...fadeFill(props.plain?.() ?? false) }}>
      <Icon src={() => backIcon} size={pt(20)} />
    </Pressable>
  );
}

/** Over a title's hero: Back and the header action (Add to list) as discs at the top corners;
 * once the page has scrolled past the hero (`solid`) the standard bar under the status bar, the
 * same buttons now plain (their fills fade out), the title between them: iOS's centred, Android's
 * after ← (design/navigation.md, "Phone"). Fixed: it stays as the page scrolls. */
const titleBarStyle = (solid: boolean): ViewStyle => ({
  ...row(0),
  justifyContent: "space-between",
  position: "absolute",
  top: 0,
  left: 0,
  right: 0,
  height: safeArea().top + PHONE_TITLE_BAR,
  paddingTop: safeArea().top,
  paddingLeft: Math.max(16, windowControlsRoom()),
  paddingRight: 16 + safeArea().right,
  zIndex: 10,
  pointerEvents: "box-none",
  backgroundColor: solid ? alpha(colors.ink(), 0.96) : "transparent",
  borderBottomWidth: 1,
  borderBottomColor: solid ? colors.card() : "transparent",
  transitionProperty: "colors",
  transitionDuration: BAR_FADE,
});
/** iOS: centred across the bar, clear of the buttons; Android: after ← at Material's 72 keyline. */
const barTitleSide = 16 + 40 + 12;
const barTitleStyle = (solid: boolean): TextStyle => ({
  position: "absolute",
  bottom: 0,
  height: PHONE_TITLE_BAR,
  lineHeight: PHONE_TITLE_BAR,
  left: android ? 72 : barTitleSide,
  right: barTitleSide + safeArea().right,
  numberOfLines: 1,
  textAlign: android ? "left" : "center",
  fontFamily: font,
  fontSize: android ? 22 : 17,
  fontWeight: android ? 400 : 600,
  color: colors.snow(),
  opacity: solid ? 1 : 0,
  transitionProperty: "opacity",
  transitionDuration: BAR_FADE,
});

export function PhoneTitleBar(props: { testID?: string; solid: () => boolean; title?: () => string; action?: JSX.Element }) {
  const hidden = () => !props.solid();
  return (
    <View testID={props.testID} style={titleBarStyle(props.solid())}>
      <Text
        role="header"
        accessibilityElementsHidden={hidden()}
        importantForAccessibility={hidden() ? "no-hide-descendants" : "auto"}
        style={barTitleStyle(props.solid())}
      >
        {props.title?.() ?? ""}
      </Text>
      <BackDisc label={() => t("nav.back_to", { page: underName() })} plain={props.solid} />
      {props.action}
    </View>
  );
}

const backHeadStyle = (): ViewStyle => ({
  ...row(0),
  position: "absolute",
  top: 0,
  left: 0,
  right: 0,
  height: safeArea().top + PHONE_BACK_HEAD,
  paddingTop: safeArea().top,
  paddingLeft: Math.max(16 + safeArea().left, windowControlsRoom()),
  backgroundColor: colors.ink(),
  zIndex: 10,
});

/** The top of a phone's deep page (Settings, About): Back, fixed; the title is the page's. */
export function PhoneBackHead() {
  return (
    <View testID="back-head" style={backHeadStyle()}>
      <BackDisc />
    </View>
  );
}

// ---- Tablet --------------------------------------------------------------

/** The row's sides, points: its padding at the window's edges, and the least room between the
 * tabs and what is beside them. */
const ROW_EDGE = 24;
const TABS_GAP = 8;
/** The least the Back capsule keeps on a deeper page, points: it says where Back goes. */
const BACK_ROOM = 150;
/** The round buttons at the right (Add to list, Saved, Settings), points, and their gap. */
const DISC = 40;
const DISC_GAP = 10;

const topRowStyle = (solid: boolean): ViewStyle => ({
  ...row(0),
  position: "absolute",
  top: 0,
  left: 0,
  right: 0,
  height: topRowBottom(),
  paddingTop: safeArea().top,
  paddingLeft: Math.max(ROW_EDGE + safeArea().left, windowControlsRoom()),
  paddingRight: ROW_EDGE + safeArea().right,
  zIndex: 10,
  // Solid once content is under it, the status bar's area with it, a hairline under it.
  backgroundColor: solid ? alpha(colors.ink(), 0.96) : "transparent",
  borderBottomWidth: 1,
  borderBottomColor: solid ? colors.card() : "transparent",
  transitionProperty: "colors",
  transitionDuration: BAR_FADE,
});
/** The sides share what the tabs leave, so the tabs stay centred; the right one keeps at least
 * its buttons' width (the tabs move left of the centre before they run into them). */
const sideStyle = (end: boolean, least: number): ViewStyle => ({
  ...row(DISC_GAP),
  flex: 1,
  minWidth: least,
  justifyContent: end ? "flex-end" : "flex-start",
  ...(end ? { paddingLeft: TABS_GAP } : { paddingRight: TABS_GAP }),
});
const tabsGroup = (solid: boolean): ViewStyle => ({
  ...row(2),
  flexShrink: 0,
  height: 52,
  padding: 4,
  ...rounded(26),
  backgroundColor: solid ? colors.card() : alpha(colors.card(), 0.85),
});
const topTab = (on: boolean, iconOnly: boolean): ViewStyle => ({
  ...row(7),
  height: 44,
  minWidth: 44,
  justifyContent: "center",
  paddingHorizontal: iconOnly ? 12 : 16,
  ...rounded(22),
  backgroundColor: on ? colors.nav() : "transparent",
});
const topTabText = (on: boolean): TextStyle => ({ numberOfLines: 1, fontFamily: font, fontSize: 15, fontWeight: 500, color: on ? colors.snow() : colors.dim() });
const capsuleStyle = (): ViewStyle => ({ ...row(2), flexShrink: 1, minWidth: 0, height: 44, paddingLeft: 8, paddingRight: 14, ...rounded(22), backgroundColor: alpha(colors.card(), 0.78) });
const capsuleText = (): TextStyle => ({ numberOfLines: 1, flexShrink: 1, fontFamily: font, fontSize: 16, fontWeight: 500, color: colors.snow() });
/** Where the tabs with their labels are laid out unseen, wide enough for them, to know their width. */
const measureRoom: ViewStyle = { position: "absolute", top: 0, left: 0, width: 4000, height: 0, overflow: "hidden", opacity: 0, pointerEvents: "none" };

/** What the page under this one is called ("‹ Movies"). */
function underName(): string {
  const s = stack();
  const r: Route | undefined = s[s.length - 2];
  if (!r) return "";
  if (r.name === "title") {
    const x = titleOf(r.id);
    return x ? titleText(x) : t("nav.back");
  }
  if (r.name === "person") return personOf(r.id).name || t("nav.back");
  return r.name === "about" || r.name === "interface" ? t(`settings.${r.name}.title`) : t(`nav.${r.name}`);
}

/** Back in the logo's place: iPad's "‹ Movies" capsule; Android's ← disc, then the logo. */
function TabletBack() {
  return (
    <If
      when={android}
      else={
        <Pressable role="button" accessibilityLabel={t("nav.back_to", { page: underName() })} onPress={handleBack} style={capsuleStyle()}>
          <Icon src={() => backIcon} size={pt(20)} />
          <Text style={capsuleText()}>{underName()}</Text>
        </Pressable>
      }
    >
      <View style={row(12)}>
        <Pressable role="button" accessibilityLabel={t("nav.back_to", { page: underName() })} onPress={handleBack} style={disc(44)}>
          <Icon src={() => backIcon} size={pt(20)} />
        </Pressable>
        <Logo />
      </View>
    </If>
  );
}

/** A title's Add to list in the row, left of Saved and Settings. */
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

/** Saved is open (its own stack). */
const savedOn = () => section() === "saved";
const ringRoom = 3;
/** Saved's ring of the overall progress, around the disc while anything saves. */
const savedRingStyle = (): ViewStyle => ({ position: "absolute", top: -ringRoom, left: -ringRoom, pointerEvents: "none" });

/** Saved, a round button where this device saves (design/offline-downloads.md): a destination
 * of its own (its own stack; chosen again, its root), with a ring of how much of what is saving
 * is saved while anything saves. */
function SavedButton() {
  watchSaved();
  return (
    <Pressable
      testID="saved-button"
      role="button"
      accessibilityLabel={t("nav.saved")}
      accessibilityState={{ selected: savedOn() }}
      haptic={!savedOn()}
      onPress={() => go("saved")}
      hitSlop={targetSlop(DISC)}
      style={disc(DISC, savedOn())}
    >
      <If when={savingOverall().saving}>
        <View testID="saved-progress" style={savedRingStyle()}>
          <ProgressRing progress={() => savingOverall().progress} size={DISC + 2 * ringRoom} stroke={2.5} background={() => (savedOn() ? colors.nav() : colors.ink())} />
        </View>
      </If>
      <Icon src={() => savedIcon} size={pt(DISC * 0.47)} color={() => (savedOn() ? colors.snow() : colors.dim())} />
    </Pressable>
  );
}

/** The tablet's top row: Back (or the logo) | the tabs | Add to list, Saved and Settings. The tabs
 * show their labels where those fit between the sides (measured), else their icons only. */
export function TabletTopRow() {
  const labelled = signal(0);
  const logo = signal(0);
  const right = signal(0);
  const leftNeed = () => (canGoBack() ? BACK_ROOM : logo());
  const edge = () => Math.max(ROW_EDGE + safeArea().left, windowControlsRoom());
  const labels = () =>
    labelled() > 0 &&
    labelled() + 2 * (Math.max(leftNeed() + edge(), right() + ROW_EDGE + safeArea().right) + TABS_GAP) <= windowSize().width;
  const tabs = (iconsOnly: boolean, live: boolean) => (
    <Each of={TABS} key={(n) => n.id}>
      {(n) => {
        const on = () => live && section() === n().id;
        const iconOnly = () => n().id === "search" || iconsOnly;
        return (
          <Pressable testID={on() ? `top-tab-on-${n().id}` : undefined} haptic={!on()} role="tab" accessibilityLabel={t(`nav.${n().id}`)} accessibilityState={{ selected: on() }} onPress={() => go(n().id)} style={topTab(on(), iconOnly())}>
            <Icon src={() => n().icon} size={pt(17)} color={() => (on() ? colors.snow() : colors.dim())} />
            <If when={!iconOnly()}>
              <Text style={topTabText(on())}>{t(`nav.${n().id}`)}</Text>
            </If>
          </Pressable>
        );
      }}
    </Each>
  );
  return (
    <View testID={frameSolid() ? "top-row-solid" : "top-row"} style={topRowStyle(frameSolid())}>
      <View style={measureRoom} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <View style={{ ...tabsGroup(false), alignSelf: "flex-start" }} onLayout={(e) => labelled.set(e.bounds.size.width)}>
          {tabs(false, false)}
        </View>
      </View>
      <View style={sideStyle(false, 0)}>
        <If when={canGoBack()} else={<View onLayout={(e) => logo.set(e.bounds.size.width)}><Logo /></View>}>
          <TabletBack />
        </If>
      </View>
      <View testID={labels() ? "top-tabs-labelled" : "top-tabs-icons"} style={tabsGroup(frameSolid())}>
        {tabs(!labels(), true)}
      </View>
      <View style={sideStyle(true, right() + TABS_GAP)}>
        <View style={row(DISC_GAP)} onLayout={(e) => right.set(e.bounds.size.width)}>
          <RowListToggle />
          <If when={librarySupported}>
            <SavedButton />
          </If>
          <SettingsButton size={DISC} />
        </View>
      </View>
    </View>
  );
}
