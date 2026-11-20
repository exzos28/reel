// A drawer: a panel over the page with a title (and a note under it) and a list,
// the one shape every side panel of reel takes (releases, filters, choices such as
// the language). Where it sits is the platform's (design/navigation.md, "Panels"):
// - TV: at the right, the full height, no ✕ (the remote's Back closes it);
// - desktop: an NSH Sheet at the right, over the window bar, the full height, with ✕;
// - tablet: a floating sheet at the right, with ✕;
// - phone: a sheet from the bottom, with a grabber (swiped down to close) and ✕.
// Back (through the page's closer, or the sheet's Escape), ✕ or a press outside
// closes it.
//
// The TV keeps reel's own panel: on Android (Android TV), after an NSH Sheet has
// been open, Escape (the remote's Back in the tests) no longer reached the app's key
// bindings in a headless run, and the remote must always reach Back.
import { Text, View, type JSX, type ViewStyle } from "nsh";
import { Sheet } from "nsh/base";
import { titleBar } from "../platform/titlebar";
import { t } from "nsh/i18n";
import { Icon } from "../kit/Icon";
import { rounded } from "../kit/shape";
import { metaText, sectionTitle } from "../kit/text";
import { alpha, colors, iconPt, safe, targetSlop, u } from "../theme";
import closeIcon from "../icons/plus.svg";
import { frame } from "./chrome";
import { scroller, Scroller, type ScrollCtl } from "./Scroller";
import { Pressable } from "../kit/Pressable";

const veil = () => alpha(colors.ink(), 0.6);

const tvBackdrop = (): ViewStyle => ({ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: 20, backgroundColor: veil() });
const tvPanel = (width: number): ViewStyle => ({
  position: "absolute", top: 0, right: 0, bottom: 0, width: u(width), zIndex: 21,
  backgroundColor: colors.ink(), borderLeftWidth: 1, borderLeftColor: alpha(colors.snow(), 0.08),
  boxShadow: `${-u(30)}px 0 ${u(60)}px ${alpha(colors.ink(), 0.8)}`,
});

function sheetStyle(): ViewStyle {
  if (frame.panel === "bottom-sheet")
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
const closeStyle = (): ViewStyle => ({
  position: "absolute",
  top: (frame.panel === "bottom-sheet" ? 18 : 14) + controlsRoom(),
  right: 14,
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
function CloseButton(props: { onPress: () => void }) {
  return (
    <Pressable role="button" hitSlop={targetSlop(30)} accessibilityLabel={t("player.close")} onPress={props.onPress} style={closeStyle()}>
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

function Body(props: { title: () => string; note?: () => string; children: (list: ScrollCtl) => JSX.Element; footer?: () => JSX.Element }) {
  /** The drawer keeps the focused row in its upper third. */
  const list = scroller({ anchor: (viewport) => viewport / 3 });
  return (
    <View style={{ flex: 1 }}>
    <Scroller ctl={list} style={{ flex: 1 }}>
      <View style={contentStyle()}>
        {/* Room on the right for the ✕ where there is one. */}
        <View style={{ gap: u(6), paddingRight: frame.panel === "tv" ? 0 : 40 }}>
          <Text style={sectionTitle()}>{props.title()}</Text>
          <If when={props.note?.()}>
            <Text style={metaText()}>{props.note!()}</Text>
          </If>
        </View>
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
  title: () => string;
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
  return (
    <If
      when={frame.panel !== "tv"}
      else={
        <If when={props.open()}>
          {[
            <Pressable feedback="none" testID={`${props.id}-backdrop`} style={tvBackdrop()} onPress={close} />,
            <View testID={`${props.id}-panel`} style={tvPanel(props.tvWidth ?? 640)}>
              <Body title={props.title} note={props.note} footer={props.footer}>{props.children}</Body>
            </View>,
          ]}
        </If>
      }
    >
      <Sheet
        testID={`${props.id}-sheet`}
        open={props.open()}
        side={frame.panel === "bottom-sheet" ? "bottom" : "right"}
        closeOnSwipe={frame.panel === "bottom-sheet"}
        // Back (Escape, Android's back) closes it: the top overlay takes the key.
        closeOnEscape
        onOpenChange={(e) => !e.open && close()}
        popupStyle={sheetStyle()}
        backdropStyle={{ backgroundColor: veil() }}
      >
        <View testID={`${props.id}-panel`} style={{ flex: 1, ...underControls() }}>
          <If when={frame.panel === "bottom-sheet"}>
            <View style={grabberStyle()} />
          </If>
          <CloseButton onPress={close} />
          <Body title={props.title} note={props.note} footer={props.footer}>{props.children}</Body>
        </View>
      </Sheet>
    </If>
  );
}
