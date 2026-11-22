// The player's waiting states. From Play until the first frame plays (and
// when the film cannot play) the stage fills the screen: the title's still,
// darkened (not blurred: the direction refuses blur), its logotype in the middle, the release
// under it, one calm line from the core and a thin bar of how far the film is from its first
// frame (the dinosaur over the line when Settings asks for it); an error takes the same place,
// still.
// Once the film plays, a stall only shows a line over the picture (`BufferingNote`; a phone's is
// in the controls' bottom row, `WaitingLine`), with no loader.
import { Image, reduceMotion, Text, View, type TextStyle, type ViewStyle } from "nsh";
import { titleText, type Summary } from "./catalog";
import { Loader } from "./kit/Loader";
import { cover, rounded } from "./kit/shape";
import { alpha, colors, density, font, safe, ts, type, u } from "./theme";

/** One breath of the buffering note, ms. */
export const BREATH_MS = 1600;

/** The stage's line under the title: what the engine does, or what went wrong. */
export interface StageLine {
  text: string;
  /** What to do about an error; null while it is waiting. */
  hint: string | null;
  /** The engine's progress while all goes well (finding people, fetching the start): not on
   * screen, the bar says it; a screen reader reads it as the bar's label. */
  quiet?: boolean;
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
  // Darker than it was with the blur: the sharp still must not compete with the logotype.
  backgroundColor: alpha(colors.ink(), 0.74),
  backgroundImage: `linear-gradient(0deg, ${colors.ink()} 0%, ${alpha(colors.ink(), 0)} 45%)`,
});
const centreStyle = (): ViewStyle => ({
  ...cover(), alignItems: "center", justifyContent: "center", paddingHorizontal: safe().x,
});
const logotypeSize = () => (density() === "compact" ? 64 : 88);
const logotypeStyle = (title: string): TextStyle => ({
  numberOfLines: 2, ...type.logotype(logotypeSize(), title.length), color: colors.snow(), textAlign: "center", maxWidth: u(1400),
});
const subtitleStyle = (): TextStyle => ({ ...type.meta(), color: colors.ash(), textAlign: "center", marginTop: u(14) });
const loaderStyle = (): ViewStyle => ({ marginTop: u(40) });
const lineStyle = (error: boolean): TextStyle => ({
  ...type.body(), color: error ? colors.snow() : colors.soft(), textAlign: "center", maxWidth: u(960), marginTop: u(error ? 48 : 28),
});
const hintStyle = (): TextStyle => ({ ...type.meta(), color: colors.ash(), textAlign: "center", maxWidth: u(900), marginTop: u(12) });
const BAR = 360;
const trackStyle = (): ViewStyle => ({
  width: u(BAR), height: Math.max(2, u(4)), marginTop: u(22), overflow: "hidden", ...rounded(u(2)), backgroundColor: alpha(colors.snow(), 0.16),
});
/** The core says how far it is twice a second: the fill glides from one value to the next in
 * that time, so it moves steadily. A transform, not the width: nothing is laid out again. */
const STEP_MS = 500;
const fillStyle = (percent: number): ViewStyle => ({
  height: "100%", width: "100%", backgroundColor: colors.snow(),
  transform: [{ scaleX: Math.max(0, Math.min(100, percent)) / 100 }], transformOrigin: "0% 50%",
  ...(reduceMotion() ? {} : { transitionProperty: "transform", transitionDuration: STEP_MS, transitionTimingFunction: "linear" }),
});
const metaStyle = (): TextStyle => ({ fontFamily: font, fontSize: ts(22), color: colors.ash(), textAlign: "center", marginTop: u(16) });

/** The full-screen stage: still, logotype, the line, the bar. */
export function PlayerStage(props: {
  item: () => Summary;
  /** The episode or the release under the title. */
  subtitle: () => string;
  line: () => StageLine;
  /** How far the film is from its first frame, percent; null hides the bar (an error). */
  progress: () => number | null;
  /** Speed and people, when known. */
  meta: () => string;
}) {
  const s = props.item;
  const error = () => props.line().hint != null;
  return (
    <View testID="stage" style={{ ...cover(), backgroundColor: colors.ink() }}>
      <If when={s().still} else={<View style={paperStyle(s().paper)} />}>
        <Image src={s().still!} style={stillStyle} />
      </If>
      <View style={veilStyle()} />
      <View style={centreStyle()}>
        <View style={{ alignItems: "center" }}>
          <Text style={logotypeStyle(titleText(s()))}>{titleText(s())}</Text>
          <If when={props.subtitle() !== ""}>
            <Text style={subtitleStyle()}>{props.subtitle()}</Text>
          </If>
        </View>
        {/* The dinosaur, when Settings picks it, while it waits; by default nothing. */}
        <If when={!error()}>
          <Loader label={props.line().text} style={loaderStyle()} />
        </If>
        <If when={!props.line().quiet}>
          <Text testID="stage-line" style={lineStyle(error())}>{props.line().text}</Text>
        </If>
        <If when={props.line().hint}>
          <Text style={hintStyle()}>{props.line().hint!}</Text>
        </If>
        <If when={props.progress() != null}>
          <View testID="stage-bar" accessible role="progressbar" accessibilityLabel={props.line().quiet ? props.line().text : undefined}
            accessibilityValue={{ min: 0, max: 100, now: Math.round(props.progress()!) }} style={trackStyle()}>
            {/* Its value in the test id: headless tests read what the bar shows. */}
            <View testID={`stage-fill-${Math.round(props.progress()!)}`} style={fillStyle(props.progress()!)} />
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
  paddingHorizontal: u(28), paddingVertical: u(16), ...rounded(999), backgroundColor: alpha(colors.ink(), 0.72),
});
/** The note's words as the stage's line has them. */
const noteTextStyle = (): TextStyle => ({ ...type.body(), color: colors.soft(), textAlign: "center" });
/** A stall or a seek while the film plays: one calm line at the picture's middle, as the stage
 * words its own; the picture stays as it is, and what is ready ahead shows on the scrubber. The
 * loader (Settings) is the stage's only. */
export function BufferingNote(props: { text: () => string }) {
  return (
    <View testID="buffering" style={{ ...cover(), pointerEvents: "none", alignItems: "center", justifyContent: "center", paddingHorizontal: safe().x }}>
      <View style={{ ...noteStyle(), ...breathe(true) }}>
        <Text testID="buffering-line" style={noteTextStyle()}>{props.text()}</Text>
      </View>
    </View>
  );
}

/** A phone's `BufferingNote`: its middle has Play, so the line is in the controls' bottom row,
 * at its middle between the times and in their size (`style`), `side` points kept clear at each
 * end (the wider time's room), one line cut with an ellipsis when long. */
export function WaitingLine(props: { text: () => string; side: () => number; style: () => TextStyle }) {
  return (
    <View testID="buffering" style={{ ...waitingRowStyle(props.side()), ...breathe(true) }}>
      <Text testID="buffering-line" style={{ ...props.style(), ...waitingTextStyle }}>{props.text()}</Text>
    </View>
  );
}
const waitingRowStyle = (side: number): ViewStyle => ({
  position: "absolute", top: 0, bottom: 0, left: side, right: side, pointerEvents: "none", alignItems: "center", justifyContent: "center",
});
const waitingTextStyle: TextStyle = { numberOfLines: 1, textOverflow: "ellipsis", textAlign: "center" };
