// The lines under a hero's logotype: the scores with their sources, year,
// length, the age rating and badges; the release Play uses.
import { Text, View, type TextStyle } from "nsh";
import { source } from "../preferences";
import { badgeText, lengthText, releaseLine, scoreSource, votesText, yearsText, type Score, type Summary } from "../catalog";
import { Badge } from "../kit/Badge";
import { Icon } from "../kit/Icon";
import { oneLine } from "../kit/text";
import { row } from "../kit/shape";
import { caps } from "../platform";
import { colors, iconPt, ts, type, u } from "../theme";
import personIcon from "../icons/person.svg";

/** The hero's grey words (score sources, votes, genres, the release's details): over a still
 * they need more than the page's `ash`, at least 70 % of snow. */
export const heroMeta = () => colors.quiet();

/** 24, a step under the about's 26: the two do not compete. */
const metaLabel = (color: string, fontWeight?: number): TextStyle => ({
  ...type.label(),
  fontSize: ts(24),
  ...(fontWeight == null ? {} : { fontWeight }),
  color,
});

/** "★ TMDB 8.0 4.8K votes": the red star before the first score only. */
function ScoreText(props: { score: () => Score; first: () => boolean }) {
  const sc = props.score;
  return (
    <View style={row(u(8))}>
      <If when={props.first()}>
        <Text style={metaLabel(colors.red())}>★</Text>
      </If>
      <Text style={metaLabel(heroMeta(), 400)}>{scoreSource(sc())}</Text>
      <Text style={metaLabel(colors.snow(), 500)}>{sc().value}</Text>
      <If when={sc().votes}>
        <Text style={metaLabel(heroMeta(), 400)}>{votesText(sc())}</Text>
      </If>
    </View>
  );
}

/** Scores, year, length, the age rating and badges in one line. */
export function MetaLine(props: { item: () => Summary }) {
  const s = props.item;
  return (
    // Groups apart (32) well past the words inside one (8): "1K votes" and "AniList" do not read as one.
    <View style={{ ...row(u(32)), flexWrap: "wrap" }}>
      <Each of={s().ratings} key="index">
        {(sc, i) => <ScoreText score={sc} first={() => i() === 0} />}
      </Each>
      <Text style={metaLabel(colors.snow())}>{yearsText(s())}</Text>
      <Text style={metaLabel(colors.snow())}>{lengthText(s())}</Text>
      <If when={s().certification}>
        <Badge text={s().certification!} />
      </If>
      <Each of={s().badges} key="index">
        {(b) => <Badge text={badgeText(b())} />}
      </Each>
    </View>
  );
}

/** A release line in short: "1080p WEB · 23 GB · 650 👤" (the people sharing as a number and a
 * person icon), one line, its words cut with an ellipsis before the number does; a screen reader
 * says it whole (`line().spoken`). `name`: the name's colour and weight (bold over a still). */
export function ShortRelease(props: { line: () => ReturnType<typeof releaseLine>; style: () => TextStyle; name?: TextStyle }) {
  const lead = () => [props.line().size, props.line().fast].filter(Boolean).join(" · ");
  const size = () => (props.style().fontSize as number) ?? ts(22);
  return (
    <View accessibilityLabel={props.line().spoken} style={{ ...row(u(6)), flexShrink: 1, minWidth: 0 }}>
      <Text style={{ ...props.style(), ...oneLine, flexShrink: 1 }}>
        <Text style={props.name ?? {}}>{props.line().name}</Text>
        {` · ${lead()} · ${props.line().peers}`}
      </Text>
      <Icon src={() => personIcon} size={iconPt(size() * 0.9)} color={() => props.style().color as string} />
    </View>
  );
}

/** The release Play uses: its name bold, then size, people sharing, start (on touch in short,
 * `ShortRelease`, so it keeps to one line). */
export function ReleaseText(props: { item: () => Summary; withStart?: boolean; size?: number }) {
  const line = () => releaseLine(props.item().release!, props.withStart ?? true);
  const style = () => ({ ...type.meta(), fontSize: ts(props.size ?? 22), color: heroMeta() });
  const name: TextStyle = { fontWeight: 500, color: colors.snow() };
  return (
    // With a source its line is kept while the release is still searched, so the buttons under it
    // do not move when it comes in: an empty line a screen reader does not stop at.
    <If
      when={props.item().release}
      else={
        <If when={source().url !== ""}>
          <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <Text style={style()}>{" "}</Text>
          </View>
        </If>
      }
    >
      <If
        when={caps.touch}
        else={
          <Text style={style()}>
            <Text style={name}>{line().name}</Text>
            {` · ${line().rest}`}
          </Text>
        }
      >
        <View style={{ flexDirection: "row" }}>
          <ShortRelease line={line} style={style} name={name} />
        </View>
      </If>
    </If>
  );
}
