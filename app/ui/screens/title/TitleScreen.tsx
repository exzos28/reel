// A film or a show. The hero with Play and Add to list, the release Play
// uses; then for a film its releases (fastest to start first), for a show
// the season tabs and the episodes. Remote: the focus starts on Play; Up
// from the actions reaches the back button; on the season tabs Left and
// Right switch the season; OK on a release makes it the one Play uses, on
// an episode plays it. Back goes one level up.
import { computed, View } from "nsh";
import {
  chooseRelease, episodes, releasesText, title as titleOf, toggleList, type Episode, type Title,
} from "../../catalog";
import { useZones } from "../../focus/zones";
import { Screen } from "../../layout/Screen";
import { scroller } from "../../layout/Scroller";
import { FloatingBack } from "../../layout/TopBar";
import { back } from "../../nav";
import { play } from "../../playback";
import { action, focusTitle, item, season, zone } from "./focus";
import { ReleaseList } from "./ReleaseList";
import { SeriesEpisodes } from "./SeriesEpisodes";
import { TitleHero } from "./TitleHero";

export function TitleScreen(props: { id: string }) {
  const data = computed(() => titleOf(props.id) as Title);
  const isShow = () => data().kind === "show";
  focusTitle(props.id, data().season ?? 1);
  const eps = computed<Episode[]>(() => (isShow() ? episodes(props.id, season()) : []));
  const seasonCount = () => (data().seasonList ?? []).length;
  /** Rows under the tabs: episodes of a show, releases of a film. */
  const listLength = () => (isShow() ? eps().length : data().releases.length);
  const playEpisode = (e: Episode) => play({ id: e.id, season: e.season, episode: e.number, title: data() });
  const choose = (i: number) => chooseRelease(props.id, data().releases[i].index);
  const actions = [() => play({ ...data().play, title: data() }), () => toggleList(props.id)];
  /** Where the focus lands in a season's episodes: where the viewer is, else the first. */
  const firstItem = () => {
    const r = data().resume;
    return r && r.season === season() ? r.episode - 1 : 0;
  };
  const enterList = (at: number) => {
    zone.set("list");
    item.set(at);
  };

  /** The page puts the focused row (or the season tabs) in its upper third. */
  const page = scroller({ anchor: (viewport) => viewport / 3 });

  useZones(
    zone,
    {
      back: { down: () => zone.set("actions"), enter: back },
      actions: {
        left: () => action.set(Math.max(action() - 1, 0)),
        right: () => action.set(Math.min(action() + 1, actions.length - 1)),
        up: () => zone.set("back"),
        down: () => {
          if (isShow()) zone.set("tabs");
          else if (listLength() > 0) enterList(0);
        },
        enter: () => actions[action()](),
      },
      tabs: {
        left: () => season.set(Math.max(season() - 1, 1)),
        right: () => season.set(Math.min(season() + 1, seasonCount())),
        up: () => zone.set("actions"),
        down: () => {
          if (listLength() > 0) enterList(firstItem());
        },
      },
      list: {
        up: () => (item() > 0 ? item.set(item() - 1) : zone.set(isShow() ? "tabs" : "actions")),
        down: () => item.set(Math.min(item() + 1, listLength() - 1)),
        enter: () => (isShow() ? playEpisode(eps()[item()]) : choose(item())),
      },
    },
    back,
  );

  const listFocus = () => (zone() === "list" ? item() : null);

  return (
    <Screen ctl={page} bottom={40}>
      <FloatingBack focused={() => zone() === "back"} onPress={back} />
      <View ref={page.follow(() => zone() === "back" || zone() === "actions", "start")}>
        <TitleHero
          data={data}
          focusedAt={() => (zone() === "actions" ? action() : null)}
          onPlay={actions[0]}
          onToggle={actions[1]}
        />
      </View>
      <If
        when={isShow()}
        else={
          <ReleaseList
            releases={() => data().releases}
            header={() => releasesText(data())}
            focused={(i) => listFocus() === i}
            follow={page.follow}
            onPress={(i) => {
              enterList(i);
              choose(i);
            }}
          />
        }
      >
        <SeriesEpisodes
          data={data}
          episodes={eps}
          season={season}
          tabsFocused={() => zone() === "tabs"}
          focusedAt={listFocus}
          follow={page.follow}
          onPickSeason={(n) => {
            zone.set("tabs");
            season.set(n);
          }}
          onPlay={(i) => {
            enterList(i);
            playEpisode(eps()[i]);
          }}
        />
      </If>
    </Screen>
  );
}
