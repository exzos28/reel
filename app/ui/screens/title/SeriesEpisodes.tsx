// A show's season tabs and the chosen season's episodes.
import { Text, View, type ViewStyle } from "nsh";
import { t } from "nsh/i18n";
import { seasonText, type Episode, type Title } from "../../catalog";
import { bodyText } from "../../kit/text";
import type { Follow, ScrollCtl } from "../../layout/Scroller";
import { safe, u } from "../../theme";
import { EpisodeRow } from "./EpisodeRow";
import { SeasonTabs } from "./SeasonTabs";

const listStyle = (): ViewStyle => ({ paddingHorizontal: safe().x, gap: u(12), marginTop: u(26) });

export function SeriesEpisodes(props: {
  data: () => Title;
  episodes: () => Episode[];
  season: () => number;
  tabsFocused: () => boolean;
  focusedAt: () => number | null;
  follow: Follow;
  onPickSeason: (n: number) => void;
  onPlay: (i: number) => void;
  /** The page's scroll: the wheel up and down over the season tabs moves it. */
  page: ScrollCtl;
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
      page={props.page}
    />,
    <View style={listStyle()}>
      <If when={props.episodes().length > 0} else={<Text style={bodyText()}>{t("series.no_episodes")}</Text>}>
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
      </If>
    </View>,
  ];
}
