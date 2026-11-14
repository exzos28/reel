import { Text, View, type TextStyle, type ViewRef, type ViewStyle } from "nsh";
import { t } from "nsh/i18n";
import { dateText, runtime, type Episode } from "../../catalog";
import { Icon } from "../../kit/Icon";
import { rowStyle } from "../../kit/Row";
import { row } from "../../kit/shape";
import { fontText, oneLine } from "../../kit/text";
import { colors, u } from "../../theme";
import { EpisodeThumb } from "./EpisodeThumb";
import checkIcon from "../../icons/check.svg";

const episodeRowStyle = (focused: boolean): ViewStyle => ({
  ...rowStyle(false, focused, u(26)),
  minHeight: u(118),
  paddingLeft: u(18),
  paddingRight: u(26),
  paddingVertical: u(7),
});
const numberStyle = (watched: boolean): TextStyle => ({
  width: u(74),
  textAlign: "center",
  ...fontText(44, watched ? colors.ash() : colors.faint(), 300),
});
const titleStyle = (watched: boolean): TextStyle => ({ ...oneLine, ...fontText(26, watched ? colors.ash() : colors.snow(), 600) });
const aboutStyle = (): TextStyle => ({ ...oneLine, ...fontText(22, colors.quiet()), marginTop: u(2) });

/** "19 min · Apr 24, 1940 · 7 min left". */
function metaOf(e: Episode) {
  const parts = [runtime(e.minutes), dateText(e.date)];
  if (e.left != null) parts.push(t("card.left", { time: runtime(e.left) }));
  return parts.join(" · ");
}

/** Only what differs from the season's release (shown on the button above):
 * "Watched", that the release lacks it, or the quality of a release picked for it. */
const statusOf = (e: Episode) => {
  if (e.watched) return t("series.watched");
  if (e.inRelease === "no") return t("series.not_in_release");
  return e.inRelease === "own" && e.quality ? e.quality : "";
};

/** An episode: big grey number, still, title, meta and one line of about;
 * on the right only what differs from the season's release. */
export function EpisodeRow(props: { episode: () => Episode; focused: () => boolean; viewRef: (r: ViewRef) => void; onPress: () => void }) {
  const e = props.episode;
  return (
    <View
      ref={props.viewRef}
      role="button"
      accessibilityLabel={e().title}
      onPress={props.onPress}
      hoverStyle={{ backgroundColor: colors.raise() }}
      style={episodeRowStyle(props.focused())}
    >
      <Text style={numberStyle(e().watched)}>{String(e().number)}</Text>
      <EpisodeThumb episode={e} />
      <View style={{ flex: 1, gap: u(4) }}>
        <Text style={titleStyle(e().watched)}>{e().title}</Text>
        <Text style={fontText(21, colors.ash())}>{metaOf(e())}</Text>
        <Text style={aboutStyle()}>{e().about}</Text>
      </View>
      <View style={row(u(8))}>
        <If when={e().watched}>
          <Icon src={() => checkIcon} size={20} color={colors.ash} />
        </If>
        <Text style={fontText(21, colors.ash())}>{statusOf(e())}</Text>
      </View>
    </View>
  );
}
