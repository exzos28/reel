// A drawer: a panel over the page with a title (and a note under it) and a list,
// the one shape every side panel of reel takes (releases, filters, choices such as
// the language). Where it sits is the platform's (design/navigation.md, "Panels"):
// - TV: at the right, the full height, no ✕ (the remote's Back closes it);
// - desktop: an NSH Sheet at the right, over the window bar, the full height, with ✕;
// - tablet: a floating sheet at the right, under the status bar, with ✕ (a short list of choices
//   is a popover instead: ChoicePanel);
// - phone: a sheet from the bottom, with a grabber and ✕; held sideways, a drawer that asks for
//   it (`sideways`: the player's) is a full-height sheet at the right. In the player drawn
//   sideways (`surface` turned) that sheet is drawn in place, sliding in from the box's right: NSH's
//   Sheet is a dialog of its own, which would show the window's way up. Its heading stays put and
//   only the rows scroll under it. From the bottom it is as tall as its rows (one detent); a list
//   taller than `MEDIUM` of the screen opens there and grows to `LARGE`, as tall as its rows at
//   most (iOS's medium and large detents). NSH's `Sheet` moves it: a drag follows the finger on
//   the UI thread and a release springs to a detent with the finger's speed, or closes it. At
//   medium the rows hold still, so a drag on them moves the sheet; at large they scroll, and a
//   drag down from their top moves the sheet (on iOS the same drag). The grabber's press goes
//   from one detent to the other; it keeps clear of the home indicator and the keyboard.
// Back (through the page's closer, or the sheet's Escape), ✕ or a press outside
// closes it.
//
// The TV keeps reel's own panel: on Android (Android TV), after an NSH Sheet has
// been open, Escape (the remote's Back in the tests) no longer reached the app's key
// bindings in a headless run, and the remote must always reach Back.
import { cleanup, createAnimatedValue, effect, keyboardFrame, reduceMotion, signal, Text, untracked, View, type JSX, type ViewStyle } from "nsh";
import { Sheet, type SheetDetent } from "nsh/base";
import { titleBar } from "../platform/titlebar";
import { t } from "nsh/i18n";
import { Icon } from "../kit/Icon";
import { rounded } from "../kit/shape";
import { metaText, sectionTitle } from "../kit/text";
import { alpha, colors, iconPt, safe, targetSlop, u } from "../theme";
import closeIcon from "../icons/plus.svg";
import { frame, phoneSideways, sideSafeArea, type PanelPlace } from "./chrome";
import { scroller, Scroller, type ScrollCtl } from "./Scroller";
import { surfaceInsets, surfaceSize, surfaceTurned } from "./surface";
import { Pressable } from "../kit/Pressable";

const veil = () => alpha(colors.ink(), 0.6);

const tvBackdrop = (): ViewStyle => ({ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: 20, backgroundColor: veil() });
const tvPanel = (width: number): ViewStyle => ({
  position: "absolute", top: 0, right: 0, bottom: 0, width: u(width), zIndex: 21,
  backgroundColor: colors.ink(), borderLeftWidth: 1, borderLeftColor: alpha(colors.snow(), 0.08),
  boxShadow: `${-u(30)}px 0 ${u(60)}px ${alpha(colors.ink(), 0.8)}`,
});

/** A sideways phone's sheet at the right, points, besides the safe area beside it. */
const SIDE_WIDTH = 360;
/** How long the in-place sheet takes to slide in, ms. */
const SLIDE_MS = 250;
/** The in-place sheet (the turned player's): at the box's right, the full height, over its backdrop. */
const inPlaceStyle = (): ViewStyle => ({ position: "absolute", top: 0, right: 0, bottom: 0, zIndex: 21, ...sheetStyle("side") });
/** A tablet's floating sheet: its width, the most of the screen's it takes (a portrait one's
 * 834 points), and its room from the screen's edges and bars, points. */
const FLOAT_WIDTH = 440;
const FLOAT_SHARE = 0.48;
const FLOAT_MARGIN = 12;

/** Where this drawer sits: `side` for a sideways phone's (`sideways` asked for). */
type Place = "tv" | "side-sheet" | "floating-sheet" | "bottom-sheet" | "side";

