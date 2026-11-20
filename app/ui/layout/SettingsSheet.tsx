// A tablet's Settings (design/navigation.md, "Tablet"): a sheet in the middle of the window over
// the page the viewer is on, never a page of a tab's stack. It has its own pages: Settings, then
// Interface or About on it, with ‹ back to Settings in its head; ✕, a press outside it, Escape
// and the system's back close it (Back first leaves Interface or About). It is reel's own view in
// the app's tree, not a system dialog, so the drawers Settings opens (a setting's choices, the
// search source) come over it.
import { safeArea, Text, View, windowSize, type JSX, type TextStyle, type ViewStyle } from "nsh";
import { t } from "nsh/i18n";
import backIcon from "../icons/back.svg";
import closeIcon from "../icons/plus.svg";
import { Icon } from "../kit/Icon";
import { Pressable } from "../kit/Pressable";
import { rounded, row } from "../kit/shape";
import { closeSettings, onBack, sheet, type Route } from "../nav";
import { alpha, colors, font, iconPt, targetSlop } from "../theme";
import { InSheet, PageRoute } from "./frameState";

/** The sheet's size, points: iPad's form sheet, smaller in a window that has less room. */
const WIDTH = 540;
const HEIGHT = 640;
/** Room kept around it in a small window, points. */
const MARGIN = 24;
/** Its head: ‹, the page's title, ✕. */
const HEAD = 56;
/** ‹ and ✕: discs this wide, with a 44 pt touch area. */
const DISC = 36;

const backdropStyle = (): ViewStyle => ({
  position: "absolute",
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  zIndex: 30,
  alignItems: "center",
  justifyContent: "center",
  backgroundColor: alpha(colors.ink(), 0.6),
});
const veilStyle: ViewStyle = { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 };
function cardStyle(): ViewStyle {
  const w = windowSize();
  const a = safeArea();
  return {
    width: Math.min(WIDTH, w.width - 2 * MARGIN),
    height: Math.min(HEIGHT, w.height - a.top - a.bottom - 2 * MARGIN),
    marginTop: a.top - a.bottom,
    overflow: "hidden",
    ...rounded(22),
    backgroundColor: colors.ink(),
    borderWidth: 1,
    borderColor: colors.card(),
  };
}
const headStyle = (): ViewStyle => ({ ...row(0), height: HEAD, paddingHorizontal: 10, borderBottomWidth: 1, borderBottomColor: colors.card() });
const headTitle = (): TextStyle => ({ flex: 1, textAlign: "center", numberOfLines: 1, fontFamily: font, fontSize: 17, fontWeight: 600, color: colors.snow() });
const discStyle = (): ViewStyle => ({ width: DISC, height: DISC, ...rounded(999), alignItems: "center", justifyContent: "center", backgroundColor: colors.card() });
/** Where ‹ would be on Settings itself: the title stays centred. */
const slotStyle: ViewStyle = { width: DISC, height: DISC };

/** What a page of the sheet is called (its head's title, and ‹'s "Back to …"). */
const titleOf = (r: Route | undefined) => (r?.name === "about" || r?.name === "interface" ? t(`settings.${r.name}.title`) : t("settings.title"));

function Head() {
  const pages = () => sheet();
  const deeper = () => pages().length > 1;
  return (
    <View style={headStyle()}>
      <If when={deeper()} else={<View style={slotStyle} />}>
        <Pressable
          testID="settings-sheet-back"
          role="button"
          accessibilityLabel={t("nav.back_to", { page: titleOf(pages()[pages().length - 2]) })}
          hitSlop={targetSlop(DISC)}
          onPress={handleSheetBack}
          style={discStyle()}
        >
          <Icon src={() => backIcon} size={iconPt(16)} />
        </Pressable>
      </If>
      <Text role="header" style={headTitle()}>
        {titleOf(pages()[pages().length - 1])}
      </Text>
      <Pressable testID="settings-sheet-close" role="button" accessibilityLabel={t("player.close")} hitSlop={targetSlop(DISC)} onPress={closeSettings} style={discStyle()}>
        <View style={{ transform: "rotate(45deg)" }}>
          <Icon src={() => closeIcon} size={iconPt(14)} />
        </View>
      </Pressable>
    </View>
  );
}

function Sheet(props: { page: (r: Route) => JSX.Element }) {
  // Back (Escape, the system's back) leaves a page of the sheet, then closes it, before the page
  // under it hears it; what the Settings page opens (a setting's choices) is newer and goes first.
  onBack(() => (handleSheetBack(), true));
  const top = () => sheet()[sheet().length - 1];
  return (
    <View testID="settings-sheet" style={backdropStyle()}>
      {/* A press outside the sheet closes it. */}
      <Pressable feedback="none" testID="settings-sheet-backdrop" accessibilityElementsHidden onPress={closeSettings} style={veilStyle} />
      <View role="dialog" accessibilityLabel={t("settings.title")} style={cardStyle()}>
        <Head />
        <InSheet.Provider value={true}>
          <Each of={top() ? [top()!] : []} key={(r) => r}>
            {(r) => <PageRoute.Provider value={r()}>{props.page(r())}</PageRoute.Provider>}
          </Each>
        </InSheet.Provider>
      </View>
    </View>
  );
}

/** One page back on the sheet; from Settings, closed. */
function handleSheetBack() {
  sheet.set(sheet().slice(0, -1));
}

export function SettingsSheet(props: { page: (r: Route) => JSX.Element }) {
  return (
    <If when={sheet().length > 0}>
      <Sheet page={props.page} />
    </If>
  );
}
