import { Text, View, type ImageAsset, type ViewStyle } from "nsh";
import { alpha, colors, cs, focusRing, radius, targetSlop, u } from "../theme";
import { Icon } from "./Icon";
import { rounded, row } from "./shape";
import { labelText } from "./text";
import { Pressable } from "./Pressable";

/** `play`: Play / Resume, red; `primary`: a step's main action (Next, Browse), white;
 * `secondary`: grey. */
type Kind = "play" | "primary" | "secondary";

const foreground = (kind: Kind) => (kind === "primary" ? colors.ink() : colors.snow());
const background = (kind: Kind) => (kind === "play" ? colors.play() : kind === "primary" ? colors.snow() : colors.raise());

const buttonStyle = (kind: Kind, focused: boolean, height: number, grow: boolean): ViewStyle => ({
  ...row(u(12)),
  height: cs(height),
  paddingHorizontal: cs(28),
  ...rounded(),
  backgroundColor: background(kind),
  ...focusRing(focused),
  ...(grow ? { flexGrow: 1, flexBasis: 0, minWidth: 0, justifyContent: "center" } : {}),
});
/** How far a job has come, a lighter fill from the left behind the label. */
const fillStyle = (part: number): ViewStyle => ({
  position: "absolute",
  left: 0,
  top: 0,
  bottom: 0,
  width: `${Math.round(Math.min(1, Math.max(0, part)) * 100)}%`,
  borderTopLeftRadius: radius(),
  borderBottomLeftRadius: radius(),
  backgroundColor: alpha(colors.snow(), 0.1),
});

/** A rounded-rectangle button: red Play, white primary, grey secondary. */
export function Button(props: {
  label: () => string;
  icon?: () => ImageAsset;
  kind: Kind;
  focused: () => boolean;
  onPress: () => void;
  height?: number;
  /** It cannot do its job yet (Play while the release is searched): dimmed, a press does nothing. */
  disabled?: () => boolean;
  /** Shares its row's width with the others (its content centred). */
  grow?: boolean;
  /** How far its job has come, 0..1 (Saving 34%), as a fill behind it; null: none. */
  fill?: () => number | null;
}) {
  const fg = () => foreground(props.kind);
  const off = () => props.disabled?.() ?? false;
  return (
    <Pressable
      role="button"
      accessibilityLabel={props.label()}
      hitSlop={targetSlop(cs(props.height ?? 60))}
      accessibilityState={{ disabled: off() }}
      onPress={() => !off() && props.onPress()}
      hoverStyle={{ opacity: off() ? 0.4 : 0.9 }}
      style={{ ...buttonStyle(props.kind, props.focused(), props.height ?? 60, !!props.grow), opacity: off() ? 0.4 : 1 }}
    >
      <If when={props.fill && props.fill() != null}>
        <View style={fillStyle(props.fill!() ?? 0)} />
      </If>
      <If when={props.icon}>
        <Icon src={props.icon!} size={24} color={fg} />
      </If>
      <Text style={{ ...labelText(fg()), fontWeight: 600 }}>{props.label()}</Text>
    </Pressable>
  );
}
