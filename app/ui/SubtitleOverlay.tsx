// Subtitles we draw ourselves (files from the release, on every platform):
// bottom-centred on a dark plate so they read over any picture; they stay
// above the player's controls while those show (`above`: the controls' top
// edge) so they never sit on the scrubber. Their size follows the picture's
// height, not the window's or the device's type scale: an iPad or a phone held
// upright shows the frame a third to a half as tall as the window, and its
// subtitles shrink with it. Two lines (a longer cue gets smaller), with room at the sides.
// The film's own subtitles (mpv draws them) get the same box: `subtitleFit`.
import { Text, View, windowSize, type TextStyle, type ViewStyle } from "nsh";
import { alpha, colors, font, radius, safe, u } from "./theme";

/** The line's size as a share of the picture's height (54 px at 1080). */
export const SIZE_OF_FRAME = 0.05;
/** No smaller than this, so a small frame still reads (points). */
export const MIN_SIZE = 13;
/** The room at each side, as a share of the window's width, at least. */
export const SIDE_OF_WINDOW = 0.06;
const LINE_HEIGHT = 58 / 46;

/** A character's width as a share of the font size, about (a little wide, to stay inside):
 * Chinese, Japanese and Korean a full em, Cyrillic wider than Latin. */
const glyph = (c: string) => {
  const n = c.codePointAt(0) ?? 0;
  if ((n >= 0x2e80 && n <= 0x9fff) || (n >= 0xac00 && n <= 0xd7af) || (n >= 0xff00 && n <= 0xffef)) return 1;
  if (n >= 0x0400 && n <= 0x04ff) return 0.62;
  return 0.55;
};
/** A line's width in ems. */
export const ems = (line: string) => Array.from(line).reduce((w, c) => w + glyph(c), 0);

export interface SubtitleFit {
  /** Font size (points). */
  size: number;
  /** Room at each side of the subtitles (points). */
  side: number;
  /** The picture's height in the window (points). */
  frame: number;
  /** The text as it shows: more than two of its own lines become one paragraph. */
  text: string;
}

/**
 * The subtitles' box in a `window`: sized from the picture's height (`aspect`, its width over
 * its height; 16:9 when not known), at least `safeX` and 6 % of the width at the sides, and two
 * lines: a longer `text` gets a smaller size (no smaller than `MIN_SIZE`; nothing is cut).
 * `pad`: the plate's own padding at each side.
 */
export function subtitleFit(window: { width: number; height: number }, aspect: number | undefined, safeX: number, pad: number, text: string): SubtitleFit {
  const ratio = aspect && aspect > 0 ? aspect : 16 / 9;
  const frame = Math.min(window.height, window.width / ratio);
  const side = Math.max(safeX, window.width * SIDE_OF_WINDOW);
  const own = text.split("\n");
  const shown = own.length > 2 ? own.map((l) => l.trim()).join(" ") : text;
  const parts = shown.split("\n");
  const width = Math.max(1, window.width - 2 * side - 2 * pad);
  const lines = (size: number) => parts.reduce((n, l) => n + Math.max(1, Math.ceil((ems(l) * size) / width)), 0);
  let size = Math.max(MIN_SIZE, frame * SIZE_OF_FRAME);
  if (lines(size) > 2) {
    // The size at which the longest line (one paragraph: its half) fills the width.
    const perLine = parts.length === 1 ? ems(shown) / 2 : Math.max(...parts.map(ems));
    size = Math.max(MIN_SIZE, Math.min(size, (width / Math.max(1, perLine)) * 0.97));
  }
  return { size, side, frame, text: shown };
}

const place = (side: number, lift: number): ViewStyle => ({
  pointerEvents: "none",
  position: "absolute",
  left: side,
  right: side,
  bottom: subtitleRest(),
  alignItems: "center",
  transform: lift > 0 ? `translateY(${-lift}px)` : "none",
  transitionProperty: "transform",
  transitionDuration: 160,
  transitionTimingFunction: "ease-out",
});

const plate = (): ViewStyle => ({
  maxWidth: "100%",
  paddingHorizontal: u(22),
  paddingVertical: u(10),
  borderRadius: radius(),
  borderCurve: "continuous",
  backgroundColor: alpha(colors.ink(), 0.72),
});

const line = (size: number): TextStyle => ({
  fontFamily: font,
  fontSize: size,
  lineHeight: size * LINE_HEIGHT,
  fontWeight: 500,
  textAlign: "center",
  color: colors.snow(),
});

/** Where the subtitles rest when nothing is under them: from the window's bottom. */
export const subtitleRest = () => safe().y + u(24);

/** `above`: how far from the window's bottom to stay above (the controls' top edge while they
 * show, else 0); `aspect`: the picture's width over its height, when known. */
export function SubtitleOverlay(props: { text: () => string; above: () => number; aspect: () => number | undefined }) {
  const fit = () => subtitleFit(windowSize(), props.aspect(), safe().x, u(22), props.text());
  return (
    <If when={props.text() !== ""}>
      <View testID="subtitle" style={place(fit().side, Math.max(0, props.above() - subtitleRest()))}>
        <View style={plate()}>
          <Text style={line(fit().size)}>{fit().text}</Text>
        </View>
      </View>
    </If>
  );
}
