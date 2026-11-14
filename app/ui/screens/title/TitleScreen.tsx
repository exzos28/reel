// A film or a show. Add to list at the top-right (the page's header
// action); the hero with Play and Trailer (when there is one), and under them
// the release Play uses (OK opens the releases in a panel on the right); then
// for a show the season tabs and the episodes; then About (the whole
// overview, who made it), the cast, the details and More like this. Remote:
// the focus starts on Play; Up from the actions reaches Add to list (Down
// comes back to the button left); Down goes to the release button, then the
// season tabs; on them Left and Right switch the season; OK on a release
// makes it the one Play uses, on an episode plays it; Down past the list
// walks the cast row, then More like this, where OK opens the title. Back
// closes the release panel, then goes one level up.
import { computed, effect, keymap, openUrl, signal, View, type ViewStyle } from "nsh";
import { t } from "nsh/i18n";
import {
  chooseRelease, episodeCode, episodeReleases, episodes, releaseLine, releasesText, title as titleOf, toggleList,
  type Episode, type Title,
} from "../../catalog";
import { clamp } from "../../focus/memory";
import { useZones } from "../../focus/zones";
import { Screen } from "../../layout/Screen";
import { scroller } from "../../layout/Scroller";
import { chrome, frame } from "../../layout/chrome";
import { caps } from "../../platform";
import { ListToggle } from "../../layout/ListToggle";
import { discCorner, FloatingBack } from "../../layout/TopBar";
import { handleBack, openTitle } from "../../nav";
import { pickReleaseFor, play, playing } from "../../playback";
import { safe, u } from "../../theme";
import { AboutBlock, hasAbout } from "./AboutBlock";
import { LazyBlock } from "../../layout/LazyBlock";
import { CastRow } from "./CastRow";
import { DetailsBlock, hasDetails } from "./DetailsBlock";
import { action, castAt, focusTitle, item, releaseAt, season, similarAt, zone, type Zone } from "./focus";
import { ReleasePanel } from "./ReleasePanel";
import { SeriesEpisodes } from "./SeriesEpisodes";
import { SimilarShelf } from "./SimilarShelf";
import { heroActions, TitleHero, type HeroAction } from "./TitleHero";

/** The page's header action, at the safe area's top-right. */
/** The page's header action: at the safe area's top-right on a TV, the disc
 * across from the back disc on a phone (a desktop's is in the window bar, a
 * tablet's in its top row). */
const headerStyle = (): ViewStyle =>
  chrome === "phone" ? discCorner("right") : { position: "absolute", top: safe().y, right: safe().x, zIndex: 3 };

