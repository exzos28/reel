// About reel: its license and source code (`Settings.project()`), then where its data comes from,
// as each source's terms ask. TMDB requires its logo with its notice: the logo is TMDB's
// official one (themoviedb.org/about/logos-attribution, "blue short", its CSS class written as a
// fill); the notice and the other sources come from the core (`Meta.attribution()`). Links are
// titled by name where a finger or a pointer opens them; a TV, which opens none, shows the
// address. Back closes it (the app's Back).
import { appInfo, Image, openUrl, Text, View, type ImageStyle, type TextStyle, type ViewStyle } from "nsh";
import { t } from "nsh/i18n";
import { Meta, Settings } from "../../native";
import { bodyText, labelText, metaText, sectionTitle } from "../../kit/text";
import { PageFrame } from "../../layout/PageFrame";
import { scroller } from "../../layout/Scroller";
import { caps } from "../../platform";
import { colors, safe, targetSlop, u } from "../../theme";
import tmdbLogo from "../../brand/tmdb.svg";
import { Pressable } from "../../kit/Pressable";

/** reel itself, as the core says it. */
interface Project {
  license: string;
  repository: string;
}

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
/** A link's line: underlined (a TV's links are text, not underlined). */
const linkLine: TextStyle = { textDecorationLine: "underline" };
/** A plain link's text (TMDB's under its notice). */
const linkStyle = (): TextStyle => metaText(colors.snow());
const open = (url: string) => openUrl(url).catch((e) => console.warn(`reel: ${url} did not open: ${e}`));

/** A link titled by its name; a TV shows the name and the address under it instead. */
function Link(props: { name: () => string; url: () => string; nameStyle: () => TextStyle }) {
  return (
    <If
      when={!caps.remote}
      else={
        <View style={{ gap: u(10) }}>
          <Text style={props.nameStyle()}>{props.name()}</Text>
          <Text style={metaText()}>{props.url()}</Text>
        </View>
      }
    >
      <Pressable role="link" accessibilityLabel={props.name()} onPress={() => open(props.url())} hitSlop={targetSlop(20)} style={{ alignSelf: "flex-start" }}>
        <Text style={{ ...props.nameStyle(), ...linkLine }}>{props.name()}</Text>
      </Pressable>
    </If>
  );
}

function Source(props: { source: () => Attribution }) {
  const s = props.source;
  const tmdb = () => s().provider === "tmdb";
  return (
    <View style={{ gap: u(10) }}>
      <If when={tmdb()}>
        <View accessibilityLabel={t("settings.about.tmdb_logo")} style={{ marginBottom: u(10) }}>
          <Image src={tmdbLogo} style={logoStyle()} />
        </View>
      </If>
      <If when={s().notice}>
        <Text style={noticeStyle()}>{s().notice!}</Text>
      </If>
      {/* TMDB's link under its logo and notice is its full name; the others' is their name. */}
      <Link name={() => (tmdb() ? t("settings.about.tmdb_logo") : s().name)} url={() => s().url} nameStyle={tmdb() ? linkStyle : nameStyle} />
    </View>
  );
}

/** The license and the source code. */
function ProjectBlock(props: { project: Project }) {
  return (
    <View style={{ gap: u(10) }}>
      <Text style={noticeStyle()}>{t("settings.about.license", { license: props.project.license })}</Text>
      <Link name={() => t("settings.about.repository")} url={() => props.project.repository} nameStyle={nameStyle} />
    </View>
  );
}

export function AboutScreen() {
  const sources = JSON.parse(Meta.attribution()) as Attribution[];
  const project = JSON.parse(Settings.project()) as Project;
  const page = scroller({ anchor: () => 0 });
  return (
    <PageFrame ctl={page} kind="deep" title={() => t("settings.about.title")}>
      <View style={pageStyle()}>
      <ProjectBlock project={project} />
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
