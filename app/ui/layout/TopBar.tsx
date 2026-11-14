// The top of a deep page where the page draws it itself. A TV has no Back on
// screen (the remote's key), a desktop has it in the window bar, a tablet in
// its top row; a phone's title has a back disc over its hero.
import { safeArea, Text, View, type ViewStyle } from "nsh";
import { t } from "nsh/i18n";
import backIcon from "../icons/back.svg";
import { Icon } from "../kit/Icon";
import { rounded } from "../kit/shape";
import { pageTitle } from "../kit/text";
import { alpha, colors, u } from "../theme";
import { chrome, isTouch } from "./chrome";

/** The phone's discs over a hero, points: 40 across (a 44 touch area), 16 in from the edge, 4 under the status bar. */
const DISC = 40;
export const discCorner = (side: "left" | "right"): ViewStyle => ({ position: "absolute", top: safeArea().top + 4, [side]: 16, zIndex: 3 });
const discStyle = (): ViewStyle => ({
  width: DISC,
  height: DISC,
  ...rounded(999),
  alignItems: "center",
  justifyContent: "center",
  backgroundColor: alpha(colors.card(), 0.78),
});

/** The phone's back disc over a title's hero. */
export function FloatingBack(props: { onPress: () => void }) {
  return (
    <If when={chrome === "phone"}>
      <View style={discCorner("left")}>
        {/* Its touch area is 44 points. */}
        <View role="button" accessibilityLabel={t("nav.back")} onPress={props.onPress} hitSlop={2} style={discStyle()}>
          <Icon src={() => backIcon} size={20 / u(1)} />
        </View>
      </View>
    </If>
  );
}

/** A deep page's title (About), where no system header shows it (touch has one). */
export function PageHeader(props: { title: () => string }) {
  return (
    <If when={!isTouch}>
      <Text style={pageTitle()}>{props.title()}</Text>
    </If>
  );
}
