import { computed, Text, View, type TextStyle, type ViewRef, type ViewStyle } from "nsh";
import { t } from "nsh/i18n";
import { episodeNote, runtime, shortDate, type Episode } from "../../catalog";
import { Icon } from "../../kit/Icon";
import { rowStyle } from "../../kit/Row";
import { row } from "../../kit/shape";
import { fontText, oneLine } from "../../kit/text";
import { colors, cs, u } from "../../theme";
import { EpisodeThumb } from "./EpisodeThumb";
import { itemState } from "../../library";
import { SaveMark } from "../../kit/SaveMark";
import checkIcon from "../../icons/check.svg";
import { Pressable } from "../../kit/Pressable";

const episodeRowStyle = (focused: boolean): ViewStyle => ({
  ...rowStyle(false, focused, u(26)),
  minHeight: cs(118),
  paddingLeft: u(18),
  paddingRight: u(26),
  paddingVertical: u(7),
});
const numberStyle = (watched: boolean): TextStyle => ({
  width: cs(74),
  textAlign: "center",
  ...fontText(44, watched ? colors.ash() : colors.faint(), 300),
});
const titleStyle = (watched: boolean): TextStyle => ({ ...oneLine, ...fontText(26, watched ? colors.ash() : colors.snow(), 600) });
const aboutStyle = (lines: number): TextStyle => ({ numberOfLines: lines, ...fontText(22, colors.quiet()), marginTop: u(2) } as TextStyle);
/** In a column: the number before the title, in the big number's grey. */
const inlineNumber = (watched: boolean): TextStyle => ({ fontWeight: 400, color: watched ? colors.ash() : colors.faint() });

/** "19 min · Apr 24, 1940", or once started "19 min · 7 min left". */
const metaOf = (e: Episode) => [runtime(e.minutes), episodeNote(e)].filter((x) => x).join(" · ");

/** Only what differs from the season's release (shown on the button above):
 * "Watched", that the release lacks it, or the quality of a release picked for it. */
const statusOf = (e: Episode) => {
  if (e.upcoming) return t("series.airs", { date: shortDate(e.date) });
  if (e.watched) return t("series.watched");
  if (e.inRelease === "no") return t("series.not_in_release");
  return e.inRelease === "own" && e.quality ? e.quality : "";
};

/** An episode: big grey number, still, title, meta and one line of about;
 * on the right only what differs from the season's release. `column`: one of two columns (a
 * tablet held wide): a larger still, the number before the title, two lines of about. */
export function EpisodeRow(props: { episode: () => Episode; focused: () => boolean; viewRef: (r: ViewRef) => void; onPress: () => void; column?: boolean }) {
  const column = props.column ?? false;
  const e = props.episode;
  /** Saved or being saved on this device: its round mark at the right. */
  const saved = computed(() => itemState(e().id));
  const marked = () => !["none", "failed"].includes(saved().state);
  return (
    <Pressable feedback="row"
      ref={props.viewRef}
      role="button"
      accessibilityLabel={e().title}
      onPress={props.onPress}
      hoverStyle={{ backgroundColor: colors.raise() }}
      style={{ ...episodeRowStyle(props.focused()), ...(column ? { flex: 1, minWidth: 0 } : null) }}
    >
      <If when={!column}>
        <Text style={numberStyle(e().watched)}>{String(e().number)}</Text>
      </If>
      <EpisodeThumb episode={e} large={column} />
      <View style={{ flex: 1, minWidth: 0, gap: u(4) }}>
        <Text style={titleStyle(e().watched)}>
          <Text style={inlineNumber(e().watched)}>{column ? `${e().number}  ` : ""}</Text>
          {e().title}
        </Text>
        <Text style={fontText(21, colors.ash())}>{metaOf(e())}</Text>
        <Text style={aboutStyle(column ? 2 : 1)}>{e().about}</Text>
      </View>
      <View style={row(u(8))}>
        <If when={e().watched}>
          <Icon src={() => checkIcon} size={20} color={colors.ash} />
        </If>
        <Text style={fontText(21, colors.ash())}>{statusOf(e())}</Text>
        <If when={marked()}>
          <SaveMark state={() => saved().state} progress={() => saved().progress} background={() => (props.focused() ? colors.raise() : colors.card())} />
        </If>
      </View>
    </Pressable>
  );
}
