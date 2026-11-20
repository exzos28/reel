// Everything that takes a press goes through here (dev/ui-rules.sh fails on a press heard by a
// bare View): it shows the press from the moment a finger is down, as Apple's HIG asks, and a
// quick tap too (pressFeedback). Buttons, icons, chips and tabs dim; list and settings rows take
// a lighter fill. The caller's focus ring (in its style) and hoverStyle stay as they are.
import { split, View, type PressEvent, type ViewProps, type ViewStyle } from "nsh";
import { Haptics, isAvailable as hasHaptics } from "nsh/mobile";
import { caps } from "../platform";
import { colors } from "../theme";
import { pressFeedback } from "./pressFeedback";

/** How a press shows: `dim` (buttons, icons, chips, tabs, links), `row` (a list or settings row:
 * a fill lighter than its hover), `none` (pressable but no control: a backdrop, the video, a slider). */
export type Feedback = "dim" | "row" | "none";

const looks: Record<Exclude<Feedback, "none">, () => ViewStyle> = {
  dim: () => ({ opacity: 0.7 }),
  row: () => ({ backgroundColor: colors.control() }),
};

/** A phone or tablet ticks when a selection changes (not Android TV, which has no touch). */
const ticks = hasHaptics && caps.touch;

export function Pressable(
  props: ViewProps & {
    feedback?: Feedback;
    /** The press changes a selection (a tab, a segment, a switch, a choice): a light tick on
     * touch. False when it would change nothing (the chosen tab again, a locked episode). */
    haptic?: boolean;
  },
) {
  const [own, rest] = split(props, ["feedback", "haptic", "style", "activeStyle", "onPress", "onPressDown", "onPressUp", "children"] as const);
  const press = pressFeedback();
  const off = () => !!rest.disabled || !!rest.accessibilityState?.disabled;
  const look = () => (own.feedback === "none" || off() ? null : looks[own.feedback ?? "dim"]());
  /** It hears presses at all (Hero's title is a link only for some titles). */
  const hears = () => !!(own.onPress || own.onPressDown || own.onPressUp);
  return (
    <View
      {...rest}
      onPress={
        own.onPress &&
        ((e: PressEvent) => {
          if (own.haptic && ticks) Haptics.selection();
          own.onPress?.(e);
        })
      }
      onPressDown={
        hears()
          ? (e: PressEvent) => {
              if (look()) press.onPressDown();
              own.onPressDown?.(e);
            }
          : undefined
      }
      onPressUp={
        hears()
          ? (e: PressEvent) => {
              press.onPressUp();
              own.onPressUp?.(e);
            }
          : undefined
      }
      // Held, it shows over the hover (a state style wins over the style); let go, the signal
      // keeps it a moment, so a tap shows.
      style={[own.style, press.on() && look()]}
      activeStyle={[own.activeStyle, look()]}
    >
      {own.children}
    </View>
  );
}
