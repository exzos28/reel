// A film or a show. The hero with Play and Add to list, the release Play
// uses; then for a film its releases (fastest to start first), for a show
// the season tabs and the episodes; then About (the whole overview, who made
// it), the cast, the details and More like this. Remote: the focus starts on
// Play; Up from the actions reaches the back button; on the season tabs Left
// and Right switch the season; OK on a release makes it the one Play uses,
// on an episode plays it; Down past the list walks the cast row, then More
// like this, where OK opens the title. Back goes one level up.
import { computed, View } from "nsh";
import {
  chooseRelease, episodes, releasesText, title as titleOf, toggleList, type Episode, type Title,
} from "../../catalog";
import { clamp } from "../../focus/memory";
import { useZones } from "../../focus/zones";
import { Screen } from "../../layout/Screen";
import { scroller } from "../../layout/Scroller";
import { backInTitleBar, FloatingBack } from "../../layout/TopBar";
import { back, openTitle } from "../../nav";
import { play } from "../../playback";
import { u } from "../../theme";
import { AboutBlock, hasAbout } from "./AboutBlock";
import { LazyBlock } from "../../layout/LazyBlock";
import { CastRow } from "./CastRow";
import { DetailsBlock, hasDetails } from "./DetailsBlock";
import { action, castAt, focusTitle, item, season, similarAt, zone, type Zone } from "./focus";
import { ReleaseList } from "./ReleaseList";
import { SeriesEpisodes } from "./SeriesEpisodes";
import { SimilarShelf } from "./SimilarShelf";
import { TitleHero } from "./TitleHero";

export function TitleScreen(props: { id: string }) {
  const data = computed(() => titleOf(props.id) as Title);
  const isShow = () => data().kind === "show";
  focusTitle(props.id, data().season ?? 1);
  const eps = computed<Episode[]>(() => (isShow() ? episodes(props.id, season()) : []));
  const seasonCount = () => (data().seasonList ?? []).length;
  /** Rows under the tabs: episodes of a show, releases of a film. */
  const listLength = () => (isShow() ? eps().length : data().releases.length);
  const cast = () => data().cast;
  const similar = () => data().similar;
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

  /** The rows below the list the remote stops on, in order. */
  const lower = (): Zone[] => [
    ...(cast().length ? (["cast"] as Zone[]) : []),
    ...(similar().length ? (["similar"] as Zone[]) : []),
  ];
  /** Down from `from` (a lower row, or null: from the list or above it). */
  const below = (from: Zone | null) => {
    const rows = lower();
    const next = rows[from ? rows.indexOf(from) + 1 : 0];
    if (next) zone.set(next);
  };
  /** Up from a lower row: the one above it, else the list, the tabs or the actions. */
  const above = (from: Zone) => {
    const rows = lower();
    const prev = rows[rows.indexOf(from) - 1];
    if (prev) zone.set(prev);
    else if (listLength() > 0) enterList(clamp(item(), listLength() - 1));
    else zone.set(isShow() ? "tabs" : "actions");
  };
  const openSimilar = (i: number) => {
    zone.set("similar");
    similarAt.set(i);
    openTitle(similar()[i].id);
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
        // On a Mac Back is in the title bar, out of the remote's reach (Esc goes back).
        up: () => !backInTitleBar && zone.set("back"),
        down: () => {
          if (isShow()) zone.set("tabs");
          else if (listLength() > 0) enterList(0);
          else below(null);
        },
        enter: () => actions[action()](),
      },
      tabs: {
        left: () => season.set(Math.max(season() - 1, 1)),
        right: () => season.set(Math.min(season() + 1, seasonCount())),
        up: () => zone.set("actions"),
        down: () => {
          if (listLength() > 0) enterList(firstItem());
          else below(null);
        },
      },
      list: {
        up: () => (item() > 0 ? item.set(item() - 1) : zone.set(isShow() ? "tabs" : "actions")),
        down: () => (item() < listLength() - 1 ? item.set(item() + 1) : below(null)),
        enter: () => (isShow() ? playEpisode(eps()[item()]) : choose(item())),
      },
      cast: {
        left: () => castAt.set(clamp(castAt() - 1, cast().length - 1)),
        right: () => castAt.set(clamp(castAt() + 1, cast().length - 1)),
        up: () => above("cast"),
        down: () => below("cast"),
      },
      similar: {
        left: () => similarAt.set(clamp(similarAt() - 1, similar().length - 1)),
        right: () => similarAt.set(clamp(similarAt() + 1, similar().length - 1)),
        up: () => above("similar"),
        enter: () => openSimilar(clamp(similarAt(), similar().length - 1)),
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
      {/* About and the cast come into view together as the remote reaches the cast. */}
      <View ref={page.follow(() => zone() === "cast")} style={{ gap: u(48), marginTop: u(56) }}>
        <If when={hasAbout(data())}>
          <AboutBlock data={data} />
        </If>
        <If when={cast().length > 0}>
          <LazyBlock page={page} height={() => u(300)}>
          <CastRow
            cast={cast}
            focusedAt={() => (zone() === "cast" ? castAt() : null)}
            onFocus={(i) => {
              zone.set("cast");
              castAt.set(i);
            }}
          />
          </LazyBlock>
        </If>
      </View>
      {/* So do the details and More like this. */}
      <View ref={page.follow(() => zone() === "similar")} style={{ gap: u(48), marginTop: u(48) }}>
        <If when={hasDetails(data())}>
          <DetailsBlock data={data} />
        </If>
        <If when={similar().length > 0}>
          <LazyBlock page={page} height={() => u(198 + 160)}>
          <SimilarShelf
            items={similar}
            focusedAt={() => (zone() === "similar" ? similarAt() : null)}
            onOpen={openSimilar}
          />
          </LazyBlock>
        </If>
      </View>
    </Screen>
  );
}
