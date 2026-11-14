// Player: whether it shows the stream's details (speed, people, what is ready
// ahead). Off by default: the player then shows only a spinner when it waits.
import { Text, View, type ViewStyle } from "nsh";
import { t } from "nsh/i18n";
import { Icon } from "../../kit/Icon";
import { rowStyle } from "../../kit/Row";
import { bodyText, labelText, sectionTitle } from "../../kit/text";
import { streamDetails, toggleStreamDetails } from "../../preferences";
import { colors, u } from "../../theme";
import checkIcon from "../../icons/check.svg";

const toggleRowStyle = (on: boolean, focused: boolean): ViewStyle => ({
  ...rowStyle(on, focused),
  justifyContent: "space-between",
  height: u(68),
  paddingHorizontal: u(28),
});

export function DetailsSection(props: { focused: () => boolean; onFocus: () => void }) {
  return [
    <View style={{ gap: u(10), maxWidth: u(980) }}>
      <Text style={sectionTitle()}>{t("settings.details.title")}</Text>
      <Text style={bodyText(colors.soft())}>{t("settings.details.about")}</Text>
    </View>,
    <View style={{ maxWidth: u(720) }}>
      <View
        role="switch"
        accessibilityState={{ checked: streamDetails() }}
        onPress={() => {
          props.onFocus();
          toggleStreamDetails();
        }}
        hoverStyle={{ backgroundColor: colors.raise() }}
        style={toggleRowStyle(streamDetails(), props.focused())}
      >
        <Text style={labelText()}>{t("settings.details.show")}</Text>
        <If when={streamDetails()}>
          <View accessibilityLabel={t("settings.selected")}>
            <Icon src={() => checkIcon} size={26} />
          </View>
        </If>
      </View>
    </View>,
  ];
}
