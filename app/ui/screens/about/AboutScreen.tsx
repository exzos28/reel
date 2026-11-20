// About reel: where its data comes from, as each source's terms ask. TMDB
// requires its logo with its notice: the logo is TMDB's official one
// (themoviedb.org/about/logos-attribution, "blue short", its CSS class
// written as a fill); the notice and the other sources come from the core
// (`Meta.attribution()`). Back closes it (the app's Back).
import { appInfo, Image, openUrl, Text, View, type ImageStyle, type TextStyle, type ViewStyle } from "nsh";
import { t } from "nsh/i18n";
import { Meta } from "../../native";
import { bodyText, labelText, metaText, sectionTitle } from "../../kit/text";
import { PageFrame } from "../../layout/PageFrame";
import { scroller } from "../../layout/Scroller";
import { caps } from "../../platform";
import { colors, safe, targetSlop, u } from "../../theme";
import tmdbLogo from "../../brand/tmdb.svg";
import { Pressable } from "../../kit/Pressable";

/** One source as the core lists it. */
interface Attribution {
  provider: string;
  name: string;
  url: string;
  notice: string | null;
  logoRequired: boolean;
}

/** The sources under the page's title (the frame's). */
const pageStyle = (): ViewStyle => ({ paddingHorizontal: safe().x, paddingTop: u(40), gap: u(40) });
const listStyle = (): ViewStyle => ({ gap: u(32), maxWidth: u(1100) });
/** The logo at 360 TV pixels wide, its own 273.42 × 35.52 proportions. */
const logoStyle = (): ImageStyle => ({ width: u(360), height: u((360 * 35.52) / 273.42) });
const nameStyle = (): TextStyle => ({ ...labelText(), fontWeight: 600 });
const noticeStyle = (): TextStyle => bodyText(colors.soft());
/** A link: white and underlined where a finger or a pointer opens it; a TV only shows it. */
const linkStyle = (): TextStyle => (caps.remote ? metaText() : { ...metaText(colors.snow()), textDecorationLine: "underline" });
const open = (url: string) => openUrl(url).catch((e) => console.warn(`reel: ${url} did not open: ${e}`));

function Source(props: { source: () => Attribution }) {
  const s = props.source;
  return (
    <View style={{ gap: u(10) }}>
      <If when={s().provider === "tmdb"} else={<Text style={nameStyle()}>{s().name}</Text>}>
        <View accessibilityLabel={t("settings.about.tmdb_logo")} style={{ marginBottom: u(10) }}>
          <Image src={tmdbLogo} style={logoStyle()} />
        </View>
      </If>
      <If when={s().notice}>
        <Text style={noticeStyle()}>{s().notice!}</Text>
      </If>
      <If when={!caps.remote} else={<Text style={metaText()}>{s().url}</Text>}>
        <Pressable role="link" accessibilityLabel={s().url} onPress={() => open(s().url)} hitSlop={targetSlop(20)} style={{ alignSelf: "flex-start" }}>
          <Text style={linkStyle()}>{s().url}</Text>
        </Pressable>
      </If>
    </View>
  );
}

export function AboutScreen() {
  const sources = JSON.parse(Meta.attribution()) as Attribution[];
  const page = scroller({ anchor: () => 0 });
  return (
    <PageFrame ctl={page} kind="deep" title={() => t("settings.about.title")}>
      <View style={pageStyle()}>
      <Text style={sectionTitle()}>{t("settings.about.data")}</Text>
      <View style={listStyle()}>
        <Each of={sources} key={(s) => s.provider}>
          {(s) => <Source source={s} />}
        </Each>
      </View>
      <Text style={metaText()}>{t("settings.about.version", { version: appInfo().version ?? "", build: appInfo().build ?? "" })}</Text>
      </View>
    </PageFrame>
  );
}
