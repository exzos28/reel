// What shows while something loads, as Settings says (`preferences.loader`): the running
// dinosaur, or the red "reel" logotype breathing in and out. Screens use this, never a loader
// of their own, so the setting reaches every one at once. With reduced motion both stand still.
import { reduceMotion, Text, View, type TextStyle, type ViewStyle } from "nsh";
import { t } from "nsh/i18n";
import { loader } from "../preferences";
import { colors, font, ts, u } from "../theme";
import { DinoLoader } from "./DinoLoader";

/** One breath of the logotype, ms. */
const BLINK_MS = 1400;

const blinkStyle = (): ViewStyle =>
  reduceMotion()
    ? {}
    : { animationName: "pulse", animationDuration: BLINK_MS, animationTimingFunction: "ease-in-out", animationIterationCount: "infinite", animationFrameRate: 30 };
/** The nav's logotype, larger: about the dinosaur's width. */
const logoStyle = (size: number): TextStyle => ({ fontFamily: font, fontSize: ts(size * 0.6), fontWeight: 700, letterSpacing: -u(0.8), color: colors.red() });

/** The blinking "reel"; `size`: about its width, TV pixels. */
function LogoLoader(props: { size: number; label?: string }) {
  return (
    <View testID="loader-logo" accessibilityLabel={props.label} style={{ alignItems: "center", ...blinkStyle() }}>
      <Text style={logoStyle(props.size)}>{t("app.name")}</Text>
    </View>
  );
}

/** `size`: its width, TV pixels (96 by default); `label`: what a screen reader says. */
export function Loader(props: { size?: number; label?: string }) {
  const size = props.size ?? 96;
  return (
    <If when={loader() === "logo"} else={<DinoLoader size={size} label={props.label} />}>
      <LogoLoader size={size} label={props.label} />
    </If>
  );
}
