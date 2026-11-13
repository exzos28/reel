import { Text, View, type TextStyle, type ViewRef, type ViewStyle } from "nsh";
import { t } from "nsh/i18n";
import { noteText, tracksText, type Release } from "../../catalog";
import { Badge } from "../../kit/Badge";
import { Icon } from "../../kit/Icon";
import { rowStyle } from "../../kit/Row";
import { row } from "../../kit/shape";
import { SignalBars } from "../../kit/SignalBars";
import { fontText, oneLine } from "../../kit/text";
import { colors, density, u } from "../../theme";
import checkIcon from "../../icons/check.svg";

/** Columns on a TV and a Mac; a phone keeps what decides the choice. */
const wide = density !== "compact";
const column = (width: number): ViewStyle => ({ width: wide ? u(width) : undefined });

const releaseRowStyle = (selected: boolean, focused: boolean): ViewStyle => ({
  ...rowStyle(selected, focused, wide ? u(24) : u(14)),
  minHeight: u(76),
  paddingHorizontal: u(28),
  paddingVertical: u(12),
});
const sourceStyle = (): TextStyle => ({ ...oneLine, flex: 1, minWidth: u(120), ...fontText(23, colors.snow(), 600) });
const groupStyle = (): TextStyle => ({ fontWeight: 400, fontSize: u(22), color: colors.ash() });
const cellText = (width: number): TextStyle => ({ width: u(width), ...fontText(23, colors.ash()) });
const noteStyle = (): ViewStyle => ({ ...column(240), ...row(u(10)), justifyContent: "flex-end" });

/** A release: quality, source and group, size, tracks, people sharing and
 * a plain note; the one Play uses is selected (lighter, with a check). */
export function ReleaseRow(props: { release: () => Release; focused: () => boolean; viewRef: (r: ViewRef) => void; onPress: () => void }) {
  const r = props.release;
  return (
    <View
      ref={props.viewRef}
      role="button"
      accessibilityLabel={`${r().quality} ${r().source}`}
      accessibilityState={{ selected: r().selected }}
      onPress={props.onPress}
      hoverStyle={{ backgroundColor: colors.raise() }}
      style={releaseRowStyle(r().selected, props.focused())}
    >
      <View style={{ ...column(110), alignItems: "flex-start" }}>
        <Badge text={r().quality} size={19} />
      </View>
      <Text style={sourceStyle()}>
        {r().source}
        <Text style={groupStyle()}>{r().group ? `   ${r().group}` : ""}</Text>
      </Text>
      <If when={wide}>
        <Text style={cellText(140)}>{r().size}</Text>
        <Text style={{ ...oneLine, ...cellText(380) }}>{tracksText(r())}</Text>
      </If>
      <View style={{ ...column(250), ...row(u(12)) }}>
        <SignalBars bars={r().bars} />
        <Text style={fontText(23, colors.ash())}>{t("release.sharing_short", { count: r().peers })}</Text>
      </View>
      <View style={noteStyle()}>
        <If when={r().selected}>
          <Icon src={() => checkIcon} size={22} />
        </If>
        <Text style={fontText(23, r().selected ? colors.snow() : colors.ash())}>{noteText(r())}</Text>
      </View>
    </View>
  );
}
