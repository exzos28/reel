// The facts of a title in two columns of label and value: tagline, original
// title, release date, a series' status, countries, studios. A film's runtime is not here: the
// hero's line says it.
import { Text, View, type TextStyle, type ViewStyle } from "nsh";
import { t } from "nsh/i18n";
import { dateText, namesText, statusText, type Title } from "../../catalog";
import { labelText, metaText } from "../../kit/text";
import { SectionTitle } from "../../layout/Section";
import { safe, u } from "../../theme";

const blockStyle = (): ViewStyle => ({ paddingHorizontal: safe().x, gap: u(18) });
const gridStyle = (): ViewStyle => ({ flexDirection: "row", flexWrap: "wrap", columnGap: u(48), rowGap: u(18), maxWidth: u(1500) });
const cellStyle = (): ViewStyle => ({ width: u(700), gap: u(4) });
const valueStyle = (): TextStyle => ({ ...labelText(), fontWeight: 400 });

/** The rows that have a value: [label key, value]. */
function facts(d: Title): [string, string][] {
  const show = d.kind === "show";
  const rows: [string, string | null][] = [
    ["tagline", d.tagline],
    ["original_title", d.originalTitle],
    [show ? "first_aired" : "release_date", d.releaseDate ? dateText(d.releaseDate) : null],
    ["status", show && d.status ? statusText(d.status) : null],
    ["countries", d.countries.length ? namesText(d.countries) : null],
    [show ? "networks" : "studios", d.studios.length ? namesText(d.studios) : null],
  ];
  return rows.filter((r): r is [string, string] => !!r[1]);
}

export const hasDetails = (d: Title) => facts(d).length > 0;

/** `bare`: in a column of its own (beside About), which gives the inset and the width. */
export function DetailsBlock(props: { data: () => Title; bare?: boolean }) {
  return (
    <View style={props.bare ? { gap: u(18) } : blockStyle()}>
      <SectionTitle text={() => t("about.details")} />
      <View style={gridStyle()}>
        <Each of={facts(props.data())} key={(r) => r[0]}>
          {(r) => (
            <View style={cellStyle()}>
              <Text style={metaText()}>{t(`detail.${r()[0]}`)}</Text>
              <Text style={valueStyle()}>{r()[1]}</Text>
            </View>
          )}
        </Each>
      </View>
    </View>
  );
}
