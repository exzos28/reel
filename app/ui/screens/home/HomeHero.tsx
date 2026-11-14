import { View } from "nsh";
import { playLabel, type Summary } from "../../catalog";
import { Hero } from "../../layout/Hero";
import { actionsRow, ListButton, PlayButton } from "../../layout/HeroActions";
import { ReleaseText } from "../../layout/HeroMeta";
import { density } from "../../theme";

/** The hero's height and its text's top, TV pixels. On a TV the first row (its cards
 * and their names) shows whole under it, inside the title-safe area. */
export const HOME_HERO = density === "ten-foot" ? { height: 640, top: 180 } : { height: 780, top: 236 };

/** The hero for the focused card: Play and My list under its release. */
export function HomeHero(props: { item: () => Summary; focusedAt: () => number | null; onPlay: () => void; onToggle: () => void }) {
  return (
    <Hero item={props.item} height={HOME_HERO.height} titleSize={96} top={HOME_HERO.top}>
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
