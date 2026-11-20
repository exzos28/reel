import { computed, View, type ViewStyle } from "nsh";
import { playLabel, releaseLine, releasesText, type Title } from "../../catalog";
import { t } from "nsh/i18n";
import { StateLine } from "../../kit/StateLine";
import { openSettings } from "../../nav";
import { openSourceDrawer } from "../source/SourceDrawer";
import { Hero } from "../../layout/Hero";
import { wholeAboutInHero } from "./AboutBlock";
import { heroTop } from "../../layout/metrics";
import { actionsRow, PlayButton, SaveButton, SPLIT_HEIGHT, SplitPlay, TrailerButton } from "../../layout/HeroActions";
import { librarySupported, saveOffer, titleSaveState } from "../../library";
import { density, u } from "../../theme";
import type { HeroAction } from "./focus";

export type { HeroAction } from "./focus";

/** The release is still coming: the search runs, or releases are found and
 * the one Play uses is not picked yet. */
const releasePending = (title: Title) =>
  !title.release && (title.releasesState === "searching" || (title.releasesState === "done" && title.releases.length > 0));

/** Play shows the release inside it, with ⌄ for the others: once it is known, and while it comes. */
const splitPlay = (title: Title) => !!title.release || releasePending(title);

/** The hero's actions, left to right as the remote walks them: Play, its ⌄ (the other
 * releases, while there is or will be one), Save, Trailer (when there is one). Add to list is
 * the page's header action (`ListToggle`). */
export const heroActions = (title: Title): HeroAction[] => [
  "play",
  ...(splitPlay(title) ? (["releases"] as const) : []),
  // Save, where this device saves films (design/offline-downloads.md).
  ...(librarySupported ? (["save"] as const) : []),
  ...(title.trailer ? (["trailer"] as const) : []),
];

/** A phone stacks the block: Play the whole width, Save and Trailer halves under it. */
const stacked = density === "compact";
/** The phone's Save and Trailer, TV pixels (48 pt). */
const HALF_HEIGHT = 64;

/** The line saying why there is no release. */
const notePlace = (): ViewStyle => ({ marginTop: u(16), justifyContent: "center" });
/** No release because of the search source: none set (the drawer adds one) or it did not answer (Settings checks it). */
const sourceAction = (title: Title) =>
  title.releasesState === "no_source"
    ? { label: t("settings.source_drawer.missing_title"), onPress: openSourceDrawer }
    : title.releasesState === "failed"
      ? { label: t("releases.open_settings"), onPress: openSettings }
      : null;

/** The hero of a film or a show: Play with the release it plays inside it (⌄ opens the others;
 * while it is searched, a line that says so), Save and Trailer (when there is one); with no
 * release, Play alone and under the block a line that says why. `focused`: the focused action,
 * null when the focus is elsewhere. */
export function TitleHero(props: {
  data: () => Title;
  focused: () => HeroAction | null;
  onPlay: () => void;
  onTrailer: () => void;
  onSave: () => void;
  onReleases: () => void;
}) {
  const show = () => props.data().kind === "show";
  /** Asked once per second (and per change), not once per place that shows it. */
  const saveState = computed(() => titleSaveState(props.data().id, show()));
  /** A film's Save names what it takes ("Save · 700 MB"); a show's opens the drawer. */
  const saveSize = computed(() => (librarySupported && !show() ? saveOffer(props.data().id).size : null));
  const release = () => (props.data().release ? releaseLine(props.data().release!, false) : null);
  const focused = (a: HeroAction) => () => props.focused() === a;
  const height = stacked ? HALF_HEIGHT : SPLIT_HEIGHT;
  const play = () => (
    <If
      when={splitPlay(props.data())}
      else={
        <PlayButton label={() => playLabel(props.data())} focused={focused("play")} onPress={props.onPlay} height={SPLIT_HEIGHT} grow={stacked} />
      }
    >
      <SplitPlay
        label={() => playLabel(props.data())}
        release={release}
        pending={() => t("releases.state.searching")}
        progress={() => props.data().progress}
        playFocused={focused("play")}
        moreFocused={focused("releases")}
        onPlay={props.onPlay}
        onMore={props.onReleases}
        stretch={stacked}
      />
    </If>
  );
  const rest = () => (
    <>
      <If when={librarySupported}>
        <SaveButton
          state={saveState}
          show={show}
          size={saveSize}
          focused={focused("save")}
          onPress={props.onSave}
          // Nothing to save until a release is known (a film's search found none, or still runs);
          // what is saved already stays reachable.
          disabled={() => !show() && !props.data().release && saveState().state === "none"}
          height={height}
          grow={stacked}
        />
      </If>
      <If when={props.data().trailer}>
        <TrailerButton focused={focused("trailer")} onPress={props.onTrailer} height={height} grow={stacked} />
      </If>
    </>
  );
  return (
    <Hero
      item={props.data}
      height={show() ? 640 : 700}
      backdropLeft={show() ? 520 : 560}
      // The same size as Home's hero: the title's own page never shows it smaller.
      titleSize={88}
      top={heroTop("title", show() ? 150 : 176)}
      fit
      wholeAbout={wholeAboutInHero}
      wholeTitle={wholeAboutInHero}
    >
      <If
        when={stacked}
        else={
          <View style={actionsRow(false)}>
            {play()}
            {rest()}
          </View>
        }
      >
        <View style={actionsRow(false)}>{play()}</View>
        <If when={librarySupported || props.data().trailer}>
          <View style={actionsRow(false)}>{rest()}</View>
        </If>
      </If>
      <If when={!splitPlay(props.data())}>
        <View style={notePlace()}>
          <StateLine text={() => releasesText(props.data())} action={() => sourceAction(props.data())} />
        </View>
      </If>
    </Hero>
  );
}