/** A phone's drawer (from the bottom, or at the right held sideways): its heading stays put. */
const phone = () => frame().panel === "bottom-sheet";
/** A phone's sheet left and right of its content: a page's margin (`chrome`'s phone 20). */
const PHONE_PAD = 20;
/** Room under a phone sheet's last row, over the home indicator. */
const PHONE_FOOT = 16;
/** A bottom sheet's heights, of the window's: where a long list opens, and where it grows to. */
const MEDIUM = 0.6;
const LARGE = 0.9;
/** A list up to this much taller than the medium height stays one detent, as tall as its rows. */
const MEDIUM_SLACK = 1.15;
/** The grabber and the room over it, points. */
const GRABBER_ROOM = 13;
/** The grabber's press area reaches this far, points: a 44-point target over the title's top; over
 * a head (the tracks' tabs) only the room above it, `HEAD_ROOM`, so the head keeps its presses. */
const GRABBER_REACH = 44;
const HEAD_ROOM = 8;
/** The keyboard is up: NSH then lifts a bottom sheet over it, at its largest detent. */
const keyboardUp = () => keyboardFrame().height - surfaceInsets().bottom > 0;
/** The tallest a bottom sheet gets: under the status bar (NSH keeps it over the keyboard). */
const room = () => surfaceSize().height - surfaceInsets().top - 8;
/** Each drawer's rows as they last measured (by its id and title: the choices share one id): it
 * opens at the height it had. */
const lastRows = new Map<string, number>();
/** Where each open drawer (by its id) sits for the layout: a tablet's window resized across a
 * phone's width moves it (`frame().panel`), and its page is laid out again with it. */
const openOn = new Map<string, PanelPlace>();

function sheetStyle(place: Place): ViewStyle {
  if (place === "side")
    return { width: SIDE_WIDTH + sideSafeArea().right, backgroundColor: colors.card(), borderTopLeftRadius: 22, borderBottomLeftRadius: 22, borderCurve: "continuous" };
  if (place === "bottom-sheet")
    return { backgroundColor: colors.card(), borderTopLeftRadius: 22, borderTopRightRadius: 22, borderCurve: "continuous" };
  // A tablet's: clear of the status bar and the home indicator; in portrait under half the screen.
  if (frame().panel === "floating-sheet")
    return {
      width: Math.min(FLOAT_WIDTH, surfaceSize().width * FLOAT_SHARE),
      margin: FLOAT_MARGIN,
      marginTop: surfaceInsets().top + FLOAT_MARGIN,
      marginBottom: surfaceInsets().bottom + FLOAT_MARGIN,
      backgroundColor: colors.card(),
      ...rounded(22),
    };
  // A desktop's: over everything, the window bar too, the full height.
  return { width: 460, backgroundColor: colors.card(), borderLeftWidth: 1, borderLeftColor: alpha(colors.snow(), 0.08) };
}
/** A desktop drawer runs up over the window bar: where the system's window controls sit at the
 * bar's right end (Windows, GTK), its ✕ and title start under them instead of beneath them. */
const controlsRoom = () => (frame().panel === "side-sheet" && titleBar().right > 0 ? titleBar().height : 0);
const underControls = (): ViewStyle => ({ paddingTop: controlsRoom() });
const grabberStyle = (): ViewStyle => ({ width: 36, height: 5, borderRadius: 3, alignSelf: "center", backgroundColor: "#4A4A4A" });
/** The grabber's strip over the heading; pressed (a long list's), it reaches `GRABBER_REACH`. */
const grabberArea = (): ViewStyle => ({ height: GRABBER_ROOM, justifyContent: "flex-end", alignSelf: "stretch" });
/** The system's insets inside a sheet that has them on its sides: a sideways phone's (the notch
 * side, the home indicator), and the home indicator under a bottom sheet. */
const insets = (place: Place) =>
  place === "side" ? { top: surfaceInsets().top, right: sideSafeArea().right, bottom: surfaceInsets().bottom }
  : place === "bottom-sheet" ? { top: 0, right: 0, bottom: surfaceInsets().bottom }
  : { top: 0, right: 0, bottom: 0 };
const closeStyle = (place: Place): ViewStyle => ({
  position: "absolute",
  top: (place === "bottom-sheet" ? 18 : 14) + controlsRoom() + insets(place).top,
  right: (phone() ? PHONE_PAD : 14) + insets(place).right,
  width: 30,
  height: 30,
  ...rounded(999),
  alignItems: "center",
  justifyContent: "center",
  backgroundColor: colors.raise(),
  zIndex: 2,
});
/** How far in from a drawer's sides its rows start, points: a row that scrolls sideways (the
 * Save drawer's seasons) runs out to the edge by this much, so the cut shows it goes on. */
