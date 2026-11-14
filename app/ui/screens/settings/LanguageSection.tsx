// Language: what titles, descriptions and episode names are shown in (the
// core asks TMDB for that translation). Each language is named in itself.
import { Text, View, type ViewStyle } from "nsh";
import { t } from "nsh/i18n";
import { Icon } from "../../kit/Icon";
import { rowStyle } from "../../kit/Row";
import { bodyText, labelText, sectionTitle } from "../../kit/text";
import { chooseContentLanguage, contentLanguage, contentLanguages, type ContentLanguage } from "../../preferences";
import { colors, u } from "../../theme";
import checkIcon from "../../icons/check.svg";

const languageRowStyle = (selected: boolean, focused: boolean): ViewStyle => ({
  ...rowStyle(selected, focused),
  justifyContent: "space-between",
  height: u(68),
  paddingHorizontal: u(28),
});

function LanguageRow(props: { language: () => ContentLanguage; selected: () => boolean; focused: () => boolean; onPress: () => void }) {
  return (
    <View
      role="button"
      accessibilityState={{ selected: props.selected() }}
      onPress={props.onPress}
      hoverStyle={{ backgroundColor: colors.raise() }}
      style={languageRowStyle(props.selected(), props.focused())}
    >
      <Text style={labelText()}>{props.language().name}</Text>
      <If when={props.selected()}>
        <View accessibilityLabel={t("settings.selected")}>
          <Icon src={() => checkIcon} size={26} />
        </View>
      </If>
    </View>
  );
}

/** `focusedAt` counts from the first language. */
export function LanguageSection(props: { focusedAt: () => number; onFocus: (i: number) => void }) {
  return [
    <View style={{ gap: u(10), maxWidth: u(980) }}>
      <Text style={sectionTitle()}>{t("settings.language.title")}</Text>
      <Text style={bodyText(colors.soft())}>{t("settings.language.about")}</Text>
    </View>,
    <View style={{ gap: u(12), maxWidth: u(720) }}>
      <Each of={contentLanguages()} key={(l) => l.tag}>
        {(language, i) => (
          <LanguageRow
            language={language}
            selected={() => contentLanguage() === language().tag}
            focused={() => props.focusedAt() === i()}
            onPress={() => {
              props.onFocus(i());
              chooseContentLanguage(language().tag);
            }}
          />
        )}
      </Each>
    </View>,
  ];
}
