import { type ImageAsset, type ViewStyle } from "nsh";
import { colors, cs, focusRing, targetSlop, u } from "../theme";
import { Icon } from "./Icon";
import { rounded } from "./shape";
import { Pressable } from "./Pressable";

const iconButtonStyle = (size: number, fill: string, focused: boolean): ViewStyle => ({
  width: cs(size),
  height: cs(size),
  ...rounded(999),
  alignItems: "center",
  justifyContent: "center",
  backgroundColor: fill,
  ...focusRing(focused),
});

/** A round icon button; its label is for screen readers (and tests). */
export function IconButton(props: {
  icon: () => ImageAsset;
  label: () => string;
  focused: () => boolean;
  selected?: () => boolean;
  onPress: () => void;
  size?: number;
  background?: () => string;
  /** The icon's color (white by default). */
  iconColor?: () => string;
}) {
  const size = props.size ?? 62;
  const fill = () => (props.selected?.() ? colors.control() : props.background ? props.background() : colors.card());
  return (
    <Pressable
      role="button"
      hitSlop={targetSlop(cs(size))}
      accessibilityLabel={props.label()}
      onPress={props.onPress}
      hoverStyle={{ backgroundColor: colors.raise() }}
      style={iconButtonStyle(size, fill(), props.focused())}
    >
      <Icon src={props.icon} size={size * 0.42} color={props.iconColor} />
    </Pressable>
  );
}