export const drawerPad = () => (frame().panel === "tv" ? u(48) : phone() ? PHONE_PAD : 16);
/** A TV panel's sides: 48 from its left edge, the screen's title-safe inset on the right (a set
 * may crop the screen's edge). */
const tvSides = (): ViewStyle => ({ paddingLeft: u(48), paddingRight: safe().x });
const contentStyle = (): ViewStyle =>
  frame().panel === "tv"
    ? { ...tvSides(), paddingTop: safe().y, paddingBottom: safe().y, gap: u(20) }
    : phone() ? { paddingHorizontal: PHONE_PAD, paddingTop: 8, paddingBottom: PHONE_FOOT, gap: 12 }
    : { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 24, gap: 12 };

/** ✕: the plus turned a quarter. */
function CloseButton(props: { onPress: () => void; place: Place; id: string }) {
  return (
    <Pressable testID={`${props.id}-close`} role="button" hitSlop={targetSlop(30)} accessibilityLabel={t("player.close")} onPress={props.onPress} style={closeStyle(props.place)}>
      <View style={{ transform: "rotate(45deg)" }}>
        <Icon src={() => closeIcon} size={iconPt(14)} />
      </View>
    </Pressable>
  );
}

/** What stays at the drawer's foot under the scrolling rows (its main action). */
const footerStyle = (): ViewStyle => ({
  ...(frame().panel === "tv"
    ? { ...tvSides(), paddingTop: u(20), paddingBottom: safe().y, gap: u(12) }
    : phone() ? { paddingHorizontal: PHONE_PAD, paddingTop: 12, paddingBottom: PHONE_FOOT, gap: 10 }
    : { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 16, gap: 10 }),
  borderTopWidth: 1,
  borderTopColor: alpha(colors.snow(), 0.08),
});

type BodyProps = {
  title?: () => string;
  note?: () => string;
  head?: () => JSX.Element;
  children: (list: ScrollCtl) => JSX.Element;
  footer?: () => JSX.Element;
  /** The sheet's insets (a phone's safe area). */
  inset?: () => { top: number; right: number; bottom: number };
  /** A phone sheet's: the heading's and the rows' heights as they lay out, and whether the rows
   * scroll (at medium they hold still and the sheet takes the drag). */
  onHeading?: (height: number) => void;
  onRows?: (height: number) => void;
  scrollable?: () => boolean;
  /** How much of the rows' area is under the screen's edge (a bottom sheet at medium): the rows
   * scroll and follow the focus in what shows. */
  hidden?: () => number;
};

/** The title, the note under it and the head (room on the right for the ✕ where there is one). */
function Heading(props: BodyProps) {
  return (
    <View style={{ gap: u(6), paddingRight: frame().panel === "tv" ? 0 : 40 }}>
      <If when={props.title}>
        <Text style={sectionTitle()}>{props.title!()}</Text>
      </If>
      <If when={props.note?.()}>
        <Text style={metaText()}>{props.note!()}</Text>
      </If>
      <If when={props.head}>{props.head!()}</If>
    </View>
  );
}

function Body(props: BodyProps) {
  /** The drawer keeps the focused row in its upper third. */
  const list = scroller({ anchor: (viewport) => viewport / 3 });
  const inset = () => props.inset?.() ?? { top: 0, right: 0, bottom: 0 };
  /** The heading stays put and only the rows scroll: on a phone, and under a head (a switch, the seasons). */
  const pinned = phone() || !!props.head;
  return (
    <View style={{ flex: 1, paddingTop: inset().top, paddingRight: inset().right }}>
    <If when={pinned}>
      <View style={{ ...contentStyle(), paddingBottom: 12 }} onLayout={(e) => props.onHeading?.(e.bounds.size.height)}>
        <Heading {...props} />
      </View>
    </If>
    <Scroller ctl={list} style={{ flex: 1 }} onContent={props.onRows} scrollable={props.scrollable}>
      <View style={{ ...contentStyle(), ...(pinned ? { paddingTop: 0 } : null), paddingBottom: (contentStyle().paddingBottom as number) + (props.footer ? 0 : inset().bottom) }}>
        <If when={!pinned}>
          <Heading {...props} />
        </If>
        {props.children(list)}
      </View>
    </Scroller>
    <If when={props.hidden}>
      <View style={{ height: props.hidden!() }} />
    </If>
    <If when={props.footer}>
      <View style={{ ...footerStyle(), paddingBottom: (footerStyle().paddingBottom as number) + inset().bottom }}>
        {props.footer!()}
      </View>
    </If>
    </View>
  );
}

