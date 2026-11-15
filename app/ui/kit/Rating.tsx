import { Text, View, type ViewStyle } from "nsh";
import { colors, ts, type, u } from "../theme";
import { rounded, row } from "./shape";
import { fontText, oneLine } from "./text";

const chipStyle = (): ViewStyle => ({
  position: "absolute",
  left: u(8),
  bottom: u(10),
  ...row(u(5), "stretch"),
  paddingHorizontal: u(7),
  paddingVertical: u(3),
  ...rounded(u(5)),
  backgroundColor: colors.ink(),
});

/** "★ 7.9": the one red mark next to a rating. */
export function Rating(props: { rating: string; size: number; color?: () => string }) {
  return (
    <View style={row(u(6))}>
      <Text style={fontText(props.size, colors.red())}>★</Text>
      <Text style={fontText(props.size, props.color ? props.color() : colors.snow(), 500)}>{props.rating}</Text>
    </View>
  );
}

/** "★ 7.2" on a dark chip in a thumbnail's bottom-left corner. */
export function RatingChip(props: { rating: () => string }) {
  return (
    <View style={chipStyle()}>
      <Text style={fontText(17, colors.red())}>★</Text>
      <Text style={fontText(17, colors.snow(), 600)}>{props.rating()}</Text>
    </View>
  );
}

/** Under a card: a red star, then "7.9 · 1963 · Movie". */
export function CardMeta(props: { text: () => string; size?: number }) {
  return (
    <Text style={{ ...oneLine, ...type.meta(), fontSize: ts(props.size ?? 22), color: colors.ash() }}>
      <Text style={{ color: colors.red() }}>★ </Text>
      {props.text()}
    </Text>
  );
}
