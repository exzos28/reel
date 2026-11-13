import { Text, View, type ViewStyle } from "nsh";
import { t } from "nsh/i18n";
import { Fmt } from "app/native";
import type { BufferChoice } from "../../preferences";
import { Icon } from "../../kit/Icon";
import { rowStyle } from "../../kit/Row";
import { labelText } from "../../kit/text";
import { colors, u } from "../../theme";
import checkIcon from "../../icons/check.svg";

const bufferRowStyle = (selected: boolean, focused: boolean): ViewStyle => ({
  ...rowStyle(selected, focused),
  justifyContent: "space-between",
  height: u(68),
  paddingHorizontal: u(28),
});

/** A buffer size: "256 MB  Default"; the chosen one is selected (lighter,
 * with a check). */
export function BufferRow(props: { choice: () => BufferChoice; selected: () => boolean; focused: () => boolean; onPress: () => void }) {
  const c = props.choice;
  return (
    <View
      role="button"
      accessibilityState={{ selected: props.selected() }}
      onPress={props.onPress}
      hoverStyle={{ backgroundColor: colors.raise() }}
      style={bufferRowStyle(props.selected(), props.focused())}
    >
      <Text style={labelText()}>
        {Fmt.size(c().mb * 1024 * 1024)}
        <Text style={{ fontWeight: 400, color: colors.ash() }}>{c().default ? `  ${t("settings.buffer.default")}` : ""}</Text>
      </Text>
      <If when={props.selected()}>
        <View accessibilityLabel={t("settings.selected")}>
          <Icon src={() => checkIcon} size={26} />
        </View>
      </If>
    </View>
  );
}
