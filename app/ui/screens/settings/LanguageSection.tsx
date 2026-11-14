// Language: what titles, descriptions and episode names are shown in (the
// core asks TMDB for that translation). One row with the language in effect;
// the choices open in a panel on the right. Each language is named in itself.
import { Text, View, type ViewStyle } from "nsh";
import { t } from "nsh/i18n";
import { Icon } from "../../kit/Icon";
import { rowStyle } from "../../kit/Row";
import { bodyText, labelText, sectionTitle } from "../../kit/text";
import { contentLanguage, contentLanguages } from "../../preferences";
import { colors, u } from "../../theme";
import chevronIcon from "../../icons/chevron.svg";
import type { Choice } from "../../layout/ChoicePanel";

const languageRowStyle = (focused: boolean): ViewStyle => ({
  ...rowStyle(false, focused),
  justifyContent: "space-between",
  height: u(68),
  paddingHorizontal: u(28),
});

/** The language in effect, named in itself. */
const currentName = () => contentLanguages().find((l) => l.tag === contentLanguage())?.name ?? contentLanguage();

/** The section: what it does, and one row with the language in effect; OK or a click
 * opens the choices in a panel on the right (`onOpen`). */
export function LanguageSection(props: { focused: () => boolean; onOpen: () => void }) {
  return [
    <View style={{ gap: u(10), maxWidth: u(980) }}>
      <Text style={sectionTitle()}>{t("settings.language.title")}</Text>
      <Text style={bodyText(colors.soft())}>{t("settings.language.about")}</Text>
    </View>,
    <View style={{ maxWidth: u(720) }}>
      <View
        role="button"
        accessibilityLabel={t("settings.language.title")}
        onPress={props.onOpen}
        hoverStyle={{ backgroundColor: colors.raise() }}
        style={languageRowStyle(props.focused())}
      >
        <Text style={labelText()}>{currentName()}</Text>
        {/* The chevron points down: turned to the right, a list opens there. */}
        <View style={{ transform: "rotate(-90deg)" }}>
          <Icon src={() => chevronIcon} size={22} color={() => colors.soft()} />
        </View>
      </View>
    </View>,
  ];
}

/** The languages as the choice panel lists them. */
export const languageChoices = (): Choice[] =>
  contentLanguages().map((l) => ({ key: l.tag, text: l.name, selected: l.tag === contentLanguage() }));