export function Drawer(props: {
  /** Shown (a sheet animates in and out with it). */
  open: () => boolean;
  onClose: () => void;
  /** The title; none where the head says what it is (`label` names it then). */
  title?: () => string;
  /** What a screen reader calls it where no title shows. */
  label?: () => string;
  /** Under the title, fixed: only the rows under it scroll (a switch, the seasons). */
  head?: () => JSX.Element;
  /** On a phone held sideways, a full-height sheet at the right (the player's panels: the
   * bottom sheet would be a strip there). Its safe area and home indicator are kept clear. */
  sideways?: boolean;
  /** A line under the title. */
  note?: () => string;
  /** The TV panel's width, TV pixels (640 for a list of choices). */
  tvWidth?: number;
  /** Test ids: `<id>-panel`, `<id>-backdrop`, `<id>-sheet`. */
  id: string;
  /** The rows; `list` follows the focus (`list.follow`). */
  children: (list: ScrollCtl) => JSX.Element;
  /** Fixed at the foot, under the rows: always in view (a Save button). */
  footer?: () => JSX.Element;
}) {
  const close = () => props.open() && props.onClose();
  const place = (): Place => (props.sideways && phoneSideways() ? "side" : frame().panel);
  // The layout changed under an open drawer (a tablet's window resized across a phone's width):
  // it closes, since a sheet open at one place does not move to another (it went unseen and
  // still took Back). Its page, laid out again, opens it closed: the new drawer finds the old
  // place it was open at.
  let openAt: PanelPlace | null = null;
  effect(() => {
    const panel = frame().panel;
    if (!props.open()) {
      if (openAt) openOn.delete(props.id);
      openAt = null;
      return;
    }
    const was = openAt ?? openOn.get(props.id);
    openAt = panel;
    openOn.set(props.id, panel);
    if (was !== undefined && was !== panel) untracked(close);
  });
  // Gone with the layout as it was: kept for the drawer that takes its place; else forgotten.
  cleanup(() => {
    if (openAt && openAt === untracked(() => frame().panel)) openOn.delete(props.id);
  });
  const inset = () => insets(place());
  const bottom = () => place() === "bottom-sheet";
  /** Drawn in place, not as a Sheet: the turned player's (`surface`). */
  const inPlace = () => place() === "side" && surfaceTurned();
  /** The in-place panel's way in: from beyond the box's right edge. */
  const slide = createAnimatedValue(0);
  effect(() => {
    if (!inPlace() || !props.open()) return;
    untracked(() => {
      if (reduceMotion()) return slide.set(0);
      slide.set(SIDE_WIDTH + sideSafeArea().right);
      void slide.timing(0, { duration: SLIDE_MS, easing: "easeOut" });
    });
  });
  // A bottom sheet's detents: its parts as they lay out, the rows at the longest they have been
  // since it opened (a switch to a shorter list does not drop it). It opens at the height its rows
  // had last time (the detents set before it comes in: a change while it comes in would land it
  // at the old one first); a drawer opened the first time guesses a long list until they measure.
  const heading = signal(0);
  const remembered = () => `${props.id}:${props.title?.() ?? ""}`;
  const rows = signal(lastRows.get(untracked(remembered)) ?? 0);
  const foot = signal(0);
  const expanded = signal(false);
  /** The rows' first height since it opened replaces the remembered one. */
  let fresh = true;
  effect(() => {
    if (!props.open()) return;
    fresh = true;
    untracked(() => rows.set(lastRows.get(remembered()) ?? 0));
    expanded.set(false);
  });
  const measuredRows = (h: number) => {
    const next = fresh ? h : Math.max(rows(), h);
    fresh = false;
    lastRows.set(untracked(remembered), next);
    rows.set(next);
  };
  const natural = () => GRABBER_ROOM + heading() + rows() + foot();
  const medium = () => Math.min(room(), surfaceSize().height * MEDIUM);
  const large = () => Math.min(room(), surfaceSize().height * LARGE, rows() === 0 ? Infinity : natural());
  /** Much taller than the medium height (or not measured yet): two detents. */
  const long = () => rows() === 0 || natural() > medium() * MEDIUM_SLACK;
  const detents = (): SheetDetent[] => (long() ? [{ height: medium() }, { height: large() }] : [{ height: Math.min(natural(), room()) }]);
  const detent = (): SheetDetent | undefined => (long() ? { height: expanded() ? large() : medium() } : undefined);
  /** It stands at its largest detent: large, or the keyboard is up. */
  const top = () => !long() || expanded() || keyboardUp();
  /** At medium the rows hold still (a drag on them moves the sheet) and end at the screen's edge. */
  const hidden = () => (top() ? 0 : Math.max(0, large() - medium()));
  /** A bottom sheet's foot: NSH keeps it at the bottom of what shows, at every detent. */
  const sheetFooter = () => (
    <View style={{ ...footerStyle(), paddingBottom: (footerStyle().paddingBottom as number) + surfaceInsets().bottom, backgroundColor: colors.card() }}
      onLayout={(e) => foot.set(e.bounds.size.height)}>
      {props.footer!()}
    </View>
  );
  return (
    <If
      when={frame().panel !== "tv"}
      else={
        <If when={props.open()}>
          {[
            <Pressable feedback="none" testID={`${props.id}-backdrop`} style={tvBackdrop()} onPress={close} />,
            <View testID={`${props.id}-panel`} style={tvPanel(props.tvWidth ?? 640)}>
              <Body title={props.title} note={props.note} head={props.head} footer={props.footer}>{props.children}</Body>
            </View>,
          ]}
        </If>
      }
    >
      <If when={!inPlace()} else={
        <If when={props.open()}>
          {[
            <Pressable feedback="none" testID={`${props.id}-backdrop`} style={tvBackdrop()} onPress={close} />,
            <View testID={`${props.id}-panel`} accessibilityLabel={props.title?.() ?? props.label?.()}
              style={{ ...inPlaceStyle(), transform: [{ translateX: slide }] }}>
              <CloseButton id={props.id} onPress={close} place="side" />
              <Body title={props.title} note={props.note} head={props.head} footer={props.footer} inset={inset} onHeading={heading.set}>
                {props.children}
              </Body>
            </View>,
          ]}
        </If>
      }>
      <Sheet
        testID={`${props.id}-sheet`}
        open={props.open()}
        side={bottom() ? "bottom" : "right"}
        closeOnSwipe={bottom()}
        // Back (Escape, Android's back) closes it: the top overlay takes the key.
        closeOnEscape
        onOpenChange={(e) => !e.open && close()}
        detents={bottom() ? detents() : undefined}
        detent={bottom() ? detent() : undefined}
        // Heights come back as the core keeps them (32-bit): the larger one is large.
        onDetentChange={(e) => expanded.set(long() && ((e.detent as { height?: number }).height ?? 0) > medium() + 1)}
        footer={bottom() && props.footer ? sheetFooter() : undefined}
        // The dialog's name for screen readers.
        accessibilityLabel={props.title?.() ?? props.label?.()}
        popupStyle={sheetStyle(place())}
        backdropStyle={{ backgroundColor: veil() }}
      >
        <View testID={`${props.id}-panel`} style={{ flex: 1, ...underControls() }}>
          <If when={bottom()}>
            {/* A long list's: pressed, it goes to the other detent; screen readers adjust it. A
                short list's only shows it can be dragged down. */}
            <If when={long()} else={<View testID={`${props.id}-grabber`} style={grabberArea()}><View style={grabberStyle()} /></View>}>
              <Pressable feedback="none" testID={`${props.id}-grabber`} role="adjustable"
                accessibilityLabel={t(expanded() ? "player.collapse_sheet" : "player.expand_sheet")}
                accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
                onAccessibilityAction={(e) => expanded.set(e.actionName === "increment")}
                hitSlop={{ bottom: props.head ? HEAD_ROOM : GRABBER_REACH - GRABBER_ROOM }} onPress={() => expanded.set(!expanded())} style={{ ...grabberArea(), zIndex: 1 }}>
                <View style={grabberStyle()} />
              </Pressable>
            </If>
          </If>
          <CloseButton id={props.id} onPress={close} place={place()} />
          <Body title={props.title} note={props.note} head={props.head} footer={bottom() ? undefined : props.footer}
            inset={() => (bottom() && props.footer ? { top: 0, right: 0, bottom: 0 } : inset())}
            onHeading={heading.set} onRows={bottom() ? measuredRows : undefined}
            scrollable={bottom() ? top : undefined} hidden={bottom() ? hidden : undefined}>
            {props.children}
          </Body>
        </View>
      </Sheet>
      </If>
    </If>
  );
}
