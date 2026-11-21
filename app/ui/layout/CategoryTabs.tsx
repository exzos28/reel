// The categories at the top of a phone's Home (design/navigation.md, "Phone"): All, Movies,
// Series, Cartoons, Anime, the chosen one underlined in red. Each category's root page holds its
// own (`PhoneCategoryBar` in TouchNav, placed by PageFrame), so the tabs leave and come back with
// the page as a page pushed on it slides in and out. A category picked is a new page: its tabs
// start where the last ones were (the category, the row's offset) and move on to its own as a
// system's tab bar does, all of it natively: the underline glides to the chosen tab and takes its
// width (`Tabs`' indicator, a spring), the row slides to centre it, the labels and icons fade
// between ash and snow; at once when the viewer asks for less motion.
import { effect, reduceMotion, signal, Text, View, type ImageAsset, type TextStyle, type ViewRef, type ViewStyle } from "nsh";
import { Tab, Tabs } from "nsh/base";
import { t } from "nsh/i18n";
import { Haptics, isAvailable as hasHaptics } from "nsh/mobile";
import { Icon } from "../kit/Icon";
import { row } from "../kit/shape";
import { CATEGORIES, openCategory, type Destination } from "../nav";
import { caps } from "../platform";
import { colors, font, iconPt as pt, u } from "../theme";
import { windowControlsRoom } from "./chrome";
import { onTop } from "./frameState";
import { CATEGORY_ROW } from "./metrics";
import { NAV } from "./navItems";
import { Rail, railLead } from "./Rail";
import { scroller } from "./scrollCtl";

/** How long a label's colour takes to change, ms (the underline's spring takes about as long). */
const FADE = 250;
/** How bright an unselected icon is: a snow icon at this opacity over the ink reads as ash
 * (#8C8C8C over #0F0F0F), and an opacity fades where a tint cannot. */
const ICON_DIM = 0.54;
/** A phone ticks when the chosen category changes (kit/Pressable's `haptic`). */
const ticks = hasHaptics && caps.touch;

/** Their icons: the nav's (All is Home's). */
const categoryIcon = (id: Destination): ImageAsset => NAV.find((n) => n.id === id)?.icon ?? NAV[0].icon;
const label = (c: Destination) => t(c === "home" ? "nav.all" : `nav.${c}`);
const fade = (): number => (reduceMotion() ? 0 : FADE);

const barStyle = (): ViewStyle => ({ borderBottomWidth: 1, borderBottomColor: colors.card(), paddingLeft: Math.max(0, windowControlsRoom() - 20) });
const listStyle = (): ViewStyle => ({ ...row(u(40)) });
/** The underline: under the chosen tab, inside the row's height (as the border it replaces). */
const indicatorStyle = (): ViewStyle => ({ bottom: 0, height: 2, backgroundColor: colors.red() });
/** kit/Pressable's dim, from the finger down; let go, it fades back, so a quick tap shows too. */
const tabStyle = (): ViewStyle => ({ ...row(6), height: CATEGORY_ROW, transitionProperty: "opacity", transitionDuration: reduceMotion() ? 0 : 160, transitionTimingFunction: "ease-out" });
const pressedStyle = (): ViewStyle => ({ opacity: 0.7, transitionDuration: 0 });
/** One weight for every label (a heavier chosen one would make the row shift as it changes). */
const textStyle = (on: boolean): TextStyle => ({
  fontFamily: font,
  fontSize: 16,
  fontWeight: 500,
  color: on ? colors.snow() : colors.ash(),
  transitionProperty: "colors",
  transitionDuration: fade(),
  transitionTimingFunction: "ease-out",
});
const iconStyle = (on: boolean): ViewStyle => ({ opacity: on ? 1 : ICON_DIM, transitionProperty: "opacity", transitionDuration: fade(), transitionTimingFunction: "ease-out" });

/** One category. Not a kit/Pressable: `Tab` is what `Tabs` moves its underline to; it takes the
 * press itself and shows it with the same dim (`pressedStyle`). */
function CategoryTab(props: { id: Destination; on: () => boolean; chosen: (r: ViewRef) => void }) {
  const on = props.on;
  let ref: ViewRef | undefined;
  effect(() => {
    // After this turn: the ref set and the row laid out with the new choice.
    if (on()) Promise.resolve().then(() => ref && props.chosen(ref));
  });
  return (
    <Tab
      ref={(r: ViewRef) => (ref = r)}
      selected={on()}
      accessibilityLabel={label(props.id)}
      onPress={() => {
        if (!on() && ticks) Haptics.selection();
        openCategory(props.id);
      }}
      style={tabStyle()}
      activeStyle={pressedStyle()}
    >
      <View style={iconStyle(on())}>
        <Icon src={() => categoryIcon(props.id)} size={pt(18)} />
      </View>
      <Text style={textStyle(on())}>{label(props.id)}</Text>
    </Tab>
  );
}

/** What the tabs on top showed last: the tabs of a category's page opened from them start there. */
const last: { category: Destination | null; offset: number } = { category: null, offset: 0 };

/** All, Movies, Series, Cartoons, Anime: what Home shows, `category` (the page's) underlined in
 * red. A row that scrolls sideways where it does not fit; the chosen one slides to its middle (as
 * far as the row's ends let it). A page's row starts as the last tabs were (their category, their
 * offset) and moves on to its own once it is drawn, so picking a category reads as one bar
 * moving; the app's first row is placed at once. */
export function CategoryTabs(props: { category: Destination }) {
  const tabs = scroller({ horizontal: true, anchor: railLead });
  const from = last.category;
  const start = last.offset;
  /** From the last tabs' category to this page's (with less motion, at this page's at once). */
  const glide = from !== null && from !== props.category && !reduceMotion();
  /** The row starts where the last tabs left it: on a glide, and back on the same category. */
  const resume = glide || from === props.category;
  /** The category the underline is on: the last tabs' until this row is drawn, then the page's. */
  const chosen = signal(glide ? from! : props.category);
  if (glide) requestAnimationFrame(() => requestAnimationFrame(() => chosen.set(props.category)));
  // What these tabs show (the viewer may have moved the row), while they are the ones on top.
  const top = onTop();
  effect(() => {
    const offset = tabs.offset() ?? 0;
    if (!top()) return;
    last.category = props.category;
    last.offset = offset;
  });
  /** The row placed at once the first time, then gliding to the chosen tab. */
  let placed = false;
  const show = (r: ViewRef) => {
    const first = !placed;
    placed = true;
    if (first && resume) {
      tabs.scroll()?.scrollTo({ x: start, animated: false });
      tabs.remember(start);
    } else r.reveal({ horizontal: "center", vertical: "nearest", animated: !first && !reduceMotion() });
  };
  return (
    <View accessibilityLabel={t("nav.categories")} style={barStyle()}>
      <Rail ctl={tabs} gap={0}>
        <Tabs style={listStyle()} indicatorStyle={indicatorStyle()}>
          <Each of={CATEGORIES} key={(c) => c}>
            {(c) => <CategoryTab id={c()} on={() => chosen() === c()} chosen={show} />}
          </Each>
        </Tabs>
      </Rail>
    </View>
  );
}
