import { Text, View } from "nsh";
import { t } from "nsh/i18n";
import { pillSlop, pillStyle, pillWrap } from "../../kit/Pill";
import { row } from "../../kit/shape";
import { labelText, metaText } from "../../kit/text";
import { SectionTitle } from "../../layout/Section";
import { colors, u } from "../../theme";

/** The last searches as pills: OK (or a click) searches one again; "Clear history" beside the title
 * forgets them all (the focus reaches it after the last pill).
 * `focusedAt`: the pill the focus is on, `queries().length` for Clear, null while it is elsewhere. */
export function RecentSearches(props: {
  queries: () => string[];
  focusedAt: () => number | null;
  onPick: (i: number) => void;
  onClear: () => void;
}) {
  const clearFocused = () => props.focusedAt() === props.queries().length;
  return (
    <View style={{ gap: u(18) }}>
      <View style={row(u(28))}>
        <SectionTitle text={() => t("search.recent")} />
        <View
          testID="search-clear"
          role="button"
          hitSlop={pillSlop()}
          accessibilityLabel={t("search.clear")}
          onPress={props.onClear}
          hoverStyle={{ backgroundColor: colors.raise() }}
          style={pillStyle("transparent", clearFocused(), 22)}
        >
          <Text style={metaText(colors.soft())}>{t("search.clear")}</Text>
        </View>
      </View>
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
