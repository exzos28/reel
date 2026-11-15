// Player: whether it shows the stream's details (speed, people, what is ready
// ahead). Off by default: the player then shows only a spinner when it waits.
import { Text, View, type ViewStyle } from "nsh";
import { t } from "nsh/i18n";
import { formWidth } from "../../kit/form";
import { rowStyle } from "../../kit/Row";
import { rounded } from "../../kit/shape";
import { bodyText, labelText, sectionTitle } from "../../kit/text";
import { streamDetails, toggleStreamDetails } from "../../preferences";
import { colors, cs, u } from "../../theme";

const toggleRowStyle = (on: boolean, focused: boolean): ViewStyle => ({
  ...rowStyle(on, focused),
  justifyContent: "space-between",
  height: cs(68),
  paddingHorizontal: cs(28),
});

/** A switch: a track with a knob, at the right when on (the track white), at the left when off. */
const trackStyle = (on: boolean): ViewStyle => ({
  width: cs(64),
  height: cs(36),
  padding: cs(4),
  ...rounded(999),
  alignItems: on ? "flex-end" : "flex-start",
  backgroundColor: on ? colors.snow() : colors.raise(),
});
const knobStyle = (on: boolean): ViewStyle => ({ width: cs(28), height: cs(28), ...rounded(999), backgroundColor: on ? colors.ink() : colors.ash() });

export function DetailsSection(props: { focused: () => boolean; onFocus: () => void }) {
  return [
    <View style={{ gap: u(10), maxWidth: formWidth() }}>
      <Text style={sectionTitle()}>{t("settings.details.title")}</Text>
      <Text style={bodyText(colors.soft())}>{t("settings.details.about")}</Text>
    </View>,
    <View style={{ maxWidth: formWidth() }}>
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
        <View style={trackStyle(streamDetails())}>
          <View style={knobStyle(streamDetails())} />
        </View>
      </View>
    </View>,
  ];
}
