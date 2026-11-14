// The lines under a hero's logotype: rating, year and badges; the release
// Play uses.
import { Text, View, type TextStyle } from "nsh";
import { badgeText, lengthText, releaseLine, yearsText, type Summary } from "../catalog";
import { Badge } from "../kit/Badge";
import { Rating } from "../kit/Rating";
import { row } from "../kit/shape";
import { colors, type, u } from "../theme";

const metaLabel = (color: string, fontWeight?: number): TextStyle => ({
  ...type.label(),
  fontSize: u(26),
  ...(fontWeight == null ? {} : { fontWeight }),
  color,
});

/** Rating, votes, year, length and badges in one line. */
export function MetaLine(props: { item: () => Summary }) {
  const s = props.item;
  return (
    <View style={{ ...row(u(16)), flexWrap: "wrap" }}>
      <Rating rating={s().rating} size={26} />
      <Text style={{ ...metaLabel(colors.ash(), 400), marginLeft: -u(6) }}>{s().votes}</Text>
      <Text style={metaLabel(colors.snow())}>{yearsText(s())}</Text>
      <Text style={metaLabel(colors.snow())}>{lengthText(s())}</Text>
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
