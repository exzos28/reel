// A slider along a track: the player's scrubber and its volume. A press anywhere on the track
// puts the thumb there; a drag (a finger, or the mouse with its button down) moves it on the UI
// thread, wherever the pointer goes once the drag began; the release commits. The thumb and the
// filled part are transforms of one animated node: no layout while it moves.
//
// The drag is the view's pan, bound to `x` only: it starts on mostly sideways moves, so a
// vertical swipe stays the views' around it (the player's swipe down to close). The platform
// moves `drag` by the pointer's translation since it went down (along the track: `boxPan`, in
// the turned player too); `base` is where it went down (or the value at rest). No `panActivation`: it gates JS touch responders, and once its gate
// opens the platform starts no pan. JS hears no move, so while a drag goes on it reads the
// value at `SCRUB_HZ` for what follows it in words (the time beside the scrubber).
import { cleanup, computed, createAnimatedValue, effect, signal, untracked, View, type JSX, type PressEvent, type ViewStyle, type WheelEvent } from "nsh";
import { boxPan } from "../layout/surface";
import { runtime } from "../platform";
import { alpha, colors, focusRing, targetSlop } from "../theme";
import { Pressable } from "./Pressable";

/** How often a drag reports where it is (`onScrub`), per second. */
const SCRUB_HZ = 30;
/** How much larger the thumb is while it is held. */
const HELD_SCALE = 1.35;
/** How long after a press goes up without a tap the thumb waits for the drag that took the
 * press over (on iOS the two come in separate turns), ms; then it goes back. */
const SETTLE_MS = 100;
/** iOS counts a pan's translation from where it was recognized, not from where the finger went
 * down (UIKit's), and takes the press from the finger there: the drag counts from where that
 * press ended. Elsewhere it counts from the press. */
const fromRecognition = runtime.os === "ios";
/** iOS: the longest a press's end is taken to precede its pan's start, ms (a few touch samples). */
const MAX_LAG_MS = 50;

