import { View } from "nsh";
import { playLabel, type Title } from "../../catalog";
import { Hero } from "../../layout/Hero";
import { actionsRow, ListButton, PlayButton } from "../../layout/HeroActions";
import { ReleaseText } from "../../layout/HeroMeta";
import { u } from "../../theme";

/** The hero of a film or a show: Play and Add to list, the release Play
 * uses beside them. */
export function TitleHero(props: { data: () => Title; focusedAt: () => number | null; onPlay: () => void; onToggle: () => void }) {
  const show = () => props.data().kind === "show";
  return (
    <Hero
      item={props.data}
      height={show() ? 640 : 700}
      backdropLeft={show() ? 520 : 560}
      titleSize={show() ? 76 : 88}
      top={show() ? 150 : 176}
    >
      <View style={actionsRow(true)}>
        <PlayButton label={() => playLabel(props.data())} focused={() => props.focusedAt() === 0} onPress={props.onPlay} />
        <ListButton
          inList={() => props.data().inList}
          addKey="title.add_to_list"
          focused={() => props.focusedAt() === 1}
          onPress={props.onToggle}
        />
        <View style={{ marginLeft: u(12) }}>
          <ReleaseText item={props.data} withStart={false} />
        </View>
      </View>
    </Hero>
  );
}
