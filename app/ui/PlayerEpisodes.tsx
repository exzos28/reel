// The show's episodes inside the player: a panel on the right with the seasons on top and the
// season's episodes under them, the one playing marked. A press (or OK) plays one at once; one
// that has not aired is dimmed and does not play. Up/down move along the episodes, left/right
// change the season, Back closes it.
import { computed, Image, keymap, Scroll, signal, Text, View, type TextStyle, type ViewStyle } from "nsh";
import { t } from "nsh/i18n";
import { episodeCode, episodes, runtime, shortDate, title, type Episode, type Summary } from "./catalog";
import { onBack } from "./nav";
import { alpha, colors, focusRing, font, radius, safe, showFocus, ts, type, u } from "./theme";

const panelStyle = (): ViewStyle => ({
  position: "absolute", top: u(130), bottom: u(60), right: safe().x, width: u(780), maxWidth: "90%",
  padding: u(26), gap: u(18), borderRadius: radius() + u(26), borderCurve: "continuous", backgroundColor: colors.card(),
});
const seasonStyle = (on: boolean, lit: boolean): ViewStyle => ({
  height: u(52), paddingHorizontal: u(22), borderRadius: u(26), alignItems: "center", justifyContent: "center",
  backgroundColor: on ? colors.snow() : colors.raise(), ...focusRing(lit),
});
const rowStyle = (current: boolean, lit: boolean, dim: boolean): ViewStyle => ({
  flexDirection: "row", alignItems: "center", gap: u(18), padding: u(10), borderRadius: radius(), borderCurve: "continuous",
  backgroundColor: lit ? colors.snow() : current ? colors.raise() : "transparent", opacity: dim ? 0.45 : 1,
});
const thumbStyle = (): ViewStyle => ({ width: u(208), height: u(117), borderRadius: radius(), overflow: "hidden", backgroundColor: colors.raise() });
const nameStyle = (lit: boolean): TextStyle => ({ ...type.label(), color: lit ? colors.ink() : colors.snow(), numberOfLines: 2 });
const metaStyle = (lit: boolean): TextStyle => ({ fontFamily: font, fontSize: ts(20), color: lit ? alpha(colors.ink(), 0.7) : colors.ash(), marginTop: u(4) });

export function PlayerEpisodes(props: {
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
  // Newer than the player's bindings: the picture under the panel does not move.
  keymap.bind({
    up: () => at.set(Math.max(-1, at() - 1)),
    down: () => at.set(Math.min(list().length - 1, at() + 1)),
    left: () => moveSeason(-1),
    right: () => moveSeason(1),
    enter: () => {
      const e = list()[at()];
      if (e) pick(e);
    },
  });
  onBack(() => (props.onClose(), true));
  const lit = (i: number) => showFocus() && at() === i;
  return (
    <View testID="episodes-panel" style={panelStyle()}>
      <Text style={{ ...type.label(), color: colors.ash() }}>{t("player.episodes")}</Text>
      <If when={seasons().length > 1}>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: u(10) }}>
          <Each of={seasons()} key={(n) => n}>
            {(n) => (
              <View role="tab" accessibilityLabel={t("series.season", { number: n() })} accessibilityState={{ selected: season() === n() }}
                onPress={() => (season.set(n()), at.set(-1))} style={seasonStyle(season() === n(), showFocus() && at() === -1 && season() === n())}>
                <Text style={{ ...type.label(), color: season() === n() ? colors.ink() : colors.snow() }}>{t("series.season", { number: n() })}</Text>
              </View>
            )}
          </Each>
        </View>
      </If>
      <Scroll style={{ flex: 1 }} scrollbar={false}>
        <View style={{ gap: u(6) }}>
        <Each of={list()} key={(e) => e.id}>
          {(e, i) => {
            const current = () => season() === props.season() && e().number === props.episode();
            return (
              <View role="button" accessibilityLabel={`${episodeCode(e().season, e().number)} ${e().title}`}
                onPress={() => pick(e())} hoverStyle={{ backgroundColor: colors.raise() }} style={rowStyle(current(), lit(i()), !playable(e()))}>
                <View style={thumbStyle()}>
                  <If when={e().thumb}>{(src) => <Image src={src()} style={{ width: "100%", height: "100%", objectFit: "cover" }} />}</If>
                  <If when={e().progress > 0 && !e().watched}>
                    <View style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: u(5), backgroundColor: alpha(colors.snow(), 0.25) }}>
                      <View style={{ height: "100%", width: `${Math.round(e().progress * 100)}%`, backgroundColor: colors.snow() }} />
                    </View>
                  </If>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={nameStyle(lit(i()))}>{`${e().number}. ${e().title}`}</Text>
                  <Text style={metaStyle(lit(i()))}>
                    {e().upcoming ? t("series.airs", { date: shortDate(e().date) }) : current() ? t("player.now_playing") : runtime(e().minutes)}
                  </Text>
                </View>
              </View>
            );
          }}
        </Each>
        </View>
      </Scroll>
    </View>
  );
}
