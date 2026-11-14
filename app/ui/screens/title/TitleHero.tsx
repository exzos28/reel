import { Text, View } from "nsh";
import { playLabel, releaseLine, releasesText, type Title } from "../../catalog";
import { Hero } from "../../layout/Hero";
import { actionsRow, ListButton, PlayButton, ReleaseButton } from "../../layout/HeroActions";
import { colors, type, u } from "../../theme";

/** The hero of a film or a show: Play, Add to list, and the release Play uses
 * as a button that opens the releases (while searching or with none, a line
 * that says so). `focusedAt`: 0 Play, 1 the list, 2 the release. */
export function TitleHero(props: {
  data: () => Title;
  focusedAt: () => number | null;
  onPlay: () => void;
  onToggle: () => void;
  onReleases: () => void;
}) {
  const show = () => props.data().kind === "show";
  const line = () => releaseLine(props.data().release!, false);
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
        <PlayButton label={() => playLabel(props.data())} focused={() => props.focusedAt() === 0} onPress={props.onPlay} />
        <ListButton
          inList={() => props.data().inList}
          addKey="title.add_to_list"
          focused={() => props.focusedAt() === 1}
          onPress={props.onToggle}
        />
        <If
          when={props.data().release}
          else={<Text style={{ ...type.meta(), fontSize: u(22), color: colors.ash(), marginLeft: u(12) }}>{releasesText(props.data())}</Text>}
        >
          <ReleaseButton name={() => line().name} rest={() => line().rest} focused={() => props.focusedAt() === 2} onPress={props.onReleases} />
        </If>
      </View>
    </Hero>
  );
}
