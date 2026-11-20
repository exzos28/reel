// A saved film or episode as a row (design/concept/mac-saved.html): its still, the title and
// what else it is (the episode), the state with a progress bar while it saves, then round
// buttons: Play once it is saved, Pause / Resume while it saves, and Remove. A saved row plays
// when pressed; one still saving opens its title.
import { Image, Text, View, type ViewRef, type ViewStyle } from "nsh";
import { t } from "nsh/i18n";
import { IconButton } from "../../kit/IconButton";
import { rowStyle } from "../../kit/Row";
import { cover, rounded, row } from "../../kit/shape";
import { labelText, metaText, oneLine } from "../../kit/text";
import { Fmt } from "../../native";
import type { SavedItem } from "../../library";
import { alpha, colors, cs, density, targetSlop, u } from "../../theme";
import { episodeCode } from "../../catalog";
import { SpeedLine } from "../../kit/SpeedLine";
import pauseIcon from "../../icons/pause.svg";
import playIcon from "../../icons/play.svg";
import trashIcon from "../../icons/trash.svg";
import { Pressable } from "../../kit/Pressable";

/** A phone: the state under the title (no column of its own), a smaller picture, the buttons as
 * wide as they are: a row the screen's width. */
export const compact = density === "compact";

const itemStyle = (focused: boolean, nested: boolean): ViewStyle => ({
  ...rowStyle(false, focused, u(24)),
  ...(compact ? { minHeight: cs(nested ? 92 : 108), paddingVertical: cs(12) } : { height: cs(nested ? 92 : 108) }),
  paddingLeft: cs(10),
  paddingRight: cs(22),
  marginLeft: nested ? cs(56) : 0,
});
const thumbStyle = (): ViewStyle => ({ width: cs(compact ? 96 : 128), height: cs(compact ? 54 : 72), ...rounded(u(8)), overflow: "hidden", backgroundColor: colors.raise() });
const imageStyle = () => ({ ...cover(), objectFit: "cover" }) as ViewStyle;
const progressTrack = (): ViewStyle => ({ height: cs(4), ...rounded(999), backgroundColor: colors.raise(), overflow: "hidden", marginTop: u(8), width: compact ? "100%" : cs(300) });
/** What is on the device: the player's "ready" tone, not the watched one. */
const progressFill = (p: number): ViewStyle => ({ height: "100%", width: `${Math.round(p * 100)}%`, backgroundColor: alpha(colors.snow(), 0.45) });

/** The state and the buttons line up down the page, a show's row and its episodes' alike: the
 * state is a column this wide, the buttons a block this wide, at the row's right edge. */
export const STATE_W = 340;
export const ACTIONS_W = 44 * 3 + 12 * 2;
export const stateColumn = (): ViewStyle => ({ width: cs(STATE_W) });
export const actionsBlock = (): ViewStyle => ({ ...row(u(12)), ...(compact ? {} : { width: cs(ACTIONS_W) }), justifyContent: "flex-end" });

/** "S3:E5 · The Palace of Terror", or nothing for a film. */
function episodeLine(i: SavedItem) {
  if (i.season == null || i.number == null) return "";
  return i.label ? `${episodeCode(i.season, i.number)} · ${i.label}` : episodeCode(i.season, i.number);
}

/** The state in words: "34% · 1.2 GB of 3.4 GB", "Paused", "Saved · 2.1 GB", why it failed. */
export function stateLine(i: SavedItem): string {
  const size = Fmt.size(i.size);
  if (i.checking && (i.state === "saving" || i.state === "paused")) return t("saved.state.checking");
  switch (i.state) {
    case "saving":
      return t("saved.state.saving", { percent: Math.floor(i.progress * 100), have: Fmt.size(i.have), size });
    case "paused":
      return t("saved.state.paused", { have: Fmt.size(i.have), size });
    case "saved":
      return t("saved.state.saved", { size });
    case "failed":
      return t(`saved.failed.${i.message && ["no_source", "not_in_release", "unsupported", "no_video", "interrupted", "no_peers", "no_space", "write", "path_too_long"].includes(i.message) ? i.message : "other"}`);
    default:
      return t(`saved.state.${i.state}`);
  }
}


export function SavedRow(props: {
  item: () => SavedItem;
  /** Under its show's row: the episode is its title, indented. */
  nested?: boolean;
  /** Which part has the focus: 0 the row, 1 play, pause or resume, 2 remove; null: none. */
  focusedPart: () => number | null;
  viewRef: (r: ViewRef) => void;
  onOpen: () => void;
  onPlay: () => void;
  onPause: () => void;
  onRemove: () => void;
}) {
  const i = props.item;
  const unfinished = () => ["saving", "paused", "waiting", "resolving"].includes(i().state);
  const state = () => (
    <>
      <Text style={metaText(i().state === "failed" ? colors.soft() : colors.ash())}>{stateLine(i())}</Text>
      <If when={unfinished() && !i().checking}>
        <View style={progressTrack()}>
          <View style={progressFill(i().progress)} />
        </View>
      </If>
      {/* An episode's torrent is its show's: its speed shows on the show's row. */}
      <If when={!props.nested && i().state === "saving" && i().speed != null}>
        <SpeedLine speed={() => i().speed!} peers={() => i().peers ?? 0} />
      </If>
    </>
  );
  return (
    <Pressable feedback="row"
      ref={props.viewRef}
      role="button"
      accessibilityLabel={i().title}
      hitSlop={targetSlop(cs(108))}
      onPress={() => (i().state === "saved" ? props.onPlay() : props.onOpen())}
      hoverStyle={{ backgroundColor: colors.raise() }}
      style={itemStyle(props.focusedPart() === 0, props.nested ?? false)}
    >
      <View style={{ ...thumbStyle(), opacity: i().state === "unavailable" ? 0.4 : 1 }}>
        <If when={i().image}>
          <Image src={i().image} style={imageStyle()} />
        </If>
      </View>
      <View style={{ flex: 1, gap: u(4) }}>
        <Text style={{ ...labelText(), ...oneLine }}>{props.nested ? episodeLine(i()) || i().title : i().title}</Text>
        <If when={!props.nested && episodeLine(i())}>
          <Text style={{ ...metaText(), ...oneLine }}>{episodeLine(i())}</Text>
        </If>
        <If when={compact}>{state()}</If>
      </View>
      <If when={!compact}>
        <View style={stateColumn()}>{state()}</View>
      </If>
      <View style={actionsBlock()}>
        <If when={i().state === "saved"}>
          <IconButton size={44} icon={() => playIcon} label={() => t("title.play")} focused={() => props.focusedPart() === 1} background={() => colors.raise()} onPress={props.onPlay} />
        </If>
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
        <IconButton
          size={44}
          icon={() => trashIcon}
          label={() => t("saved.remove")}
          focused={() => props.focusedPart() === 2}
          background={() => colors.raise()}
          onPress={props.onRemove}
        />
      </View>
    </Pressable>
  );
}
