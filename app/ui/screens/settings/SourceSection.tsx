// Settings' Search source section: what a source is, then its fields (and on a TV, the
// address of the settings page to set it from a phone).
import { Text, View } from "nsh";
import { t } from "nsh/i18n";
import { formWidth } from "../../kit/form";
import { bodyText, sectionTitle } from "../../kit/text";
import { colors, u } from "../../theme";
import { SourceByPhone, SourceForm } from "../source/SourceForm";
import { sourceForm } from "../source/sourceState";

export function SourceSection() {
  const form = sourceForm();
  return (
    <View style={{ gap: u(14), maxWidth: formWidth() }}>
      <Text style={sectionTitle()}>{t("settings.source.title")}</Text>
      <Text style={bodyText(colors.soft())}>{t("settings.source.about")}</Text>
      <SourceByPhone />
      <SourceForm form={form} />
    </View>
  );
}
