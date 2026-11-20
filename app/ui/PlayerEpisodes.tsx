// The show's episodes inside the player: a panel on the right with the seasons on top and the
// season's episodes under them, the one playing marked. A press (or OK) plays one at once; one
// that has not aired is dimmed and does not play. Up/down move along the episodes, left/right
// change the season, Back closes it. The seasons scroll sideways in one row, the episodes up and
// down, each following where the keys are. On a phone it is a sheet (`Drawer`: from the bottom,
// at the right held sideways) with its own ✕ and the season and its count as its title, so it
// never covers the player's ✕ and title; elsewhere on touch the panel has a ✕ of its own. The season
// shown is a lighter pill with a check. Each row has the episode's number in a column of its own.
import { computed, Image, keymap, signal, Text, View, type JSX, type TextStyle, type ViewStyle } from "nsh";
import { t } from "nsh/i18n";
import { episodeCode, episodes, runtime, shortDate, title, type Episode, type Summary } from "./catalog";
import { Scroller, scroller, type ScrollCtl } from "./layout/Scroller";
import { Drawer } from "./layout/Drawer";
import { frame } from "./layout/chrome";
import { byKeys } from "./focus/keys";
import { onBack } from "./nav";
import { alpha, colors, font, iconPt, radius, ringRoom, safe, selectedFill, showFocus, targetSlop, ts, type, u } from "./theme";
import { Pressable } from "./kit/Pressable";
import { Icon } from "./kit/Icon";
import { pillStyle } from "./kit/Pill";
import { row } from "./kit/shape";
import { caps } from "./platform";
import checkIcon from "./icons/check.svg";
import plusIcon from "./icons/plus.svg";

const panelStyle = (): ViewStyle => ({
  // Over the controls (the scrubber, the times, the volume), which come later in the player.
  position: "absolute", zIndex: 20, top: u(130), right: safe().x, width: u(780), maxWidth: "90%",
  padding: u(26), gap: u(18), borderRadius: radius() + u(26), borderCurve: "continuous", backgroundColor: colors.card(),
});
/** The seasons' row: room for the focus ring around a pill, the panel's edge under it. */
const seasonsRowStyle = (): ViewStyle => ({ flexDirection: "row", gap: u(10), padding: ringRoom() });
const seasonsStyle = (): ViewStyle => ({ marginHorizontal: -ringRoom(), marginVertical: -ringRoom() });
/** The season shown: a lighter fill and a check (selected), never the focus's white. */
const seasonStyle = (on: boolean, lit: boolean): ViewStyle => pillStyle(selectedFill(on), lit, 22);
/** The panel's head: its name, and on touch its ✕ (no Back key on screen; a tap beside it closes it too). */
const headStyle = (): ViewStyle => ({ ...row(u(16)), justifyContent: "space-between", minHeight: u(56) });
const closeStyle = (): ViewStyle => ({
  width: u(56), height: u(56), borderRadius: u(28), alignItems: "center", justifyContent: "center", backgroundColor: colors.raise(),
});
const rowStyle = (current: boolean, lit: boolean, dim: boolean): ViewStyle => ({
  flexDirection: "row", alignItems: "center", gap: u(18), padding: u(10), borderRadius: radius(), borderCurve: "continuous",
  backgroundColor: lit ? colors.snow() : current ? colors.raise() : "transparent", opacity: dim ? 0.45 : 1,
});
const thumbStyle = (): ViewStyle => ({ width: u(208), height: u(117), borderRadius: radius(), overflow: "hidden", backgroundColor: colors.raise() });
const nameStyle = (lit: boolean): TextStyle => ({ ...type.label(), color: lit ? colors.ink() : colors.snow(), numberOfLines: 2, textOverflow: "ellipsis" });
/** The episode's number, a column of its own (the title does not repeat it). */
const numberStyle = (lit: boolean): TextStyle => ({
  ...type.label(), color: lit ? colors.ink() : colors.ash(), minWidth: u(34), textAlign: "right", fontVariant: ["tabular-nums"],
});
const metaStyle = (lit: boolean): TextStyle => ({ fontFamily: font, fontSize: ts(20), color: lit ? alpha(colors.ink(), 0.7) : colors.ash(), marginTop: u(4) });

