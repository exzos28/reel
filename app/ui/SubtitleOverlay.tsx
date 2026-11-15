// Subtitles we draw ourselves (files from the release, on every platform):
// bottom-centred inside the title-safe area, large enough for ten feet, on a
// dark plate so they read over any picture; they move up while the player's
// controls show so they never sit under them.
import { Text, View, type TextStyle, type ViewStyle } from "nsh";
import { alpha, colors, font, radius, safe, ts, u } from "./theme";

/** How far up the subtitles sit while the controls show (TV pixels above the safe area). */
const ABOVE_CONTROLS = 300;

const place = (lifted: boolean): ViewStyle => ({
  pointerEvents: "none",
  position: "absolute",
  left: safe().x,
  right: safe().x,
  bottom: safe().y + u(24),
  alignItems: "center",
  transform: lifted ? `translateY(${-u(ABOVE_CONTROLS - 24)}px)` : "none",
  transitionProperty: "transform",
  transitionDuration: 160,
  transitionTimingFunction: "ease-out",
});

const plate = (): ViewStyle => ({
  maxWidth: "80%",
  paddingHorizontal: u(22),
  paddingVertical: u(10),
  borderRadius: radius(),
  borderCurve: "continuous",
  backgroundColor: alpha(colors.ink(), 0.72),
});

const line = (): TextStyle => ({
  fontFamily: font,
  fontSize: ts(46),
  lineHeight: ts(58),
  fontWeight: 500,
  textAlign: "center",
  color: colors.snow(),
});

export function SubtitleOverlay(props: { text: () => string; lifted: () => boolean }) {
  return (
    <If when={props.text() !== ""}>
      <View testID="subtitle" style={place(props.lifted())}>
        <View style={plate()}>
          <Text style={line()}>{props.text()}</Text>
        </View>
      </View>
    </If>
  );
}
