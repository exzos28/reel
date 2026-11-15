import { Text, View, type TextStyle, type ViewStyle } from "nsh";
import { playLabel, releaseLine, releasesText, type Title } from "../../catalog";
import { Hero } from "../../layout/Hero";
import { heroTop } from "../../layout/metrics";
import { actionsRow, PlayButton, ReleaseButton, TrailerButton } from "../../layout/HeroActions";
import { rounded } from "../../kit/shape";
import { alpha, colors, cs, ts, type, u } from "../../theme";

/** The hero's action row, left to right as the remote walks it: Play, then
 * the trailer when there is one. Add to list is the page's header action
 * (`ListToggle`); the release button has its own line under the row. */
export type HeroAction = "play" | "trailer";
export const heroActions = (title: Title): HeroAction[] => ["play", ...(title.trailer ? (["trailer"] as const) : [])];

/** The release row's place: the button's height and its margin over it, so
 * nothing moves when the release arrives. */
const rowPlace = (): ViewStyle => ({ height: cs(60), marginTop: u(16), justifyContent: "center" });
const releasesNote = (): TextStyle => ({ ...type.meta(), fontSize: ts(22), color: colors.ash() });
/** The release row while the release is not known yet: the button's size,
 * pulsing as the release list's skeleton does. */
const skeletonStyle = (): ViewStyle => ({
  ...rowPlace(),
  width: cs(560),
  ...rounded(),
  backgroundColor: alpha(colors.snow(), 0.05),
  animationName: "pulse",
  animationDuration: 1400,
  animationIterationCount: "infinite",
  animationFrameRate: 30,
});

/** The release is still coming: the search runs, or releases are found and
 * the one Play uses is not picked yet. */
const releasePending = (title: Title) =>
  !title.release && (title.releasesState === "searching" || (title.releasesState === "done" && title.releases.length > 0));

/** The hero of a film or a show: Play and Trailer (when there is one), then
 * the release Play uses as a button that opens the releases (while searching
 * or with none, a line that says so). `focusedAt`: the index of the focused
 * action in `heroActions`; `releaseFocused`: the release button. */
export function TitleHero(props: {
  data: () => Title;
  focusedAt: () => number | null;
  releaseFocused: () => boolean;
  onPlay: () => void;
  onTrailer: () => void;
  onReleases: () => void;
}) {
  const show = () => props.data().kind === "show";
  const line = () => releaseLine(props.data().release!, false);
  const focused = (a: HeroAction) => () => {
    const at = props.focusedAt();
    return at !== null && heroActions(props.data())[at] === a;
  };
  return (
    <Hero
      item={props.data}
      height={show() ? 640 : 700}
      backdropLeft={show() ? 520 : 560}
      titleSize={show() ? 76 : 88}
      top={heroTop("title", show() ? 150 : 176)}
      fit
    >
      <View style={actionsRow(false)}>
        <PlayButton label={() => playLabel(props.data())} focused={focused("play")} onPress={props.onPlay} />
        <If when={props.data().trailer}>
          <TrailerButton focused={focused("trailer")} onPress={props.onTrailer} />
        </If>
      </View>
      {/* Its own row under the actions: the button, a skeleton while it is coming
          (not focusable), or the line saying why there is none, all the same height. */}
      <If when={!props.data().release && releasePending(props.data())}>
        <View testID="release-row-skeleton" style={{ flexDirection: "row" }}>
          <View style={skeletonStyle()} />
        </View>
      </If>
      <If when={!props.data().release && !releasePending(props.data())}>
        <View style={rowPlace()}>
          <Text style={releasesNote()}>{releasesText(props.data())}</Text>
        </View>
      </If>
      <If when={props.data().release}>
        <View style={{ flexDirection: "row" }}>
          <ReleaseButton name={() => line().name} rest={() => line().rest} focused={props.releaseFocused} onPress={props.onReleases} />
        </View>
      </If>
    </Hero>
  );
}