export function PlayerEpisodes(props: {
  /** Where it ends from the player's bottom: above the controls (it never covers the scrubber). */
  bottom: () => number;
  /** The show (what the player plays belongs to). */
  show: () => Summary;
  /** The episode playing. */
  season: () => number;
  episode: () => number;
  onPlay: (e: Episode) => void;
  onClose: () => void;
}) {
  const seasons = computed(() => (title(props.show().id)?.seasonList ?? []).map((s) => s.number));
  const season = signal(props.season());
  const list = computed(() => episodes(props.show().id, season()) ?? []);
  /** How many the season has: the rows once they are there, the show's count until then. */
  const count = () => list().length || (title(props.show().id)?.seasonList?.find((s) => s.number === season())?.episodes ?? 0);
  /** Where the keys are: the seasons' row (-1) or an episode. */
  const at = signal(Math.max(0, props.episode() - 1));
  const playable = (e: Episode) => !e.upcoming;
  const pick = (e: Episode) => playable(e) && props.onPlay(e);
  const moveSeason = (d: number) => {
    const all = seasons();
    const i = all.indexOf(season());
    const next = all[Math.min(Math.max(i + d, 0), all.length - 1)];
    if (next != null && next !== season()) {
      season.set(next);
      at.set(-1);
    }
  };
  // Newer than the player's bindings: the picture under the panel does not move. The arrows
  // through `byKeys`: the moves count as the keys', which the lists' scroll views follow.
  keymap.bind(
    byKeys({
      up: () => at.set(Math.max(-1, at() - 1)),
      down: () => at.set(Math.min(list().length - 1, at() + 1)),
      left: () => moveSeason(-1),
      right: () => moveSeason(1),
    }),
    { repeat: true },
  );
  keymap.bind({
    enter: () => {
      const e = list()[at()];
      if (e) pick(e);
    },
  });
  onBack(() => (props.onClose(), true));
  const lit = (i: number) => showFocus() && at() === i;
  /** The season shown stays in view as left/right change it; the episode the keys are on, as
   * up/down move (a third down the list, as a page keeps its focus). */
  const seasonRow = scroller({ horizontal: true, anchor: (viewport) => viewport / 3 });
  const episodeList = scroller({ anchor: (viewport) => viewport / 3 });
  const seasonsRow = () => (
      <If when={seasons().length > 1}>
        <Scroller ctl={seasonRow} style={seasonsStyle()}>
          <View style={seasonsRowStyle()}>
          <Each of={seasons()} key={(n) => n}>
            {(n) => (
              <Pressable haptic={season() !== n()} ref={seasonRow.follow(() => season() === n(), "nearest")} role="tab" accessibilityLabel={t("series.season", { number: n() })} accessibilityState={{ selected: season() === n() }}
                onPress={() => (season.set(n()), at.set(-1))} style={seasonStyle(season() === n(), showFocus() && at() === -1 && season() === n())}>
                <Text style={{ ...type.label(), color: season() === n() ? colors.snow() : colors.soft() }}>{t("series.season", { number: n() })}</Text>
                <If when={season() === n()}>
                  <Icon src={() => checkIcon} size={20} color={() => colors.snow()} />
                </If>
              </Pressable>
            )}
          </Each>
          </View>
        </Scroller>
      </If>
  );
  /** The rows; `follow` keeps the one with the keys in view (the panel's list, the sheet's). */
  const rows = (follow: ScrollCtl["follow"]): JSX.Element => (
        <View style={{ gap: u(6) }}>
        <Each of={list()} key={(e) => e.id}>
          {(e, i) => {
            const current = () => season() === props.season() && e().number === props.episode();
            return (
              <Pressable feedback="row" ref={follow(() => at() === i())} role="button" accessibilityLabel={`${episodeCode(e().season, e().number)} ${e().title}`}
                onPress={() => pick(e())} hoverStyle={{ backgroundColor: colors.raise() }} style={rowStyle(current(), lit(i()), !playable(e()))}>
                <View style={thumbStyle()}>
                  <If when={e().thumb}>{(src) => <Image src={src()} style={{ width: "100%", height: "100%", objectFit: "cover" }} />}</If>
                  <If when={e().progress > 0 && !e().watched}>
                    <View style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: u(5), backgroundColor: alpha(colors.snow(), 0.25) }}>
                      <View style={{ height: "100%", width: `${Math.round(e().progress * 100)}%`, backgroundColor: colors.snow() }} />
                    </View>
                  </If>
                </View>
                <Text style={numberStyle(lit(i()))}>{String(e().number)}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={nameStyle(lit(i()))}>{e().title}</Text>
                  <Text style={metaStyle(lit(i()))}>
                    {e().upcoming ? t("series.airs", { date: shortDate(e().date) }) : current() ? t("player.now_playing") : runtime(e().minutes)}
                  </Text>
                </View>
              </Pressable>
            );
          }}
        </Each>
        </View>
  );
  return (
    <If
      when={frame().panel === "bottom-sheet"}
      else={
        <View testID="episodes-panel" style={{ ...panelStyle(), bottom: props.bottom() }}>
          <View style={headStyle()}>
            <Text style={{ ...type.label(), color: colors.ash() }}>{t("player.episodes")}</Text>
            <If when={caps.touch}>
              <Pressable testID="episodes-close" role="button" accessibilityLabel={t("player.close_episodes")} hitSlop={targetSlop(u(56))} onPress={props.onClose} style={closeStyle()}>
                <View style={{ transform: "rotate(45deg)" }}>
                  <Icon src={() => plusIcon} size={iconPt(15)} />
                </View>
              </Pressable>
            </If>
          </View>
          {seasonsRow()}
          <Scroller ctl={episodeList} style={{ flex: 1 }}>{rows(episodeList.follow)}</Scroller>
        </View>
      }
    >
      <Drawer id="episodes" sideways open={() => true} onClose={props.onClose}
        title={() => t(`player.season_episodes.${count() === 1 ? "one" : "other"}`, { number: season(), count: count() })} head={seasons().length > 1 ? seasonsRow : undefined}>
        {(sheetList) => rows(sheetList.follow)}
      </Drawer>
    </If>
  );
}
