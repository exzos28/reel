// The player's tracks as rows: Audio, Subtitles and Release, each a list of options (the core's
// menu, `tracks.ts`, and the film's short list of releases). A TV, a computer and a tablet show
// the three side by side (Player.tsx's `TracksPanel`); a phone shows them in a sheet
// (`TracksSheet`): a switch Audio · Subtitles · Release on top and that one list under it, from the
// bottom, or at the right held sideways. The keys move as in the panel: left/right change the
// list, up/down the row, OK picks.
import { Text, View, type TextStyle, type ViewStyle } from "nsh";
import { t } from "nsh/i18n";
import type { Release } from "./catalog";
import { Icon } from "./kit/Icon";
import { Pressable } from "./kit/Pressable";
import { rounded, row } from "./kit/shape";
import { labelText, metaText } from "./kit/text";
import { Drawer } from "./layout/Drawer";
import { alpha, colors, showFocus } from "./theme";
import type { TrackOption } from "./tracks";
import checkIcon from "./icons/check.svg";

/** One row: `id` names it for tests (`audio-<key>`, `subtitles-<key>`: the core's keys,
 * `release-<index>`); `main` the name, `sub` the line under it. */
export interface TrackRow {
  id: string;
  main: string;
  sub?: string;
  selected: boolean;
}

/** The three lists' headings, in their order (the panel's columns, the sheet's switch). */
export const trackHeadings = () => [t("player.audio"), t("player.subtitles"), t("player.release")];

/** The rows of list `col` (0 Audio, 1 Subtitles, 2 Release). */
export function trackRows(col: number, audio: TrackOption[], subtitles: TrackOption[], releases: Release[]): TrackRow[] {
  if (col === 0) return audio.map((a, i) => ({ id: `audio-${a.key}`, main: trackName(a, i + 1), sub: trackNote(a), selected: a.selected }));
  if (col === 1) return subtitles.map((s, i) => ({ id: `subtitles-${s.key}`, main: trackName(s, i), sub: trackNote(s), selected: s.selected }));
  return releases.map((r, i) => ({
    id: `release-${i}`,
    main: `${r.quality} ${r.source}`,
    sub: `${r.size} · ${t("release.sharing_short", { count: r.peers })}`,
    selected: r.selected,
  }));
}

/** A track's name: its language, else its title, else its number. */
export function trackName(o: TrackOption, number: number) {
  if (o.kind === "original") return t("tracks.audio.original");
  if (o.kind === "off") return t("tracks.subtitles.off");
  // The core gives ISO 639-1 codes for the languages it knows (`languages.*`).
  if (o.language && o.language.length === 2) return t(`languages.${o.language}`);
  if (o.language) return o.language.toUpperCase();
  return o.title || t("tracks.number", { number });
}

/** The line under a track's name: its title, forced, where it comes from or its format. */
export function trackNote(o: TrackOption) {
  if (o.kind === "original" || o.kind === "off") return undefined;
  const parts = [
    o.language ? o.title : null,
    o.forced ? t("tracks.forced") : null,
    // The core words the technical part ("AC3 5.1", "SRT").
    o.kind === "external" ? t("tracks.from_torrent") : o.detail,
  ].filter((p): p is string => !!p);
  return parts.length ? parts.join(" · ") : undefined;
}

// The phone's sheet, points.
const switchStyle = (): ViewStyle => ({ ...row(0), ...rounded(10), padding: 3, backgroundColor: colors.raise() });
const segmentStyle = (on: boolean): ViewStyle => ({
  flex: 1, height: 32, alignItems: "center", justifyContent: "center", paddingHorizontal: 6,
  ...rounded(8), backgroundColor: on ? colors.control() : "transparent",
});
const segmentText = (on: boolean): TextStyle => ({ ...labelText(on ? colors.snow() : colors.ash()), numberOfLines: 1 });
const rowBox = (selected: boolean, lit: boolean): ViewStyle => ({
  ...row(12), ...rounded(12), minHeight: 52, paddingVertical: 8, paddingHorizontal: 14,
  // Focus is a fill here, as in the panel: the rows sit close together.
  backgroundColor: lit ? colors.snow() : selected ? colors.raise() : "transparent",
});
/** A name wraps to two lines at most, then an ellipsis: a word is never broken inside. */
const nameText = (selected: boolean, lit: boolean): TextStyle => ({
  ...labelText(lit ? colors.ink() : selected ? colors.snow() : colors.soft()), numberOfLines: 2, textOverflow: "ellipsis",
});
const noteText = (lit: boolean): TextStyle => ({
  ...metaText(lit ? alpha(colors.ink(), 0.7) : colors.ash()), numberOfLines: 2, textOverflow: "ellipsis", marginTop: 2,
});

/** Audio · Subtitles · Release: which list the sheet shows. */
function Switch(props: { col: () => number; onCol: (col: number) => void }) {
  return (
    <View style={switchStyle()}>
      <Each of={trackHeadings()} key="index">
        {(heading, i) => (
          <Pressable haptic={props.col() !== i()} testID={`tracks-tab-${i()}`} role="tab" accessibilityLabel={heading()}
            accessibilityState={{ selected: props.col() === i() }} onPress={() => props.onCol(i())} style={segmentStyle(props.col() === i())}>
            <Text style={segmentText(props.col() === i())}>{heading()}</Text>
          </Pressable>
        )}
      </Each>
    </View>
  );
}

/** A phone's tracks: one list at a time under the switch, in a sheet with its own ✕. */
export function TracksSheet(props: {
  /** The list shown (0 Audio, 1 Subtitles, 2 Release). */
  col: () => number;
  onCol: (col: number) => void;
  rows: () => TrackRow[];
  /** Whether row `i` of the shown list has the keys. */
  focused: (i: number) => boolean;
  isSelected: (i: number, fromCore: boolean) => boolean;
  onPick: (i: number) => void;
  onClose: () => void;
}) {
  /** The fill shows only while keys drive (a tap only picks). */
  const lit = (i: number) => props.focused(i) && showFocus();
  return (
    <Drawer id="tracks" sideways open={() => true} onClose={props.onClose} label={() => t("player.tracks")}
      head={() => <Switch col={props.col} onCol={props.onCol} />}>
      {(list) => (
        <View style={{ gap: 2 }}>
          <Each of={props.rows()} key={(r) => r.id}>
            {(r, i) => (
              <Pressable feedback="row" haptic={!props.isSelected(i(), r().selected)} ref={list.follow(() => props.focused(i()))}
                testID={r().id} role="button" accessibilityLabel={r().main} accessibilityState={{ selected: props.isSelected(i(), r().selected) }}
                onPress={() => props.onPick(i())} style={rowBox(props.isSelected(i(), r().selected), lit(i()))}>
                <View style={{ flex: 1 }}>
                  <Text style={nameText(props.isSelected(i(), r().selected), lit(i()))}>{r().main}</Text>
                  <If when={r().sub}>
                    <Text style={noteText(lit(i()))}>{r().sub!}</Text>
                  </If>
                </View>
                <If when={props.isSelected(i(), r().selected)}>
                  <Icon src={() => checkIcon} size={22} color={() => (lit(i()) ? colors.ink() : colors.snow())} />
                </If>
              </Pressable>
            )}
          </Each>
        </View>
      )}
    </Drawer>
  );
}
