// The phone's player drawn sideways (design/player-rendering.md, "Turns"). A phone's interface
// never turns: the window stays upright, and the player is a box of the window's size the other
// way round (852 x 393 in a 393 x 852 window), turned a quarter about its centre. Everything in
// it (the video view, the subtitles, the controls, the drawers) lays out in the box's own
// coordinates and reads the box's size and insets (`surface`): the screen's insets on the sides
// they are on once turned (the Dynamic Island at the box's left, turned clockwise). A turn
// changes only this box: the video view keeps its picture and mpv is not called (its view fits
// the canvas into its new bounds). Upright, the box is the window, unturned.
import { createAnimatedValue, reduceMotion, safeArea, signal, untracked, View, windowSize, type AnimatedValue, type JSX } from "nsh";
import { VideoEngine } from "../native";
import { colors } from "../theme";
import { SurfaceContext, turnedInsets, type Surface } from "./surface";

/** How long a turn takes, ms (UIKit's own is about this long). */
export const TURN_MS = 300;

/** How the player is turned: 0 upright, 90 a quarter clockwise (the phone turned counter-
 * clockwise, the common way: its top at the left), -90 the other way. */
export type Angle = 0 | 90 | -90;

export interface Turn {
  /** The angle it is laid out for (the drawing may still be on its way there). */
  angle: () => Angle;
  /** Turns to `to`: animated from what showed (the picture of `aspect`, its width over its
   * height, as large as it was), or at once (`animated` false, or less motion asked for). */
  to(to: Angle, animated: boolean, aspect?: number): void;
  /** The drawing's angle and scale. */
  rotate: AnimatedValue;
  zoom: AnimatedValue;
  /** A turn is on its way: the controls are out of sight (laid out for the new angle at once,
   * they would show at the start's scale). */
  turning: () => boolean;
}

export function createTurn(): Turn {
  const angle = signal<Angle>(0);
  const rotate = createAnimatedValue(0);
  const zoom = createAnimatedValue(1);
  const turning = signal(false);
  let settle: ReturnType<typeof setTimeout> | undefined;
  return {
    angle,
    rotate,
    zoom,
    turning,
    to(to, animated, aspect) {
      const from = untracked(angle);
      if (to === from) return;
      clearTimeout(settle);
      if (!animated || untracked(reduceMotion)) {
        rotate.set(to);
        zoom.set(1);
        turning.set(false);
        angle.set(to);
        return;
      }
      // The start pose first, then the new layout, in one turn of JS: the layout is drawn at the
      // old angle, as large as the picture showed (the core's scale), then it turns into place.
      const { width, height } = untracked(windowSize);
      rotate.set(from);
      zoom.set(VideoEngine.turnScale(from, to, width, height, aspect ?? 0));
      angle.set(to);
      void rotate.timing(to, { duration: TURN_MS, easing: "easeInOut" });
      void zoom.timing(1, { duration: TURN_MS, easing: "easeInOut" });
      turning.set(true);
      settle = setTimeout(() => turning.set(false), TURN_MS);
    },
  };
}

/** The player's box: the window, or the window the other way round, turned a quarter. */
export function TurnedBox(props: { turn: Turn; children: JSX.Element }) {
  const turned = () => props.turn.angle() !== 0;
  const size = () => {
    const w = windowSize();
    return turned() ? { width: w.height, height: w.width } : w;
  };
  const surface: Surface = {
    size,
    insets: () => turnedInsets(safeArea(), props.turn.angle()),
    turned,
  };
  return (
    <View style={{ flex: 1, backgroundColor: colors.ink() }}>
      <View
        testID={props.turn.angle() === 0 ? "player-upright" : props.turn.angle() === 90 ? "player-turned" : "player-turned-other"}
        style={{
          position: "absolute",
          left: (windowSize().width - size().width) / 2,
          top: (windowSize().height - size().height) / 2,
          width: size().width,
          height: size().height,
          // Always the animated values (never a string), so a turn's start pose lands with its layout.
          transform: [{ rotate: props.turn.rotate }, { scale: props.turn.zoom }],
        }}
      >
        <SurfaceContext.Provider value={surface}>{props.children}</SurfaceContext.Provider>
      </View>
    </View>
  );
}
