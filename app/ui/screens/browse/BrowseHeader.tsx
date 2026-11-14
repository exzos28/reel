import { Text, View } from "nsh";
import { t } from "nsh/i18n";
import { bodyText, pageTitle, sectionTitle } from "../../kit/text";
import { safe, u } from "../../theme";
import type { Page } from "./focus";

/** The page's title (24 TV pixels under the nav), its grey lead and the
 * trending row's title. */
export function BrowseHeader(props: { page: Page }) {
  return (
    <View style={{ paddingHorizontal: safe().x, marginTop: u(24) }}>
      <Text style={pageTitle()}>{t(`browse.${props.page}.title`)}</Text>
      <Text style={{ ...bodyText(), marginTop: u(8) }}>{t(`browse.${props.page}.lead`)}</Text>
      <Text style={{ ...sectionTitle(), marginTop: u(34) }}>{t(`browse.${props.page}.trending`)}</Text>
    </View>
  );
}
