import { View } from "nsh";
import { playLabel, type Summary } from "../../catalog";
import { Hero } from "../../layout/Hero";
import { actionsRow, ListButton, PlayButton } from "../../layout/HeroActions";
import { ReleaseText } from "../../layout/HeroMeta";
import { heroFollowsWindow, heroTop } from "../../layout/metrics";
import { caps } from "../../platform";
import { IconButton } from "../../kit/IconButton";
import { t } from "nsh/i18n";
import { colors } from "../../theme";
import infoIcon from "../../icons/info.svg";
import heartIcon from "../../icons/heart.svg";
import heartFilledIcon from "../../icons/heart-filled.svg";
import { density } from "../../theme";

/** The hero's height and its text's top, TV pixels. On a TV the first row (its cards
 * and their names) shows whole under it, inside the title-safe area. */
export const HOME_HERO = density === "ten-foot" ? { height: 640, top: 180 } : { height: 780, top: 236 };


/** The hero for the focused card: Play, the Watchlist and its page (a round ⓘ) under its release. */
export function HomeHero(props: {
  item: () => Summary;
  focusedAt: () => number | null;
  onPlay: () => void;
  onToggle: () => void;
  /** The title pressed: its page. */
  onOpen: () => void;
}) {
  return (
    // Steady where the focus moves the hero from card to card (keys); on touch it stays on one
    // title, its text right under the head, as tall as its text (the still fades under what follows).
    <Hero item={props.item} height={HOME_HERO.height} titleSize={88} top={heroTop("root", caps.touch ? 0 : HOME_HERO.top)} steadyAbout={!caps.touch} wholeTitle={heroFollowsWindow} fit={caps.touch} room={56} onOpen={props.onOpen}>
      <ReleaseText item={props.item} />
      <View style={actionsRow(false)}>
        <PlayButton label={() => playLabel(props.item())} focused={() => props.focusedAt() === 0} onPress={props.onPlay} />
        {/* A phone's row has room for Play and two discs only: the Watchlist is a heart there (with a
            label for a screen reader), else the row ran past the screen and the page drifted sideways. */}
        <If
          when={density === "compact"}
          else={<ListButton inList={() => props.item().inList} addKey="title.my_list" focused={() => props.focusedAt() === 1} onPress={props.onToggle} />}
        >
          <IconButton
            icon={() => (props.item().inList ? heartFilledIcon : heartIcon)}
            iconColor={() => (props.item().inList ? colors.red() : colors.snow())}
            label={() => (props.item().inList ? t("title.in_list") : t("title.my_list"))}
            focused={() => props.focusedAt() === 1}
            background={() => colors.raise()}
            onPress={props.onToggle}
          />
        </If>
        {/* The title's page: everything about it, its episodes, its releases. */}
        <IconButton icon={() => infoIcon} label={() => t("home.details")} focused={() => props.focusedAt() === 2} background={() => colors.raise()} onPress={props.onOpen} />
      </View>
    </Hero>
  );
}
