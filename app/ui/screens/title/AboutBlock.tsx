// Under the hero (and the releases or episodes): the whole overview when the
// hero cut it, then who made it, a line per job ("Director  Lana Wachowski").
import { Text, View, type TextStyle, type ViewStyle } from "nsh";
import { t } from "nsh/i18n";
import { aboutText, crewLabel, namesText, type Title } from "../../catalog";
import { bodyText, labelText, metaText } from "../../kit/text";
import { SectionTitle } from "../../layout/Section";
import { colors, safe, u } from "../../theme";

const blockStyle = (): ViewStyle => ({ paddingHorizontal: safe().x, gap: u(18), maxWidth: u(1400) });
const overviewStyle = (): TextStyle => ({ ...bodyText(colors.soft()), maxWidth: u(1180) });
const crewRow = (): ViewStyle => ({ flexDirection: "row", gap: u(24), alignItems: "baseline" });
const crewLabelStyle = (): TextStyle => ({ ...metaText(), width: u(220) });
const crewNames = (): TextStyle => ({ ...labelText(), fontWeight: 400, flexShrink: 1 });

export function AboutBlock(props: { data: () => Title }) {
  const d = props.data;
  return (
    <View style={blockStyle()}>
      <SectionTitle text={() => t("about.title")} />
      <If when={d().aboutFull}>
        <Text style={overviewStyle()}>{aboutText(d())}</Text>
      </If>
      <View style={{ gap: u(10) }}>
        <Each of={d().crew} key={(g) => g.job}>
          {(g) => (
            <View style={crewRow()}>
              <Text style={crewLabelStyle()}>{crewLabel(g())}</Text>
              <Text style={crewNames()}>{namesText(g().names)}</Text>
            </View>
          )}
        </Each>
      </View>
    </View>
  );
}

/** Whether the About block has anything to show. */
export const hasAbout = (d: Title) => d.aboutFull || d.crew.length > 0;
