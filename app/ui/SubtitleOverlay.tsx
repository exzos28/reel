// Subtitles we draw ourselves (files from the release, on every platform):
// bottom-centred inside the title-safe area, large enough for ten feet, on a
// dark plate so they read over any picture; they move up above the player's
// controls while those show (by the controls' own height) so they never sit
// under them. Their size follows the picture's height, not the device's type
// scale: a phone held upright shows a 16:9 frame a third as tall, and its
// subtitles shrink with it.
import { Text, View, windowSize, type TextStyle, type ViewStyle } from "nsh";
import { alpha, colors, font, radius, safe, u } from "./theme";

/** The line's size as a share of the frame's height (46 px at 1080, as on a TV). */
const SIZE_OF_FRAME = 46 / 1080;
/** No smaller than this, so a small frame still reads (points). */
const MIN_SIZE = 13;

/** The 16:9 frame's height in the window: the window's, or less when the window is narrow. */
const frameHeight = () => Math.min(windowSize().height, (windowSize().width * 9) / 16);
const size = () => Math.max(MIN_SIZE, frameHeight() * SIZE_OF_FRAME);

const place = (lift: number): ViewStyle => ({
  pointerEvents: "none",
  position: "absolute",
  left: safe().x,
  right: safe().x,
  bottom: safe().y + u(24),
  alignItems: "center",
  transform: lift > 0 ? `translateY(${-lift}px)` : "none",
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
  fontSize: size(),
  lineHeight: size() * (58 / 46),
  fontWeight: 500,
  textAlign: "center",
  color: colors.snow(),
});

/** `lift`: how far up to sit (the controls' height while they show, else 0). */
export function SubtitleOverlay(props: { text: () => string; lift: () => number }) {
  return (
    <If when={props.text() !== ""}>
      <View testID="subtitle" style={place(props.lift())}>
        <View style={plate()}>
          <Text style={line()}>{props.text()}</Text>
        </View>
      </View>
    </If>
  );
}
