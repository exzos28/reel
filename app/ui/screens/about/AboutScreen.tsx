// About reel: where its data comes from, as each source's terms ask. TMDB
// requires its logo with its notice: the logo is TMDB's official one
// (themoviedb.org/about/logos-attribution, "blue short", its CSS class
// written as a fill); the notice and the other sources come from the core
// (`Meta.attribution()`). Back closes it (the app's Back).
import { Image, Text, View, type ImageStyle, type TextStyle, type ViewStyle } from "nsh";
import { t } from "nsh/i18n";
import { Meta } from "../../native";
import { handleBack } from "../../nav";
import { bodyText, labelText, metaText, sectionTitle } from "../../kit/text";
import { PageHeader } from "../../layout/TopBar";
import { colors, safe, u } from "../../theme";
import tmdbLogo from "../../brand/tmdb.svg";

/** One source as the core lists it. */
interface Attribution {
  provider: string;
  name: string;
  url: string;
  notice: string | null;
  logoRequired: boolean;
}

const pageStyle = (): ViewStyle => ({ flex: 1, backgroundColor: colors.ink(), paddingHorizontal: safe().x, paddingVertical: safe().y, gap: u(40) });
const listStyle = (): ViewStyle => ({ gap: u(32), maxWidth: u(1100) });
/** The logo at 360 TV pixels wide, its own 273.42 × 35.52 proportions. */
const logoStyle = (): ImageStyle => ({ width: u(360), height: u((360 * 35.52) / 273.42) });
const nameStyle = (): TextStyle => ({ ...labelText(), fontWeight: 600 });
const noticeStyle = (): TextStyle => bodyText(colors.soft());

function Source(props: { source: () => Attribution }) {
  const s = props.source;
  return (
    <View style={{ gap: u(10) }}>
      <If when={s().provider === "tmdb"} else={<Text style={nameStyle()}>{s().name}</Text>}>
        <View accessibilityLabel={t("settings.about.tmdb_logo")}>
          <Image src={tmdbLogo} style={logoStyle()} />
        </View>
      </If>
      <If when={s().notice}>
        <Text style={noticeStyle()}>{s().notice!}</Text>
      </If>
      <Text style={metaText()}>{s().url}</Text>
    </View>
  );
}

export function AboutScreen() {
  const sources = JSON.parse(Meta.attribution()) as Attribution[];
  return (
    <View style={pageStyle()}>
      <PageHeader title={() => t("settings.about.title")} focused={() => false} onBack={handleBack} />
      <Text style={sectionTitle()}>{t("settings.about.data")}</Text>
      <View style={listStyle()}>
        <Each of={sources} key={(s) => s.provider}>
          {(s) => <Source source={s} />}
        </Each>
      </View>
    </View>
  );
}
