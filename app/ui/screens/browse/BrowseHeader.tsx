import { Text, View } from "nsh";
import { t } from "nsh/i18n";
import { bodyText } from "../../kit/text";
import { safe, u } from "../../theme";
import type { Page } from "./focus";

/** The page's grey lead under its title (the frame's); the trending row titles itself. */
export function BrowseHeader(props: { page: Page }) {
  return (
    <View style={{ paddingHorizontal: safe().x }}>
      <Text style={{ ...bodyText(), marginTop: u(8) }}>{t(`browse.${props.page}.lead`)}</Text>
    </View>
  );
}
