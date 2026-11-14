// A setting's row: what is in effect, with a chevron; OK or a click opens its
// choices in a drawer (ChoicePanel).
import { Text, View, type ViewStyle } from "nsh";
import { Icon } from "../../kit/Icon";
import { rowStyle } from "../../kit/Row";
import { labelText } from "../../kit/text";
import { colors, u } from "../../theme";
import chevronIcon from "../../icons/chevron.svg";

const pickerRowStyle = (focused: boolean): ViewStyle => ({
  ...rowStyle(false, focused),
  justifyContent: "space-between",
  height: u(68),
  paddingHorizontal: u(28),
});

export function PickerRow(props: { label: string; value: () => string; focused: () => boolean; onOpen: () => void }) {
  return (
    <View style={{ maxWidth: u(720) }}>
      <View
        role="button"
        accessibilityLabel={props.label}
        onPress={props.onOpen}
        hoverStyle={{ backgroundColor: colors.raise() }}
        style={pickerRowStyle(props.focused())}
      >
        <Text style={labelText()}>{props.value()}</Text>
        {/* The chevron points down: turned to the right, a list opens there. */}
        <View style={{ transform: "rotate(-90deg)" }}>
          <Icon src={() => chevronIcon} size={22} color={() => colors.soft()} />
        </View>
      </View>
    </View>
  );
}
