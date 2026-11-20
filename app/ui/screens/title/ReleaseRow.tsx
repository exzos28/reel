import { Text, View, type TextStyle, type ViewRef, type ViewStyle } from "nsh";
import { releaseDetails, releaseSpoken, type Release } from "../../catalog";
import { Badge } from "../../kit/Badge";
import { Icon } from "../../kit/Icon";
import { rowStyle } from "../../kit/Row";
import { row } from "../../kit/shape";
import { fontText, oneLine } from "../../kit/text";
import { colors, cs, density, ts, u } from "../../theme";
import { t } from "nsh/i18n";
import checkIcon from "../../icons/check.svg";
import personIcon from "../../icons/person.svg";
import { Pressable } from "../../kit/Pressable";

/** Columns on a TV and a Mac; a phone keeps what decides the choice. */
const wide = density !== "compact";
const column = (width: number): ViewStyle => ({ width: wide ? u(width) : undefined });

const releaseRowStyle = (selected: boolean, focused: boolean): ViewStyle => ({
  ...rowStyle(selected, focused, wide ? u(24) : u(14)),
  minHeight: cs(76),
  paddingHorizontal: cs(28),
  paddingVertical: u(12),
});
const sourceStyle = (): TextStyle => ({ ...oneLine, ...fontText(23, colors.snow(), 600) });
const nameStyle = (lines: number): TextStyle => ({ numberOfLines: lines, ...fontText(19, colors.dim()) } as TextStyle);
const detailsStyle = (): TextStyle => ({ ...oneLine, ...fontText(22, colors.ash()) });
const checkStyle = (): ViewStyle => ({ width: cs(28), ...row(0), justifyContent: "flex-end" });

/** The people sharing: the number and a person icon, as on Play's release line. */
function Sharing(props: { peers: () => number; size: number }) {
  return (
    <View style={row(u(6))}>
      <Text style={fontText(props.size, colors.ash())}>{`${props.peers()}`}</Text>
      <Icon src={() => personIcon} size={props.size * 0.9} color={() => colors.ash()} />
    </View>
  );
}

/** A release: quality; where it comes from, its audio, picture and size, and its own name (one
 * line each, so the rows keep one height on a TV); the people sharing; the one Play uses is
 * selected (lighter, with a check). */
export function ReleaseRow(props: {
  release: () => Release;
  focused: () => boolean;
  viewRef: (r: ViewRef) => void;
  onPress: () => void;
  /** Narrower (the side panel): the details under the name. */
  narrow?: boolean;
}) {
  const r = props.release;
  if (props.narrow && density !== "ten-foot") return <NarrowRow {...props} />;
  return (
    <Pressable feedback="row"
      ref={props.viewRef}
      role="button"
      accessibilityLabel={releaseSpoken(r())}
      accessibilityState={{ selected: r().selected }}
      onPress={props.onPress}
      hoverStyle={{ backgroundColor: colors.raise() }}
      style={releaseRowStyle(r().selected, props.focused())}
    >
      <View style={{ ...column(110), alignItems: "flex-start" }}>
        <Badge text={r().quality} size={19} />
      </View>
      <View style={{ flex: 1, minWidth: u(120), gap: u(4) }}>
        <Text style={sourceStyle()}>{r().origin}</Text>
        <Text style={detailsStyle()}>{releaseDetails(r())}</Text>
        <Text style={nameStyle(1)}>{r().group}</Text>
      </View>
      <View style={{ ...column(120), alignItems: "flex-end" }}>
        <Sharing peers={() => r().peers} size={23} />
      </View>
      <View style={checkStyle()}>
        <If when={r().selected}>
          <Icon src={() => checkIcon} size={22} />
        </If>
      </View>
    </Pressable>
  );
}

const narrowStyle = (selected: boolean, focused: boolean): ViewStyle => ({
  ...rowStyle(selected, focused, u(8)),
  flexDirection: "column",
  alignItems: "stretch",
  paddingHorizontal: cs(22),
  paddingVertical: u(14),
});

/** How it starts, in plain words ("Starts fast", "Needs 21 Mbit/s internet"): the core's note. */
export const noteText = (r: Release) => (r.note ? t(`release.note.${r.note}`, { mbit: r.mbit }) : "");
const noteStyle = (): TextStyle => ({ ...fontText(20, colors.ash()) });

/** A release in a narrow panel (desktop, touch): quality and where it comes from (a check when
 * it is the one Play uses); its audio, picture, size and people sharing ("English, Russian MVO ·
 * H.264 · 700 MB · 3 👤", the icon kept with the number when the line wraps); how it starts ("Starts
 * fast"); the release's own name, small, up to two lines. */
function NarrowRow(props: { release: () => Release; focused: () => boolean; viewRef: (r: ViewRef) => void; onPress: () => void }) {
  const r = props.release;
  const details = () => releaseDetails(r());
  return (
    <Pressable feedback="row"
      ref={props.viewRef}
      role="button"
      accessibilityLabel={releaseSpoken(r())}
      accessibilityState={{ selected: r().selected }}
      onPress={props.onPress}
      hoverStyle={{ backgroundColor: colors.raise() }}
      style={narrowStyle(r().selected, props.focused())}
    >
      <View style={row(u(14))}>
        <Badge text={r().quality} size={19} />
        <Text style={{ ...oneLine, flex: 1, ...fontText(24, colors.snow(), 600) }}>{r().origin}</Text>
        <If when={r().selected}>
          <Icon src={() => checkIcon} size={22} />
        </If>
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: u(6), minWidth: 0 }}>
        <If when={details()}>
          <Text style={{ ...fontText(22, colors.ash()), flexShrink: 1 }}>{`${details()} ·`}</Text>
        </If>
        <View style={{ ...row(u(6)), flexShrink: 0 }}>
          <Text style={fontText(22, colors.ash())}>{`${r().peers}`}</Text>
          <Icon src={() => personIcon} size={20} color={() => colors.ash()} />
        </View>
      </View>
      <If when={noteText(r())}>
        <Text style={noteStyle()}>{noteText(r())}</Text>
      </If>
      <If when={r().group}>
        <Text style={nameStyle(2)}>{r().group}</Text>
      </If>
    </Pressable>
  );
}