export function TrackSlider(props: {
  testID?: string;
  accessibilityLabel: string;
  /** What screen readers read as its value (`12:30 / 1:40:00`, `70%`). */
  valueText: () => string;
  /** Where it is at rest, 0..1. */
  value: () => number;
  /** While dragged: where the thumb is (0..1), at most `SCRUB_HZ` times a second; `null` once a
   * drag ends with no change (the system cancelled it, the slider went). */
  onScrub?: (at: number | null) => void;
  /** Tapped or let go at `at`, 0..1: the one change a press or a drag makes. */
  onCommit: (at: number) => void;
  /** A drag began (true) and ended (false). */
  onHold?: (held: boolean) => void;
  /** Screen readers' increment (1) and decrement (-1). */
  onStep: (dir: 1 | -1) => void;
  onWheel?: (e: WheelEvent) => void;
  /** The thumb shows the focus ring (a TV's remote is on it). */
  focused?: () => boolean;
  /** The track's thickness, the thumb's diameter and the height it takes presses in (a finger's
   * 44 pt reach past it, up and down), points. */
  track: number;
  thumb: number;
  height: number;
  /** The track's empty colour. */
  empty?: string;
  /** Drawn on the track under the filled part (the scrubber's ready stretches), with its width. */
  children?: (width: () => number) => JSX.Element;
  style?: ViewStyle;
}) {
  const width = signal(0);
  /** Points from the track's start: where the press landed, or the value at rest. */
  const base = createAnimatedValue(0);
  /** The drag's translation since the press (the pan drives it; 0 at rest), along the platform's
   * axis that runs along the track (`pan.sign()`: -1 where it runs the other way). */
  const drag = createAnimatedValue(0);
  const pan = boxPan("x", drag);
  const grow = createAnimatedValue(1);
  /** A press is down on it: the thumb is the pointer's, not the value's. */
  let down = false;
  /** Its pan is on (`onHold` said true). */
  let dragging = false;
  let pressX = 0;
  /** iOS: the pan's translation when it began, until the press it took over says where it was. */
  let began: number | null = null;
  let last = -1;
  let poll: ReturnType<typeof setInterval> | undefined;
  let settle: ReturnType<typeof setTimeout> | undefined;
  cleanup(() => {
    clearInterval(poll);
    clearTimeout(settle);
    // Gone mid-drag (the next episode, leaving): what it held is let go.
    if (dragging) (props.onScrub?.(null), props.onHold?.(false));
  });

  const fraction = (x: number) => (width() > 0 ? Math.min(Math.max(x / width(), 0), 1) : 0);
  const rest = () => base.set(untracked(props.value) * untracked(width));
  // At rest the thumb follows the value; while a press is down it is the pointer's.
  effect(() => {
    const at = props.value() * width();
    if (!down) base.set(at);
  });

  /** iOS: where the press the pan took over ended, and when (ms). */
  let upX: number | null = null;
  let upAt = 0;
  /** iOS: the drag counts from `x` less the translation it began with. */
  const anchor = (x: number) => {
    if (began == null) return;
    pressX = x - began;
    began = null;
    base.set(Math.min(Math.max(pressX, 0), untracked(width)));
  };
  /** The thumb goes where the press landed, and grows. */
  const press = (x: number) => {
    clearTimeout(settle);
    if (!down) upX = null;
    pressX = x;
    base.set(Math.min(Math.max(x, 0), untracked(width)));
    if (!down) grow.timing(HELD_SCALE, { duration: 120 });
    down = true;
  };
  /** The press is over: the drag back to 0, the thumb its size. */
  const end = () => {
    clearInterval(poll);
    clearTimeout(settle);
    down = false;
    drag.set(0);
    grow.timing(1, { duration: 160 });
    const was = dragging;
    dragging = false;
    return was;
  };
  const commit = (x: number) => {
    if (!down) return;
    const at = fraction(x);
    base.set(at * width());
    const was = end();
    props.onCommit(at);
    // Where the value is now (a commit that changed nothing leaves the thumb where it was).
    rest();
    if (was) props.onHold?.(false);
  };
  const cancel = () => {
    if (!down) return;
    rest();
    if (end()) (props.onScrub?.(null), props.onHold?.(false));
  };

  // The thumb's centre and the filled part's end, kept on the track.
  const at = computed(() => {
    const w = Math.max(width(), 1);
    return base.add(pan.sign() < 0 ? drag.mul(-1) : drag).interpolate({ inputRange: [0, w], outputRange: [0, w], extrapolate: "clamp" });
  });
  const slop = targetSlop(props.height);
  return (
    <Pressable
      feedback="none"
      testID={props.testID}
      role="adjustable"
      accessibilityLabel={props.accessibilityLabel}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(props.value() * 100), text: props.valueText() }}
      accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
      onAccessibilityAction={(e) => props.onStep(e.actionName === "decrement" ? -1 : 1)}
      // Not a Tab stop: Space or Enter on it would press its start. The player has its keys.
      focusable={false}
      // A finger needs 44 pt: the area reaches past what it draws, up and down.
      hitSlop={{ top: slop, bottom: slop }}
      pan={pan.bind()}
      onLayout={(e) => width.set(e.bounds.size.width)}
      onPressDown={(e: PressEvent) => press(e.position.x)}
      onPress={(e: PressEvent) => commit(e.position.x)}
      // The press is over with no tap: the drag that took it over comes with it (or just
      // before it). Neither (the pointer moved up or down): the thumb goes back.
      onPressUp={(e: PressEvent) => {
        clearTimeout(settle);
        if (dragging) return anchor(e.position.x);
        upX = e.position.x;
        upAt = performance.now();
        settle = setTimeout(cancel, SETTLE_MS);
      }}
      onPanStart={(raw) => {
        const e = pan.event(raw);
        clearTimeout(settle);
        began = fromRecognition ? e.translation.x : null;
        const up = upX;
        press(pressX);
        // The press ended a touch sample before the pan began (UIKit counts the pan from the
        // finger at that later sample): the finger moved on meanwhile, at the pan's speed. Left
        // out, the thumb trailed the finger by that much (4 to 8 pt).
        if (up != null) anchor(up + (fromRecognition ? e.velocity.x * Math.min(Math.max(performance.now() - upAt, 0), MAX_LAG_MS) / 1000 : 0));
        dragging = true;
        last = -1;
        props.onHold?.(true);
        props.onScrub?.(fraction(pressX));
        clearInterval(poll);
        poll = setInterval(() => {
          drag.getValue().then((v) => {
            if (!dragging || v === last) return;
            last = v;
            props.onScrub?.(fraction(pressX + untracked(pan.sign) * v));
          });
        }, 1000 / SCRUB_HZ);
      }}
      // Let go where the thumb is drawn: the value the pan moved, whichever way the platform
      // counts its translation.
      onPanEnd={(raw) => {
        const e = pan.event(raw);
        if (e.cancelled) cancel();
        else commit(pressX + (e.value?.x ?? e.translation.x));
      }}
      onWheel={props.onWheel}
      style={[{ height: props.height, justifyContent: "center" }, props.style]}
    >
      <View style={{ height: props.track, borderRadius: props.track / 2, borderCurve: "continuous", overflow: "hidden", backgroundColor: props.empty ?? alpha(colors.snow(), 0.2) }}>
        {props.children?.(width)}
        <View style={{ position: "absolute", top: 0, bottom: 0, left: 0, width: width(), borderRadius: props.track / 2, backgroundColor: colors.snow(), transform: [{ translateX: at().sub(width()) }] }} />
      </View>
      <View style={{ position: "absolute", left: -props.thumb / 2, width: props.thumb, height: props.thumb, transform: [{ translateX: at() }] }}>
        <View style={{ flex: 1, transform: [{ scale: grow }] }}>
          <View style={{ flex: 1, borderRadius: 999, borderCurve: "continuous", backgroundColor: colors.snow(), ...focusRing(props.focused?.() ?? false) }} />
        </View>
      </View>
    </Pressable>
  );
}
