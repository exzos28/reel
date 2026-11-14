// The top of a screen without the nav: the back button in the safe area's
// top-left corner, alone over a hero or beside the page's title. On a Mac it
// sits in the title bar instead, beside the traffic lights (TitleBarBack).
import { Text, View, type ViewStyle } from "nsh";
import { titleBar } from "nsh/desktop";
import { t } from "nsh/i18n";
import backIcon from "../icons/back.svg";
import { IconButton } from "../kit/IconButton";
import { row } from "../kit/shape";
import { pageTitle } from "../kit/text";
import { safe, u } from "../theme";
import { BackButton } from "./BackButton";
import { chrome } from "./chrome";

const cornerStyle = (): ViewStyle => ({ position: "absolute", top: safe().y, left: safe().x, zIndex: 3 });

/** On a Mac Back is in the title bar, not on the screens. */
export const backInTitleBar = chrome === "mac";

/** The Mac's title bar is this tall (points), the traffic lights centred in it. */
export const TITLE_BAR_HEIGHT = 40;
/** The title bar's back button (points). */
const BAR_BUTTON = 28;
/** Space between the traffic lights and the button (points). */
const BAR_GAP = 6;

const barButtonStyle = (): ViewStyle => ({
  position: "absolute",
  top: (titleBar().height - BAR_BUTTON) / 2,
  left: titleBar().left + BAR_GAP,
  zIndex: 11,
});

/** The Mac's back button in the title bar, right of the traffic lights. */
export function TitleBarBack(props: { onPress: () => void }) {
  return (
    <View style={barButtonStyle()}>
      <IconButton
        icon={() => backIcon}
        label={() => t("nav.back")}
        focused={() => false}
        onPress={props.onPress}
        size={BAR_BUTTON / u(1)}
      />
    </View>
  );
}

/** The back button floating over a hero (none on a Mac: it is in the title bar). */
export function FloatingBack(props: { focused: () => boolean; onPress: () => void }) {
  return (
    <If when={!backInTitleBar}>
      <View style={cornerStyle()}>
        <BackButton focused={props.focused} onPress={props.onPress} />
      </View>
    </If>
  );
}

/** The back button, then the page's title, aligned to the top. A TV has no
 * Back on screen (the remote's key), a Mac has it in the title bar. */
export function PageHeader(props: { title: () => string; focused: () => boolean; onBack: () => void }) {
  return (
    <View style={row(u(24), "flex-start")}>
      <If when={!backInTitleBar && chrome !== "tv"}>
        <BackButton focused={props.focused} onPress={props.onBack} />
      </If>
      <Text style={pageTitle()}>{props.title()}</Text>
    </View>
  );
}
