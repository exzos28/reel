// Search: not built yet; says so and offers Back.
import { keymap, Text, View, type ViewStyle } from "nsh";
import { t } from "nsh/i18n";
import { bodyText, pageTitle } from "../../kit/text";
import { BackButton } from "../../layout/BackButton";
import { back } from "../../nav";
import { colors, safe, u } from "../../theme";

const screenStyle = (): ViewStyle => ({
  flex: 1,
  backgroundColor: colors.ink(),
  paddingHorizontal: safe().x,
  paddingTop: safe().y,
  gap: u(32),
});

export function SearchScreen() {
  keymap.bind({ escape: back, enter: back });
  return (
    <View style={screenStyle()}>
      <BackButton focused={() => true} onPress={back} />
      <Text style={pageTitle()}>{t("search.title")}</Text>
      <Text style={{ ...bodyText(), maxWidth: u(1000) }}>{t("search.soon")}</Text>
    </View>
  );
}
