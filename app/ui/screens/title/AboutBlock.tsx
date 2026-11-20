// Under the hero (and the releases or episodes): the whole overview when a TV's
// hero cut it, then who made it, a line per job ("Director  Lana Wachowski").
import { Text, View, type TextStyle, type ViewStyle } from "nsh";
import { t } from "nsh/i18n";
import { aboutText, crewLabel, namesText, type Title } from "../../catalog";
import { bodyText, labelText, metaText } from "../../kit/text";
import { SectionTitle } from "../../layout/Section";
import { heroFollowsWindow } from "../../layout/metrics";
import { caps } from "../../platform";
import { colors, insetMaxWidth, safe, u } from "../../theme";

/** A desktop's title hero shows the whole about (a pointer reads it there, no remote has to
 * scroll past it); a TV's and touch's cut it to three lines. */
export const wholeAboutInHero = heroFollowsWindow;
/** On touch a tap on the hero's about shows it whole; a TV's remote never stops on it, so this
 * block shows it whole there. */
export const aboutExpandsInHero = caps.touch && !wholeAboutInHero;
/** The whole overview here: only on a TV, where the hero cut it. */
const overviewHere = (d: Title) => d.aboutFull && !wholeAboutInHero && !aboutExpandsInHero;

/** At the inset, as wide as in an ordinary window (a wide window's inset moves it, not narrows it). */
const blockStyle = (): ViewStyle => ({ paddingHorizontal: safe().x, gap: u(18), maxWidth: insetMaxWidth(1400) });
const overviewStyle = (): TextStyle => ({ ...bodyText(colors.soft()), maxWidth: u(1180) });
const crewRow = (): ViewStyle => ({ flexDirection: "row", gap: u(24), alignItems: "baseline" });
const crewLabelStyle = (): TextStyle => ({ ...metaText(), width: u(220) });
const crewNames = (): TextStyle => ({ ...labelText(), fontWeight: 400, flexShrink: 1 });

export function AboutBlock(props: { data: () => Title }) {
  const d = props.data;
  return (
    <View style={blockStyle()}>
      <SectionTitle text={() => t("about.title")} />
      <If when={overviewHere(d())}>
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
export const hasAbout = (d: Title) => overviewHere(d) || d.crew.length > 0;
