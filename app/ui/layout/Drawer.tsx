// A drawer: a panel over the page with a title (and a note under it) and a list,
// the one shape every side panel of reel takes (releases, filters, choices such as
// the language). Where it sits is the platform's (design/navigation.md, "Panels"):
// - TV: at the right, the full height, no ✕ (the remote's Back closes it);
// - desktop: an NSH Sheet at the right, over the window bar, the full height, with ✕;
// - tablet: a floating sheet at the right, under the status bar, with ✕ (a short list of choices
//   is a popover instead: ChoicePanel);
// - phone: a sheet from the bottom, with a grabber (swiped down to close) and ✕; held sideways,
//   a drawer that asks for it (`sideways`: the player's) is a full-height sheet at the right.
//   Its heading stays put and only the rows scroll under it. From the bottom it is as tall as
//   its rows, up to `MEDIUM` of the screen; a longer list grows to `LARGE` once it is dragged
//   up or its grabber is pressed (iOS's medium and large), and it keeps clear of the home
//   indicator and the keyboard.
// Back (through the page's closer, or the sheet's Escape), ✕ or a press outside
// closes it.
//
// The TV keeps reel's own panel: on Android (Android TV), after an NSH Sheet has
// been open, Escape (the remote's Back in the tests) no longer reached the app's key
// bindings in a headless run, and the remote must always reach Back.
import { effect, keyboardFrame, safeArea, signal, Text, View, windowSize, type JSX, type ViewStyle } from "nsh";
import { Sheet } from "nsh/base";
import { titleBar } from "../platform/titlebar";
import { t } from "nsh/i18n";
import { Icon } from "../kit/Icon";
import { rounded } from "../kit/shape";
import { metaText, sectionTitle } from "../kit/text";
import { alpha, colors, iconPt, safe, targetSlop, u } from "../theme";
import closeIcon from "../icons/plus.svg";
import { frame, phoneSideways } from "./chrome";
import { scroller, Scroller, type ScrollCtl } from "./Scroller";
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
/** The grabber and the room over it, points. */
const GRABBER_ROOM = 13;
/** The keyboard's height over the home indicator: NSH lifts a bottom sheet by it. */
const keyboardLift = () => Math.max(0, keyboardFrame().height - safeArea().bottom);
/** The tallest a bottom sheet gets: under the status bar and over the keyboard. */
const room = () => windowSize().height - safeArea().top - 8 - keyboardLift();

