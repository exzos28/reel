// A setting as a row: its name, the value in effect and a chevron (it opens its choices), or a
// switch (`on`). OK or a press acts.
import { Text, View, type ViewRef, type ViewStyle } from "nsh";
import { formWidth } from "../../kit/form";
import { rounded, row } from "../../kit/shape";
import { rowStyle } from "../../kit/Row";
import { labelText, metaText } from "../../kit/text";
import { colors, cs, targetSlop, u } from "../../theme";

const settingRow = (focused: boolean): ViewStyle => ({
  ...rowStyle(false, focused),
  justifyContent: "space-between",
  height: cs(76),
  paddingHorizontal: cs(28),
  maxWidth: formWidth(),
});
const track = (on: boolean): ViewStyle => ({
  width: cs(64),
  height: cs(36),
  padding: cs(4),
  ...rounded(999),
  alignItems: on ? "flex-end" : "flex-start",
  backgroundColor: on ? colors.snow() : colors.raise(),
});
const knob = (on: boolean): ViewStyle => ({ width: cs(28), height: cs(28), ...rounded(999), backgroundColor: on ? colors.ink() : colors.ash() });

export function SettingRow(props: {
  label: string;
  /** The value in effect, shown on the right. */
  value?: () => string;
  /** A switch instead of a chevron: on or off. */
  on?: () => boolean;
  focused: () => boolean;
  viewRef?: (r: ViewRef) => void;
  onPress: () => void;
}) {
  const isSwitch = props.on !== undefined;
  return (
    <View
      ref={props.viewRef}
      role={isSwitch ? "switch" : "button"}
      accessibilityLabel={props.label}
      accessibilityState={isSwitch ? { checked: props.on!() } : undefined}
      hitSlop={targetSlop(cs(76))}
      onPress={props.onPress}
      hoverStyle={{ backgroundColor: colors.raise() }}
      style={settingRow(props.focused())}
    >
      <Text style={labelText()}>{props.label}</Text>
      <View style={row(u(18))}>
        <If when={props.value}>
          <Text style={metaText()}>{props.value!()}</Text>
        </If>
        <If when={isSwitch} else={<Text style={{ ...metaText(), fontSize: cs(34), lineHeight: cs(34) }}>›</Text>}>
          <View style={track(props.on!())}>
            <View style={knob(props.on!())} />
          </View>
        </If>
      </View>
    </View>
  );
}
