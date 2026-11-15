// Why something is missing (no search source, the source did not answer, nothing found) and,
// where a pointer or a finger can reach it, what to do about it: a button next to the words.
// A remote has no stop for it (the page's focus walks its own zones): the words say where to go.
import { Text, View, type TextStyle, type ViewStyle } from "nsh";
import { caps } from "../platform";
import { colors, ts, type, u } from "../theme";
import { Button } from "./Button";

const lineStyle = (): ViewStyle => ({ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: u(20) });
const textStyle = (): TextStyle => ({ ...type.meta(), fontSize: ts(22), color: colors.ash(), flexShrink: 1 });

export interface StateAction {
  label: string;
  onPress: () => void;
}

export function StateLine(props: { text: () => string; action?: () => StateAction | null }) {
  const action = () => (caps.remote ? null : (props.action?.() ?? null));
  return (
    <View style={lineStyle()}>
      <Text style={textStyle()}>{props.text()}</Text>
      <If when={action()}>
        {(a) => <Button kind="secondary" height={52} label={() => a().label} focused={() => false} onPress={() => a().onPress()} />}
      </If>
    </View>
  );
}