export function TitleScreen(props: { id: string }) {
  const data = computed(() => titleOf(props.id) as Title);
  const isShow = () => data().kind === "show";
  focusTitle(props.id, data().season ?? 1);
  const eps = computed<Episode[]>(() => (isShow() ? episodes(props.id, season()) : []));
  const seasonCount = () => (data().seasonList ?? []).length;
  /** The release panel shows the title's releases (a film's, a show's season's),
   * or, for an episode its season's release lacks, that episode's. */
  const panelEpisode = signal<Episode | null>(null);
  const panelData = () => {
    const e = panelEpisode();
    return e ? episodeReleases(e.id) : { releases: data().releases, releasesState: data().releasesState, seasonRelease: null };
  };
  /** Releases: the short list until Show more, then all (the short list comes first). */
  const expanded = signal(false);
  const allReleases = () => panelData().releases;
  const shownReleases = () => (expanded() ? allReleases() : allReleases().filter((r) => r.top));
  const moreReleases = () => allReleases().length - shownReleases().length;
  /** Rows of the release list: the releases, then Show more when there are more. */
  const releaseRows = () => shownReleases().length + (moreReleases() > 0 ? 1 : 0);
  const searching = () => panelData().releasesState === "searching";
  /** The release panel is open (the focus is in it). */
  const panelOpen = () => zone() === "releases";
  const openPanel = (e: Episode | null = null) => {
    panelEpisode.set(e);
    expanded.set(false);
    releaseAt.set(Math.max(0, shownReleases().findIndex((r) => r.selected)));
    zone.set("releases");
  };
  const closePanel = () => {
    const e = panelEpisode();
    panelEpisode.set(null);
    if (e) enterList(Math.max(0, eps().findIndex((x) => x.id === e.id)));
    else zone.set("release");
  };
  /** OK on a release row: choose it and close (an episode's: and play it); on Show more: show the rest. */
  const pressRelease = (i: number) => {
    if (i >= shownReleases().length) return expanded.set(true);
    const e = panelEpisode();
    chooseRelease(e ? e.id : props.id, shownReleases()[i].index);
    closePanel();
    if (e) play({ id: e.id, season: e.season, episode: e.number, title: data() });
  };
  /** Rows under the tabs: a show's episodes (a film has none). */
  const listLength = () => (isShow() ? eps().length : 0);
  const cast = () => data().cast;
  const similar = () => data().similar;
  /** An episode its season's release lacks opens the panel to pick one for it. */
  const playEpisode = (e: Episode) =>
    e.inRelease === "no" ? openPanel(e) : play({ id: e.id, season: e.season, episode: e.number, title: data() });
  const releasesTitle = () => {
    const e = panelEpisode();
    if (e) return t("releases.title_episode", { episode: episodeCode(e.season, e.number) });
    const p = data().play;
    return p.season != null ? t("releases.title_season", { season: p.season }) : t("releases.title");
  };
  /** Over an episode's releases: the season's release does not hold it. */
  const panelMessage = () => {
    const e = panelEpisode();
    const r = panelData().seasonRelease;
    return e && r ? t("releases.not_in", { episode: episodeCode(e.season, e.number), release: releaseLine(r, false).name }) : "";
  };
  // Back from a player that found the episode missing from the season's release:
  // pick one for it (its season shown first).
  effect(() => {
    const key = pickReleaseFor();
    if (!key || playing() || !key.startsWith(`${props.id}:`)) return;
    const e = eps().find((x) => x.id === key);
    if (e) {
      pickReleaseFor.set(null);
      openPanel(e);
    } else {
      const s = Number(/:s(\d+)e\d+$/.exec(key)?.[1]);
      if (s && s !== season()) season.set(s);
    }
  });
  /** Opens the trailer's web page outside the app. */
  // TODO: a TV has no browser to open a YouTube page in (Tizen: hand it to the
  // YouTube app through the shell, or play the trailer in the app).
  const openTrailer = () => {
    const url = data().trailer;
    if (url) openUrl(url).catch((e) => console.warn(`reel: the trailer did not open: ${e}`));
  };
  const run: Record<HeroAction, () => void> = {
    play: () => play({ ...data().play, title: data() }),
    trailer: openTrailer,
  };
  const toggle = () => toggleList(props.id);
  if (caps.shortcuts) keymap.bind({ "mod+d": toggle });
  /** The hero's last stop: the release button when there is one, else the actions. */
  const heroEnd = (): Zone => (data().release ? "release" : "actions");
  /** Down from the hero: a show's season tabs, else the rows below. */
  const underHero = () => (isShow() ? zone.set("tabs") : below(null));
  const heroRow = () => heroActions(data());
  const actionCount = () => heroRow().length;
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
    else zone.set(isShow() ? "tabs" : heroEnd());
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
      // Add to list: Down returns to the action left; Left and Right stay.
      header: { down: () => zone.set("actions"), enter: toggle },
      actions: {
        left: () => action.set(Math.max(action() - 1, 0)),
        right: () => action.set(Math.min(action() + 1, actionCount() - 1)),
        // Add to list is above the actions on a TV (a desktop's is in the window bar, ⌘D / Ctrl+D).
        up: () => caps.remote && zone.set("header"),
        down: () => (data().release ? zone.set("release") : underHero()),
        enter: () => {
          const a = heroRow()[clamp(action(), actionCount() - 1)];
          if (a) run[a]();
        },
      },
      release: {
        up: () => zone.set("actions"),
        down: underHero,
        enter: () => openPanel(),
      },
      releases: {
        up: () => releaseAt.set(Math.max(releaseAt() - 1, 0)),
        down: () => releaseAt.set(Math.min(releaseAt() + 1, releaseRows() - 1)),
        enter: () => pressRelease(releaseAt()),
      },
      tabs: {
        left: () => season.set(Math.max(season() - 1, 1)),
        right: () => season.set(Math.min(season() + 1, seasonCount())),
        up: () => zone.set(heroEnd()),
        down: () => {
          if (listLength() > 0) enterList(firstItem());
          else below(null);
        },
      },
      list: {
        up: () => (item() > 0 ? item.set(item() - 1) : zone.set(isShow() ? "tabs" : heroEnd())),
        down: () => (item() < listLength() - 1 ? item.set(item() + 1) : below(null)),
        enter: () => playEpisode(eps()[item()]),
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
    // Back closes the release panel first.
    () => panelOpen() && (closePanel(), true),
  );

  const listFocus = () => (zone() === "list" ? item() : null);

  return (
    <View style={{ flex: 1 }}>
    <Screen ctl={page} bottom={40} hero={isShow() ? 640 : 700}>
      <FloatingBack onPress={handleBack} />
      <View ref={page.follow(() => zone() === "header" || zone() === "actions" || zone() === "release", "start")}>
        <TitleHero
          data={data}
          focusedAt={() => (zone() === "actions" ? action() : null)}
          releaseFocused={() => zone() === "release"}
          onPlay={run.play}
          onTrailer={run.trailer}
          onReleases={() => openPanel()}
        />
      </View>
      {/* On a desktop Add to list is in the window bar, on a tablet in the top row. */}
      <If when={frame.listInPage}>
        <View style={headerStyle()}>
          <ListToggle inList={() => data().inList} focused={() => zone() === "header"} onPress={toggle} />
        </View>
      </If>
      <If when={isShow()}>
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
    <ReleasePanel
        open={panelOpen}
        title={releasesTitle}
        header={() => (panelEpisode() ? releasesText({ ...data(), ...panelData() } as Title) : releasesText(data()))}
        message={panelMessage}
        releases={shownReleases}
        loading={searching}
        more={moreReleases}
        onMore={() => expanded.set(true)}
        focusedAt={releaseAt}
        onPress={(i) => {
          releaseAt.set(i);
          pressRelease(i);
        }}
        onClose={closePanel}
      />
    </View>
  );
}
