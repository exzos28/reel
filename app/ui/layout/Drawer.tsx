// A drawer: a panel over the page with a title (and a note under it) and a list,
// the one shape every side panel of reel takes (releases, filters, choices such as
// the language). Where it sits is the platform's (design/navigation.md, "Panels"):
// - TV: at the right, the full height, no ✕ (the remote's Back closes it);
// - desktop: an NSH Sheet at the right, over the window bar, the full height, with ✕;
// - tablet: a floating sheet at the right, with ✕;
// - phone: a sheet from the bottom, with a grabber (swiped down to close) and ✕; held sideways,
//   a drawer that asks for it (`sideways`: the player's) is a full-height sheet at the right.
// Back (through the page's closer, or the sheet's Escape), ✕ or a press outside
// closes it.
//
// The TV keeps reel's own panel: on Android (Android TV), after an NSH Sheet has
// been open, Escape (the remote's Back in the tests) no longer reached the app's key
// bindings in a headless run, and the remote must always reach Back.
import { safeArea, Text, View, type JSX, type ViewStyle } from "nsh";
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

/** Where this drawer sits: `side` for a sideways phone's (`sideways` asked for). */
type Place = "tv" | "side-sheet" | "floating-sheet" | "bottom-sheet" | "side";

function sheetStyle(place: Place): ViewStyle {
  if (place === "side")
    return { width: SIDE_WIDTH + safeArea().right, backgroundColor: colors.card(), borderTopLeftRadius: 22, borderBottomLeftRadius: 22, borderCurve: "continuous" };
  if (place === "bottom-sheet")
    return { height: "60%", backgroundColor: colors.card(), borderTopLeftRadius: 22, borderTopRightRadius: 22, borderCurve: "continuous" };
  if (frame.panel === "floating-sheet") return { width: 440, margin: 12, backgroundColor: colors.card(), ...rounded(22) };
  // A desktop's: over everything, the window bar too, the full height.
  return { width: 460, backgroundColor: colors.card(), borderLeftWidth: 1, borderLeftColor: alpha(colors.snow(), 0.08) };
}
/** A desktop drawer runs up over the window bar: where the system's window controls sit at the
 * bar's right end (Windows, GTK), its ✕ and title start under them instead of beneath them. */
const controlsRoom = () => (frame.panel === "side-sheet" && titleBar().right > 0 ? titleBar().height : 0);
const underControls = (): ViewStyle => ({ paddingTop: controlsRoom() });
const grabberStyle = (): ViewStyle => ({ width: 36, height: 5, borderRadius: 3, alignSelf: "center", backgroundColor: "#4A4A4A", marginTop: 8 });
/** The system's insets inside a sheet that has them on its sides: a sideways phone's (the notch
 * side, the home indicator), and the home indicator under a bottom sheet that asks (`sideways`). */
const insets = (place: Place, own: boolean) =>
  place === "side" ? { top: safeArea().top, right: safeArea().right, bottom: safeArea().bottom }
  : place === "bottom-sheet" && own ? { top: 0, right: 0, bottom: safeArea().bottom }
  : { top: 0, right: 0, bottom: 0 };
const closeStyle = (place: Place, own: boolean): ViewStyle => ({
  position: "absolute",
  top: (place === "bottom-sheet" ? 18 : 14) + controlsRoom() + insets(place, own).top,
  right: 14 + insets(place, own).right,
  width: 30,
  height: 30,
  ...rounded(999),
  alignItems: "center",
  justifyContent: "center",
  backgroundColor: colors.raise(),
  zIndex: 2,
});
const contentStyle = (): ViewStyle =>
  frame.panel === "tv"
    ? { paddingHorizontal: u(48), paddingTop: safe().y, paddingBottom: safe().y, gap: u(20) }
    : { paddingHorizontal: 16, paddingTop: frame.panel === "bottom-sheet" ? 8 : 16, paddingBottom: 24, gap: 12 };

/** ✕: the plus turned a quarter. */
function CloseButton(props: { onPress: () => void; place: Place; own: boolean; id: string }) {
  return (
    <Pressable testID={`${props.id}-close`} role="button" hitSlop={targetSlop(30)} accessibilityLabel={t("player.close")} onPress={props.onPress} style={closeStyle(props.place, props.own)}>
      <View style={{ transform: "rotate(45deg)" }}>
        <Icon src={() => closeIcon} size={iconPt(14)} />
      </View>
    </Pressable>
  );
}

/** What stays at the drawer's foot under the scrolling rows (its main action). */
const footerStyle = (): ViewStyle => ({
  ...(frame.panel === "tv"
    ? { paddingHorizontal: u(48), paddingTop: u(20), paddingBottom: safe().y, gap: u(12) }
    : { paddingHorizontal: 16, paddingTop: 12, paddingBottom: frame.panel === "bottom-sheet" ? 28 : 16, gap: 10 }),
  borderTopWidth: 1,
  borderTopColor: alpha(colors.snow(), 0.08),
});

type BodyProps = {
  title?: () => string;
  note?: () => string;
  head?: () => JSX.Element;
  children: (list: ScrollCtl) => JSX.Element;
  footer?: () => JSX.Element;
  /** The sheet's insets (a sideways phone's safe area). */
  inset?: () => { top: number; right: number; bottom: number };
};

/** The title, the note under it and the head (room on the right for the ✕ where there is one). */
function Heading(props: BodyProps) {
  return (
    <View style={{ gap: u(6), paddingRight: frame.panel === "tv" ? 0 : 40 }}>
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
  return (
    <View style={{ flex: 1, paddingTop: inset().top, paddingRight: inset().right }}>
    {/* With a head (a switch, the seasons) the heading stays put and only the rows scroll. */}
    <If when={props.head}>
      <View style={{ ...contentStyle(), paddingBottom: 12 }}>
        <Heading {...props} />
      </View>
    </If>
    <Scroller ctl={list} style={{ flex: 1 }}>
      <View style={{ ...contentStyle(), ...(props.head ? { paddingTop: 0 } : null), paddingBottom: (contentStyle().paddingBottom as number) + (props.footer ? 0 : inset().bottom) }}>
        <If when={!props.head}>
          <Heading {...props} />
        </If>
        {props.children(list)}
      </View>
    </Scroller>
    <If when={props.footer}>
      <View style={footerStyle()}>{props.footer!()}</View>
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
  const place = (): Place => (props.sideways && phoneSideways() ? "side" : frame.panel);
  const own = !!props.sideways;
  const inset = () => insets(place(), own);
  return (
    <If
      when={frame.panel !== "tv"}
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
        popupStyle={sheetStyle(place())}
        backdropStyle={{ backgroundColor: veil() }}
      >
        <View testID={`${props.id}-panel`} accessibilityLabel={props.title ? undefined : props.label?.()} style={{ flex: 1, ...underControls() }}>
          <If when={place() === "bottom-sheet"}>
            <View testID={`${props.id}-grabber`} style={grabberStyle()} />
          </If>
          <CloseButton id={props.id} onPress={close} place={place()} own={own} />
          <Body title={props.title} note={props.note} head={props.head} footer={props.footer} inset={inset}>{props.children}</Body>
        </View>
      </Sheet>
    </If>
  );
}
