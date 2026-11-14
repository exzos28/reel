import { View } from "nsh";
import { playLabel, type Summary } from "../../catalog";
import { Hero } from "../../layout/Hero";
import { actionsRow, ListButton, PlayButton } from "../../layout/HeroActions";
import { ReleaseText } from "../../layout/HeroMeta";

/** The hero for the focused card: Play and My list under its release. */
export function HomeHero(props: { item: () => Summary; focusedAt: () => number | null; onPlay: () => void; onToggle: () => void }) {
  return (
    <Hero item={props.item} height={780} titleSize={96} top={236}>
      <ReleaseText item={props.item} />
      <View style={actionsRow(false)}>
        <PlayButton label={() => playLabel(props.item())} focused={() => props.focusedAt() === 0} onPress={props.onPlay} />
        <ListButton
          inList={() => props.item().inList}
          addKey="title.my_list"
          focused={() => props.focusedAt() === 1}
          onPress={props.onToggle}
        />
      </View>
    </Hero>
  );
}
