import { Text, View, type ViewStyle } from "nsh";
import { colors, u } from "../theme";
import { rounded } from "./shape";
import { fontText } from "./text";

const badgeStyle = (): ViewStyle => ({
  borderWidth: 1,
  borderColor: colors.ash(),
  ...rounded(u(4)),
  paddingHorizontal: u(9),
  paddingVertical: u(4),
});

const tagStyle = (): ViewStyle => ({
  position: "absolute",
  left: u(12),
  top: u(12),
  backgroundColor: colors.red(),
  ...rounded(u(4)),
  paddingHorizontal: u(9),
  paddingVertical: u(6),
});

/** An outlined badge: 4K, 1080p, CC. */
export function Badge(props: { text: string; size?: number }) {
  return (
    <View style={badgeStyle()}>
      <Text style={fontText(props.size ?? 20, colors.snow(), 500)}>{props.text}</Text>
    </View>
  );
}

/** The red "New season" tag in a card's top-left corner. */
export function Tag(props: { text: () => string }) {
  return (
    <View style={tagStyle()}>
      <Text style={fontText(17, colors.snow(), 600)}>{props.text()}</Text>
    </View>
  );
}
