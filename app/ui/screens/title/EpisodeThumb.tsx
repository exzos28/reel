import { Image, View, type ViewStyle } from "nsh";
import type { Episode } from "../../catalog";
import { WatchedBar } from "../../kit/Picture";
import { RatingChip } from "../../kit/Rating";
import { cover, rounded } from "../../kit/shape";
import { colors, u } from "../../theme";

const thumbStyle = (): ViewStyle => ({ width: u(185), height: u(104), ...rounded(u(8)), overflow: "hidden", backgroundColor: colors.raise() });
const imageStyle = () => ({ ...cover(), objectFit: "cover", objectPosition: "center 30%" }) as ViewStyle;

/** An episode's 16:9 still with its rating and a watched bar. */
export function EpisodeThumb(props: { episode: () => Episode }) {
  const e = props.episode;
  return (
    <View style={thumbStyle()}>
      <If when={e().thumb}>
        <Image src={e().thumb!} style={imageStyle()} />
      </If>
      <RatingChip rating={() => e().rating} />
      <If when={e().progress > 0}>
        <WatchedBar progress={() => e().progress} />
      </If>
    </View>
  );
}
