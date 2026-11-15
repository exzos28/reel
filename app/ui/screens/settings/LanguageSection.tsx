// Language: what titles, descriptions and episode names are shown in (the
// core asks TMDB for that translation). One row with the language in effect;
// the choices open in a drawer. Each language is named in itself.
import { Text, View } from "nsh";
import { formWidth } from "../../kit/form";
import { t } from "nsh/i18n";
import { bodyText, sectionTitle } from "../../kit/text";
import type { Choice } from "../../layout/ChoicePanel";
import { contentLanguage, contentLanguages } from "../../preferences";
import { colors, u } from "../../theme";
import { PickerRow } from "./PickerRow";

/** The language in effect, named in itself. */
const currentName = () => contentLanguages().find((l) => l.tag === contentLanguage())?.name ?? contentLanguage();

export function LanguageSection(props: { focused: () => boolean; onOpen: () => void }) {
  return [
    <View style={{ gap: u(10), maxWidth: formWidth() }}>
      <Text style={sectionTitle()}>{t("settings.language.title")}</Text>
      <Text style={bodyText(colors.soft())}>{t("settings.language.about")}</Text>
    </View>,
    <PickerRow label={t("settings.language.title")} value={currentName} focused={props.focused} onOpen={props.onOpen} />,
  ];
}

/** The languages as the drawer lists them. */
export const languageChoices = (): Choice[] =>
  contentLanguages().map((l) => ({ key: l.tag, text: l.name, selected: l.tag === contentLanguage() }));
