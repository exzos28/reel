// The releases of what Play starts (the film, or the show's episode), in a
// panel (design/navigation.md, "Panels"): on a TV a 1080 px panel at the
// right, no close button; elsewhere an NSH Sheet: at the right on a desktop
// (460 pt under the window bar) and a tablet (a floating 440 pt sheet), at
// the bottom on a phone (a grabber, swiped down to close), each with ✕. The
// short list, Show more for the rest. OK or a tap on one makes it the one
// Play uses; Back, ✕ or a press outside closes it.
//
// The TV keeps reel's own panel: on Android (Android TV), after an NSH Sheet
// has been open, Escape (the remote's Back in the tests) no longer reaches the
// app's key bindings in a headless run, and the remote must always reach Back.
// On a Mac it does (App.test.tsx).
import { Text, View, type ViewStyle } from "nsh";
import { Sheet } from "nsh/base";
import { t } from "nsh/i18n";
import type { Release } from "../../catalog";
import { Icon } from "../../kit/Icon";
import { rounded } from "../../kit/shape";
import { bodyText } from "../../kit/text";
import { chrome } from "../../layout/chrome";
import { scroller, Scroller } from "../../layout/Scroller";
import { BAR_HEIGHT } from "../../layout/WindowBar";
import { alpha, colors, safe, u } from "../../theme";
import closeIcon from "../../icons/plus.svg";
import { ReleaseList } from "./ReleaseList";

type Props = {
  /** Shown. */
  open: () => boolean;
  title: () => string;
  header: () => string;
  /** A line over the list (why it opened), empty for none. */
  message?: () => string;
  releases: () => Release[];
  loading: () => boolean;
  more: () => number;
  onMore: () => void;
  focusedAt: () => number;
  onPress: (i: number) => void;
  onClose: () => void;
};

const veil = () => alpha(colors.ink(), 0.6);

// ---- TV ------------------------------------------------------------------

const tvBackdrop = (): ViewStyle => ({ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: 20, backgroundColor: veil() });
const tvPanel = (): ViewStyle => ({
  position: "absolute", top: 0, right: 0, bottom: 0, width: u(1080), zIndex: 21,
  backgroundColor: colors.ink(), borderLeftWidth: 1, borderLeftColor: alpha(colors.snow(), 0.08),
  boxShadow: `${-u(30)}px 0 ${u(60)}px ${alpha(colors.ink(), 0.8)}`,
});

// ---- Desktop, tablet, phone ---------------------------------------------

function sheetStyle(): ViewStyle {
  if (chrome === "phone")
    return { height: "60%", backgroundColor: colors.card(), borderTopLeftRadius: 22, borderTopRightRadius: 22, borderCurve: "continuous" };
  if (chrome === "tablet") return { width: 440, margin: 12, backgroundColor: colors.card(), ...rounded(22) };
  // A desktop's, under the window bar, which stays usable.
  return { width: 460, marginTop: BAR_HEIGHT, backgroundColor: colors.card(), borderTopLeftRadius: 14, borderCurve: "continuous" };
}
const grabberStyle = (): ViewStyle => ({ width: 36, height: 5, borderRadius: 3, alignSelf: "center", backgroundColor: "#4A4A4A", marginTop: 8 });
const closeStyle = (): ViewStyle => ({
  position: "absolute",
  top: chrome === "phone" ? 18 : 14,
  right: 14,
  width: 30,
  height: 30,
  ...rounded(999),
  alignItems: "center",
  justifyContent: "center",
  backgroundColor: colors.raise(),
  zIndex: 2,
});

/** ✕: the plus turned a quarter, the sheet's close button. */
function CloseButton(props: { onPress: () => void }) {
  return (
    <View role="button" accessibilityLabel={t("player.close")} onPress={props.onPress} style={closeStyle()}>
      <View style={{ transform: "rotate(45deg)" }}>
        <Icon src={() => closeIcon} size={14 / u(1)} />
      </View>
    </View>
  );
}

// ---- The list ------------------------------------------------------------

const contentStyle = (): ViewStyle =>
  chrome === "tv"
    ? { paddingHorizontal: u(48), paddingTop: safe().y, paddingBottom: safe().y, gap: u(24) }
    : { paddingHorizontal: 16, paddingTop: chrome === "phone" ? 8 : 16, paddingBottom: 24, gap: 12 };

function Body(props: Props) {
  /** The panel keeps the focused row in its upper third. */
  const list = scroller({ anchor: (viewport) => viewport / 3 });
  return (
    <Scroller ctl={list} style={{ flex: 1 }}>
      <View style={contentStyle()}>
        <If when={props.message?.()}>
          <Text style={{ ...bodyText(colors.snow()), maxWidth: u(900) }}>{props.message!()}</Text>
        </If>
        <ReleaseList
          inPanel
          title={props.title}
          header={props.header}
          releases={props.releases}
          loading={props.loading}
          more={props.more}
          onMore={props.onMore}
          focused={(i) => props.focusedAt() === i}
          follow={list.follow}
          onPress={props.onPress}
        />
      </View>
    </Scroller>
  );
}

export function ReleasePanel(props: Props) {
  const close = () => props.open() && props.onClose();
  return (
    <If
      when={chrome !== "tv"}
      else={
        // Back closes it through the title screen's closer.
        <If when={props.open()}>
          {[
            <View testID="releases-backdrop" style={tvBackdrop()} onPress={close} />,
            <View testID="releases-panel" style={tvPanel()}>
              <Body {...props} />
            </View>,
          ]}
        </If>
      }
    >
      <Sheet
        testID="releases-sheet"
        open={props.open()}
        side={chrome === "phone" ? "bottom" : "right"}
        closeOnSwipe={chrome === "phone"}
        // Back (Escape, Android's back) closes it: the top overlay takes the key.
        closeOnEscape
        onOpenChange={(e) => !e.open && close()}
        popupStyle={sheetStyle()}
        backdropStyle={{ backgroundColor: veil() }}
      >
        <View testID="releases-panel" style={{ flex: 1 }}>
          <If when={chrome === "phone"}>
            <View style={grabberStyle()} />
          </If>
          <CloseButton onPress={close} />
          <Body {...props} />
        </View>
      </Sheet>
    </If>
  );
}
