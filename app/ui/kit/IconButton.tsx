import { View, type ImageAsset, type ViewStyle } from "nsh";
import { colors, focusRing, u } from "../theme";
import { Icon } from "./Icon";
import { rounded } from "./shape";

const iconButtonStyle = (size: number, fill: string, focused: boolean): ViewStyle => ({
  width: u(size),
  height: u(size),
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
}) {
  const size = props.size ?? 62;
  const fill = () => (props.selected?.() ? colors.control() : props.background ? props.background() : colors.card());
  return (
    <View
      role="button"
      accessibilityLabel={props.label()}
      onPress={props.onPress}
      hoverStyle={{ backgroundColor: colors.raise() }}
      style={iconButtonStyle(size, fill(), props.focused())}
    >
      <Icon src={props.icon} size={size * 0.42} />
    </View>
  );
}
