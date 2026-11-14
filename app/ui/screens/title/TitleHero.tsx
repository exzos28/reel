import { Text, View } from "nsh";
import { playLabel, releaseLine, releasesText, type Title } from "../../catalog";
import { Hero } from "../../layout/Hero";
import { actionsRow, ListButton, PlayButton, ReleaseButton, TrailerButton } from "../../layout/HeroActions";
import { colors, type, u } from "../../theme";

/** The hero's actions, left to right as the remote walks them: Play, the
 * list, the trailer when there is one, the release last (once the core
 * knows the release Play uses). */
export type HeroAction = "play" | "list" | "trailer" | "release";
export const heroActions = (title: Title): HeroAction[] => [
  "play",
  "list",
  ...(title.trailer ? (["trailer"] as const) : []),
  ...(title.release ? (["release"] as const) : []),
];

/** The hero of a film or a show: Play, Add to list, Trailer (when there is
 * one), and the release Play uses as a button that opens the releases (while
 * searching or with none, a line that says so). `focusedAt`: the index of
 * the focused action in `heroActions`. */
export function TitleHero(props: {
  data: () => Title;
  focusedAt: () => number | null;
  onPlay: () => void;
  onToggle: () => void;
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
      top={show() ? 150 : 176}
      fit
    >
      <View style={actionsRow(true)}>
        <PlayButton label={() => playLabel(props.data())} focused={focused("play")} onPress={props.onPlay} />
        <ListButton
          inList={() => props.data().inList}
          addKey="title.add_to_list"
          focused={focused("list")}
          onPress={props.onToggle}
        />
        <If when={props.data().trailer}>
          <TrailerButton focused={focused("trailer")} onPress={props.onTrailer} />
        </If>
        <If
          when={props.data().release}
          else={<Text style={{ ...type.meta(), fontSize: u(22), color: colors.ash(), marginLeft: u(12) }}>{releasesText(props.data())}</Text>}
        >
          <ReleaseButton name={() => line().name} rest={() => line().rest} focused={focused("release")} onPress={props.onReleases} />
        </If>
      </View>
    </Hero>
  );
}
