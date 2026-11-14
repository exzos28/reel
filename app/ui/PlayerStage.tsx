// The player's waiting states. From Play until the first frame plays (and
// when the film cannot play) the stage fills the screen: the title's still,
// darkened and blurred, its logotype in the middle breathing slowly, one
// calm line from the core and a thin bar of the film's start coming in; an
// error takes the same place, still. Once the film plays, a stall only
// shows a small breathing note over the picture (`BufferingNote`).
import { Image, reduceMotion, Text, View, type TextStyle, type ViewStyle } from "nsh";
import { t } from "nsh/i18n";
import { titleText, type Summary } from "./catalog";
import { cover, rounded } from "./kit/shape";
import { alpha, colors, density, font, safe, type, u } from "./theme";

/** One breath of the logotype and the buffering note, ms. */
export const BREATH_MS = 1600;

/** The stage's line under the title: what the engine does, or what went wrong. */
export interface StageLine {
  text: string;
  /** What to do about an error; null while it is waiting. */
  hint: string | null;
}

const breathe = (on: boolean): ViewStyle =>
  on && !reduceMotion()
    ? { animationName: "pulse", animationDuration: BREATH_MS, animationTimingFunction: "ease-in-out", animationIterationCount: "infinite", animationFrameRate: 30 }
    : {};
const stillStyle = { ...cover(), objectFit: "cover", objectPosition: "center 30%" } as ViewStyle;
const paperStyle = (paper: string): ViewStyle => ({ ...cover(), backgroundColor: paper, opacity: 0.4 });
/** The veil over the still: dark everywhere, darkest at the bottom. */
const veilStyle = (): ViewStyle => ({
  ...cover(),
  backgroundColor: alpha(colors.ink(), 0.62),
  backgroundImage: `linear-gradient(0deg, ${colors.ink()} 0%, ${alpha(colors.ink(), 0)} 45%)`,
});
const centreStyle = (): ViewStyle => ({
  ...cover(), alignItems: "center", justifyContent: "center", paddingHorizontal: safe().x,
});
const logotypeSize = () => (density === "compact" ? 64 : 88);
const logotypeStyle = (): TextStyle => ({
  numberOfLines: 2, ...type.logotype(logotypeSize()), color: colors.snow(), textAlign: "center", maxWidth: u(1400),
});
const subtitleStyle = (): TextStyle => ({ ...type.meta(), color: colors.ash(), textAlign: "center", marginTop: u(14) });
const lineStyle = (error: boolean): TextStyle => ({
  ...type.body(), color: error ? colors.snow() : colors.soft(), textAlign: "center", maxWidth: u(960), marginTop: u(48),
});
const hintStyle = (): TextStyle => ({ ...type.meta(), color: colors.ash(), textAlign: "center", maxWidth: u(900), marginTop: u(12) });
const BAR = 360;
const trackStyle = (): ViewStyle => ({
  width: u(BAR), height: Math.max(2, u(4)), marginTop: u(22), overflow: "hidden", ...rounded(u(2)), backgroundColor: alpha(colors.snow(), 0.16),
});
const fillStyle = (percent: number): ViewStyle => ({
  height: "100%", width: `${percent}%`, backgroundColor: colors.snow(),
  transitionProperty: "all", transitionDuration: 400, transitionTimingFunction: "ease-out",
});
const metaStyle = (): TextStyle => ({ fontFamily: font, fontSize: u(22), color: colors.ash(), textAlign: "center", marginTop: u(16) });

/** The full-screen stage: still, logotype, the line, the bar. */
export function PlayerStage(props: {
  item: () => Summary;
  /** The episode or the release under the title. */
  subtitle: () => string;
  line: () => StageLine;
  /** Percent of the start in; null hides the bar (an error). */
  progress: () => number | null;
  /** Speed and people, when known. */
  meta: () => string;
}) {
  const s = props.item;
  const error = () => props.line().hint != null;
  return (
    <View testID="stage" style={{ ...cover(), backgroundColor: colors.ink() }}>
      <If when={s().still} else={<View style={paperStyle(s().paper)} />}>
        <Image src={s().still!} blurRadius={u(18)} style={stillStyle} />
      </If>
      <View style={veilStyle()} />
      <View style={centreStyle()}>
        <View style={{ alignItems: "center", ...breathe(!error()) }}>
          <Text style={logotypeStyle()}>{titleText(s())}</Text>
          <If when={props.subtitle() !== ""}>
            <Text style={subtitleStyle()}>{props.subtitle()}</Text>
          </If>
        </View>
        <Text testID="stage-line" style={lineStyle(error())}>{props.line().text}</Text>
        <If when={props.line().hint}>
          <Text style={hintStyle()}>{props.line().hint!}</Text>
        </If>
        <If when={props.progress() != null}>
          <View style={trackStyle()}>
            <View style={fillStyle(props.progress()!)} />
          </View>
        </If>
        <If when={props.meta() !== ""}>
          <Text style={metaStyle()}>{props.meta()}</Text>
        </If>
      </View>
    </View>
  );
}

const noteStyle = (): ViewStyle => ({
  flexDirection: "row", alignItems: "center", gap: u(16),
  paddingHorizontal: u(28), paddingVertical: u(18), ...rounded(999), backgroundColor: alpha(colors.ink(), 0.72),
});
const SPINNER = 56;
/** A ring with a gap, turning. */
const spinnerStyle = (): ViewStyle => ({
  width: u(SPINNER),
  height: u(SPINNER),
  ...rounded(999),
  borderWidth: u(5),
  borderColor: alpha(colors.snow(), 0.9),
  borderTopColor: "transparent",
  animationName: "spin",
  animationDuration: 900,
  animationTimingFunction: "linear",
  animationIterationCount: "infinite",
});

/** A stall while the film plays: a spinner in the middle, the picture kept;
 * with the stream's details on (Settings), how much is ready and how fast. */
export function BufferingNote(props: { text: () => string }) {
  return (
    <View testID="buffering" style={{ ...cover(), pointerEvents: "none", alignItems: "center", justifyContent: "center", gap: u(20) }}>
      <View accessibilityLabel={t("player.buffering")} style={spinnerStyle()} />
      <If when={props.text() !== ""}>
        <View style={noteStyle()}>
          <Text style={{ ...type.label(), fontWeight: 400, color: colors.soft() }}>{props.text()}</Text>
        </View>
      </If>
    </View>
  );
}
