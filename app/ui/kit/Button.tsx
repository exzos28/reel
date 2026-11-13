import { Text, View, type ImageAsset, type ViewStyle } from "nsh";
import { colors, focusRing, u } from "../theme";
import { Icon } from "./Icon";
import { rounded, row } from "./shape";
import { labelText } from "./text";

type Kind = "primary" | "secondary";

const foreground = (kind: Kind) => (kind === "primary" ? colors.ink() : colors.snow());

const buttonStyle = (kind: Kind, focused: boolean, height: number): ViewStyle => ({
  ...row(u(12)),
  height: u(height),
  paddingHorizontal: u(28),
  ...rounded(),
  backgroundColor: kind === "primary" ? colors.snow() : colors.raise(),
  ...focusRing(focused),
});

/** A rounded-rectangle button: white Play, grey secondary. */
export function Button(props: {
  label: () => string;
  icon?: () => ImageAsset;
  kind: Kind;
  focused: () => boolean;
  onPress: () => void;
  height?: number;
}) {
  const fg = () => foreground(props.kind);
  return (
    <View
      role="button"
      onPress={props.onPress}
      hoverStyle={{ opacity: 0.9 }}
      style={buttonStyle(props.kind, props.focused(), props.height ?? 60)}
    >
      <If when={props.icon}>
        <Icon src={props.icon!} size={24} color={fg} />
      </If>
      <Text style={{ ...labelText(fg()), fontWeight: 600 }}>{props.label()}</Text>
    </View>
  );
}
