// A saved film or episode as a row (design/concept/mac-saved.html): its still, the title and
// what else it is (the episode), the state with a progress bar while it saves, then round
// Pause / Resume and Remove buttons. The row itself opens its title.
import { Image, Text, View, type ViewRef, type ViewStyle } from "nsh";
import { t } from "nsh/i18n";
import { IconButton } from "../../kit/IconButton";
import { rowStyle } from "../../kit/Row";
import { cover, rounded, row } from "../../kit/shape";
import { labelText, metaText, oneLine } from "../../kit/text";
import { Fmt } from "../../native";
import type { SavedItem } from "../../library";
import { alpha, colors, cs, targetSlop, u } from "../../theme";
import { episodeCode } from "../../catalog";
import pauseIcon from "../../icons/pause.svg";
import playIcon from "../../icons/play.svg";
import closeIcon from "../../icons/plus.svg";

const itemStyle = (focused: boolean): ViewStyle => ({ ...rowStyle(false, focused, u(24)), height: cs(108), paddingLeft: cs(10), paddingRight: cs(22) });
const thumbStyle = (): ViewStyle => ({ width: cs(160), height: cs(90), ...rounded(u(8)), overflow: "hidden", backgroundColor: colors.raise() });
const imageStyle = () => ({ ...cover(), objectFit: "cover" }) as ViewStyle;
const progressTrack = (): ViewStyle => ({ height: cs(4), ...rounded(999), backgroundColor: colors.raise(), overflow: "hidden", marginTop: u(8), width: cs(300) });
/** What is on the device: the player's "ready" tone, not the watched one. */
const progressFill = (p: number): ViewStyle => ({ height: "100%", width: `${Math.round(p * 100)}%`, backgroundColor: alpha(colors.snow(), 0.45) });
/** Remove: the plus turned a quarter. */
const turned: ViewStyle = { transform: [{ rotate: "45deg" }] };

/** "S3:E5 · The Palace of Terror", or nothing for a film. */
function episodeLine(i: SavedItem) {
  if (i.season == null || i.number == null) return "";
  return i.label ? `${episodeCode(i.season, i.number)} · ${i.label}` : episodeCode(i.season, i.number);
}

/** The state in words: "34% · 1.2 GB of 3.4 GB", "Paused", "Saved · 2.1 GB", why it failed. */
export function stateLine(i: SavedItem): string {
  const size = Fmt.size(i.size);
  switch (i.state) {
    case "saving":
      return t("saved.state.saving", { percent: Math.floor(i.progress * 100), have: Fmt.size(i.have), size });
    case "paused":
      return t("saved.state.paused", { have: Fmt.size(i.have), size });
    case "saved":
      return t("saved.state.saved", { size });
    case "failed":
      return t(`saved.failed.${i.message && ["no_source", "not_in_release", "unsupported", "no_video", "interrupted"].includes(i.message) ? i.message : "other"}`);
    default:
      return t(`saved.state.${i.state}`);
  }
}

/** Under the state while it saves: "3.1 MB/s from 58 people". */
const speedLine = (i: SavedItem) => (i.state === "saving" && i.speed != null ? t("saved.speed", { speed: Fmt.speed(i.speed), peers: i.peers ?? 0 }) : "");

export function SavedRow(props: {
  item: () => SavedItem;
  /** Which part has the focus: 0 the row, 1 pause or resume, 2 remove; null: none. */
  focusedPart: () => number | null;
  viewRef: (r: ViewRef) => void;
  onOpen: () => void;
  onPause: () => void;
  onRemove: () => void;
}) {
  const i = props.item;
  const unfinished = () => ["saving", "paused", "waiting", "resolving"].includes(i().state);
  return (
    <View
      ref={props.viewRef}
      role="button"
      accessibilityLabel={i().title}
      hitSlop={targetSlop(cs(108))}
      onPress={props.onOpen}
      hoverStyle={{ backgroundColor: colors.raise() }}
      style={itemStyle(props.focusedPart() === 0)}
    >
      <View style={{ ...thumbStyle(), opacity: i().state === "unavailable" ? 0.4 : 1 }}>
        <If when={i().image}>
          <Image src={i().image} style={imageStyle()} />
        </If>
      </View>
      <View style={{ flex: 1, gap: u(4) }}>
        <Text style={{ ...labelText(), ...oneLine }}>{i().title}</Text>
        <If when={episodeLine(i())}>
          <Text style={{ ...metaText(), ...oneLine }}>{episodeLine(i())}</Text>
        </If>
      </View>
      <View style={{ width: cs(340) }}>
        <Text style={metaText(i().state === "failed" ? colors.soft() : colors.ash())}>{stateLine(i())}</Text>
        <If when={unfinished()}>
          <View style={progressTrack()}>
            <View style={progressFill(i().progress)} />
          </View>
        </If>
        <If when={speedLine(i())}>
          <Text style={{ ...metaText(), marginTop: u(6) }}>{speedLine(i())}</Text>
        </If>
      </View>
      <View style={row(u(12))}>
        <If when={i().state === "saving" || i().state === "paused"}>
          <IconButton
            size={44}
            icon={() => (i().state === "paused" ? playIcon : pauseIcon)}
            label={() => t(i().state === "paused" ? "saved.resume" : "saved.pause")}
            focused={() => props.focusedPart() === 1}
            background={() => colors.raise()}
            onPress={props.onPause}
          />
        </If>
        <View style={turned}>
          <IconButton
            size={44}
            icon={() => closeIcon}
            label={() => t("saved.remove")}
            focused={() => props.focusedPart() === 2}
            background={() => colors.raise()}
            onPress={props.onRemove}
          />
        </View>
      </View>
    </View>
  );
}
