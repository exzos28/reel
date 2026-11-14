import { View, type ViewStyle } from "nsh";
import { colors, u } from "../theme";
import { rounded, row } from "./shape";

const HEIGHTS = [8, 13, 18, 23];

const barStyle = (height: number, lit: boolean): ViewStyle => ({
  width: u(5),
  height: u(height),
  ...rounded(1),
  backgroundColor: lit ? colors.snow() : colors.raise(),
});

/** People sharing: four monochrome bars (the count goes beside them). */
export function SignalBars(props: { bars: number }) {
  return (
    <View style={row(u(3), "flex-end")}>
      <Each of={HEIGHTS} key="index">
        {(h, i) => <View style={barStyle(h(), i() < props.bars)} />}
      </Each>
    </View>
  );
}
