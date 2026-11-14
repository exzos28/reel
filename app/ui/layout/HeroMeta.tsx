// The lines under a hero's logotype: the scores with their sources, year,
// length, the age rating and badges; the release Play uses.
import { Text, View, type TextStyle } from "nsh";
import { badgeText, lengthText, releaseLine, scoreSource, votesText, yearsText, type Score, type Summary } from "../catalog";
import { Badge } from "../kit/Badge";
import { row } from "../kit/shape";
import { colors, type, u } from "../theme";

const metaLabel = (color: string, fontWeight?: number): TextStyle => ({
  ...type.label(),
  fontSize: u(26),
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
      <Text style={metaLabel(colors.ash(), 400)}>{scoreSource(sc())}</Text>
      <Text style={metaLabel(colors.snow(), 500)}>{sc().value}</Text>
      <If when={sc().votes}>
        <Text style={metaLabel(colors.ash(), 400)}>{votesText(sc())}</Text>
      </If>
    </View>
  );
}

/** Scores, year, length, the age rating and badges in one line. */
export function MetaLine(props: { item: () => Summary }) {
  const s = props.item;
  return (
    <View style={{ ...row(u(20)), flexWrap: "wrap" }}>
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

/** The release Play uses: its name bold, then size, people sharing, start. */
export function ReleaseText(props: { item: () => Summary; withStart?: boolean; size?: number }) {
  const line = () => releaseLine(props.item().release!, props.withStart ?? true);
  return (
    <If when={props.item().release}>
      <Text style={{ ...type.meta(), fontSize: u(props.size ?? 22), color: colors.ash() }}>
        <Text style={{ fontWeight: 500, color: colors.snow() }}>{line().name}</Text>
        {` · ${line().rest}`}
      </Text>
    </If>
  );
}