function sheetStyle(place: Place): ViewStyle {
  if (place === "side")
    return { width: SIDE_WIDTH + safeArea().right, backgroundColor: colors.card(), borderTopLeftRadius: 22, borderBottomLeftRadius: 22, borderCurve: "continuous" };
  if (place === "bottom-sheet")
    return { backgroundColor: colors.card(), borderTopLeftRadius: 22, borderTopRightRadius: 22, borderCurve: "continuous" };
  // A tablet's: clear of the status bar and the home indicator; in portrait under half the screen.
  if (frame().panel === "floating-sheet")
    return {
      width: Math.min(FLOAT_WIDTH, windowSize().width * FLOAT_SHARE),
      margin: FLOAT_MARGIN,
      marginTop: safeArea().top + FLOAT_MARGIN,
      marginBottom: safeArea().bottom + FLOAT_MARGIN,
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
/** The grabber's press area: the strip over the heading. */
const grabberArea = (): ViewStyle => ({ height: GRABBER_ROOM, justifyContent: "flex-end", alignSelf: "stretch" });
/** The system's insets inside a sheet that has them on its sides: a sideways phone's (the notch
 * side, the home indicator), and the home indicator under a bottom sheet. */
const insets = (place: Place) =>
  place === "side" ? { top: safeArea().top, right: safeArea().right, bottom: safeArea().bottom }
  : place === "bottom-sheet" ? { top: 0, right: 0, bottom: safeArea().bottom }
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
const contentStyle = (): ViewStyle =>
  frame().panel === "tv"
    ? { paddingHorizontal: u(48), paddingTop: safe().y, paddingBottom: safe().y, gap: u(20) }
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
    ? { paddingHorizontal: u(48), paddingTop: u(20), paddingBottom: safe().y, gap: u(12) }
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
  /** A phone sheet's: the heading's, the rows' and the foot's heights as they lay out, and a
   * drag of the rows let go `offset` points down them. */
  onHeading?: (height: number) => void;
  onRows?: (height: number) => void;
  onFooter?: (height: number) => void;
  onDragEnd?: (offset: number) => void;
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
    <Scroller ctl={list} style={{ flex: 1 }} onContent={props.onRows} onDragEnd={props.onDragEnd}>
      <View style={{ ...contentStyle(), ...(pinned ? { paddingTop: 0 } : null), paddingBottom: (contentStyle().paddingBottom as number) + (props.footer ? 0 : inset().bottom) }}>
        <If when={!pinned}>
          <Heading {...props} />
        </If>
        {props.children(list)}
      </View>
    </Scroller>
    <If when={props.footer}>
      <View style={{ ...footerStyle(), paddingBottom: (footerStyle().paddingBottom as number) + inset().bottom }} onLayout={(e) => props.onFooter?.(e.bounds.size.height)}>
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
  const inset = () => insets(place());
  // A bottom sheet's height: its parts as they lay out, the rows at the longest they have been
  // since it opened (a switch to a shorter list does not drop it), up to `MEDIUM` until it grows.
  const heading = signal(0);
  const rows = signal(0);
  const foot = signal(0);
  const expanded = signal(false);
  effect(() => {
    if (!props.open()) return;
    rows.set(0);
    expanded.set(false);
  });
  const natural = () => GRABBER_ROOM + heading() + rows() + foot();
  const medium = () => Math.min(room(), windowSize().height * MEDIUM);
  const large = () => Math.min(room(), windowSize().height * LARGE);
  /** Taller than the medium height: it can grow. */
  const long = () => natural() > medium() + 1;
  const height = () => (rows() === 0 ? medium() : Math.min(natural(), expanded() ? large() : medium()));
  const grow = (offset: number) => offset > 0 && long() && !expanded() && expanded.set(true);
  const sheetHeight = (): ViewStyle =>
    place() === "bottom-sheet" ? { height: height(), transitionProperty: "height", transitionDuration: 250, transitionTimingFunction: "ease-out" } : {};
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
      <Sheet
        testID={`${props.id}-sheet`}
        open={props.open()}
        side={place() === "bottom-sheet" ? "bottom" : "right"}
        closeOnSwipe={place() === "bottom-sheet"}
        // Back (Escape, Android's back) closes it: the top overlay takes the key.
        closeOnEscape
        onOpenChange={(e) => !e.open && close()}
        popupStyle={{ ...sheetStyle(place()), ...sheetHeight() }}
        backdropStyle={{ backgroundColor: veil() }}
      >
        <View testID={`${props.id}-panel`} accessibilityLabel={props.title ? undefined : props.label?.()} style={{ flex: 1, ...underControls() }}>
          <If when={place() === "bottom-sheet"}>
            {/* Pressed, a long list's sheet grows to its large height, or back. */}
            <Pressable feedback="none" testID={`${props.id}-grabber`} role="button" accessibilityLabel={t(expanded() ? "player.collapse_sheet" : "player.expand_sheet")}
              disabled={!long()} hitSlop={{ top: 8, bottom: 8 }} onPress={() => expanded.set(!expanded())} style={grabberArea()}>
              <View style={grabberStyle()} />
            </Pressable>
          </If>
          <CloseButton id={props.id} onPress={close} place={place()} />
          <Body title={props.title} note={props.note} head={props.head} footer={props.footer} inset={inset}
            onHeading={heading.set} onRows={(h) => rows.set(Math.max(rows(), h))} onFooter={foot.set} onDragEnd={grow}>
            {props.children}
          </Body>
        </View>
      </Sheet>
    </If>
  );
}
