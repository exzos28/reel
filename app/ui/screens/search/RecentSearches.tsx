import { Text, View } from "nsh";
import { t } from "nsh/i18n";
import { pillSlop, pillStyle, pillWrap } from "../../kit/Pill";
import { labelText } from "../../kit/text";
import { SectionTitle } from "../../layout/Section";
import { colors, u } from "../../theme";

/** The last searches as pills: OK (or a click) searches one again.
 * `focusedAt`: the pill the focus is on, null while it is elsewhere. */
export function RecentSearches(props: {
  queries: () => string[];
  focusedAt: () => number | null;
  onPick: (i: number) => void;
}) {
  return (
    <View style={{ gap: u(18) }}>
      <SectionTitle text={() => t("search.recent")} />
      <View style={pillWrap(16)}>
        <Each of={props.queries()} key={(q) => q}>
          {(q, i) => (
            <View
              role="button"
              hitSlop={pillSlop()}
              accessibilityLabel={q()}
              onPress={() => props.onPick(i())}
              hoverStyle={{ backgroundColor: colors.raise() }}
              style={pillStyle(colors.card(), props.focusedAt() === i(), 28)}
            >
              <Text style={labelText()}>{q()}</Text>
            </View>
          )}
        </Each>
      </View>
    </View>
  );
}
