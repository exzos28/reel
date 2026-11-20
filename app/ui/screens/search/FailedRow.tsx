// A row of Search's results whose source did not answer (the core says
// "failed"): its title, why it is empty, and Try again. A stop for the remote
// like a row of cards; OK on it is Try again.
import { Text, View, type ViewRef } from "nsh";
import { t } from "nsh/i18n";
import { Button } from "../../kit/Button";
import { row } from "../../kit/shape";
import { metaText } from "../../kit/text";
import { SectionTitle } from "../../layout/Section";
import { safe, u } from "../../theme";

const lineStyle = () => ({ ...row(u(24)), paddingHorizontal: safe().x });

export function FailedRow(props: {
  id: () => "movies" | "shows" | "anime";
  focused: () => boolean;
  blockRef: (r: ViewRef) => void;
  onRetry: () => void;
}) {
  return (
    <View ref={props.blockRef} testID={`search-failed-${props.id()}`} style={{ gap: u(22) }}>
      <SectionTitle text={() => t(`search.section.${props.id()}`)} inset />
      <View style={lineStyle()}>
        <Text style={metaText()}>{t(`search.row_failed.${props.id()}`)}</Text>
        <Button kind="secondary" height={52} label={() => t("search.try_again")} focused={props.focused} onPress={props.onRetry} />
      </View>
    </View>
  );
}
