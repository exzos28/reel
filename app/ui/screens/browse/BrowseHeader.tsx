import { Text, View } from "nsh";
import { t } from "nsh/i18n";
import { bodyText, sectionTitle } from "../../kit/text";
import { safe, u } from "../../theme";
import type { Page } from "./focus";

/** The page's grey lead under its title (the frame's) and the trending row's title. */
export function BrowseHeader(props: { page: Page }) {
  return (
    <View style={{ paddingHorizontal: safe().x }}>
      <Text style={{ ...bodyText(), marginTop: u(8) }}>{t(`browse.${props.page}.lead`)}</Text>
      <Text style={{ ...sectionTitle(), marginTop: u(34) }}>{t(`browse.${props.page}.trending`)}</Text>
    </View>
  );
}
