// A show's season tabs and the chosen season's episodes.
import { Text, View, type ViewStyle } from "nsh";
import { t } from "nsh/i18n";
import { seasonText, type Episode, type Title } from "../../catalog";
import { bodyText } from "../../kit/text";
import type { Follow } from "../../layout/Scroller";
import { safe, u } from "../../theme";
import { episodeColumns } from "../../layout/wide";
import { EpisodeRow } from "./EpisodeRow";
import { SeasonTabs } from "./SeasonTabs";

const listStyle = (): ViewStyle => ({ paddingHorizontal: safe().x, gap: u(12), marginTop: u(26) });
const pairStyle = (): ViewStyle => ({ flexDirection: "row", gap: u(24), alignItems: "stretch" });

/** The episodes two by two, with their indexes (the second of the last may be missing). */
const pairs = (all: Episode[]) => Array.from({ length: Math.ceil(all.length / 2) }, (_, p) => ({ at: p * 2, items: all.slice(p * 2, p * 2 + 2) }));

export function SeriesEpisodes(props: {
  data: () => Title;
  episodes: () => Episode[];
  season: () => number;
  tabsFocused: () => boolean;
  focusedAt: () => number | null;
  follow: Follow;
  onPickSeason: (n: number) => void;
  onPlay: (i: number) => void;
}) {
  const seasons = () => props.data().seasonList ?? [];
  const sub = () => {
    const s = seasons()[props.season() - 1];
    return s ? seasonText(s) : "";
  };
  return [
    <SeasonTabs
      seasons={seasons}
      season={props.season}
      focused={props.tabsFocused}
      follow={props.follow}
      onPick={props.onPickSeason}
      sub={sub}
    />,
    <View style={listStyle()}>
      <If when={props.episodes().length > 0} else={<Text style={bodyText()}>{t("series.no_episodes")}</Text>}>
        {/* A tablet held wide: two columns (more episodes in view, the about in two lines). */}
        <If
          when={episodeColumns() === 2}
          else={
            <Each of={props.episodes()} key={(e) => e.id}>
              {(e, i) => (
                <EpisodeRow
                  episode={e}
                  focused={() => props.focusedAt() === i()}
                  viewRef={props.follow(() => props.focusedAt() === i())}
                  onPress={() => props.onPlay(i())}
                />
              )}
            </Each>
          }
        >
          <Each of={pairs(props.episodes())} key={(p) => p.items[0].id}>
            {(p) => (
              <View style={pairStyle()}>
                <Each of={p().items} key={(e) => e.id}>
                  {(e, c) => (
                    <EpisodeRow
                      column
                      episode={e}
                      focused={() => props.focusedAt() === p().at + c()}
                      viewRef={props.follow(() => props.focusedAt() === p().at + c())}
                      onPress={() => props.onPlay(p().at + c())}
                    />
                  )}
                </Each>
                <If when={p().items.length < 2}>
                  <View style={{ flex: 1 }} />
                </If>
              </View>
            )}
          </Each>
        </If>
      </If>
    </View>,
  ];
}
