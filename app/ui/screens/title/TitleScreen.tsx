// A film or a show. Add to list at the top-right (the page's header
// action); the hero with Play (the release it plays inside it, and ⌄, which
// opens the releases in a panel on the right), Save and Trailer (when there
// is one); then for a show the season tabs and the episodes; then About (the
// whole overview, who made it), the cast, the details and More like this.
// Remote: the focus starts on Play; Left and Right walk Play, ⌄, Save,
// Trailer; Up from them reaches Add to list (Down comes back to the button
// left); Down goes to the season tabs; on them Left and Right switch the
// season; OK on a release makes it the one Play uses, on an episode plays it;
// Down past the list walks the cast row, then More like this, where OK opens
// the title; OK on a person of the cast opens their page. Back closes the release panel, then
// goes one level up.
import { computed, effect, keymap, openUrl, signal, View } from "nsh";
import { t } from "nsh/i18n";
import { chooseRelease, episodeCode, episodeReleases, episodes, releaseLine, releasesText, title as titleOf, titleText, toggleList, type Episode, type Title } from "../../catalog";
import { clamp } from "../../focus/memory";
import { useZones } from "../../focus/zones";
import { PageFrame } from "../../layout/PageFrame";
import { scroller } from "../../layout/Scroller";
import { caps } from "../../platform";
import { ListToggle } from "../../layout/ListToggle";
import { go, openPerson, openTitle } from "../../nav";
import { isSaved, NO_PLAN, save as saveKeys, saveOffer, saveRelease, seasonPlan, titleSaveState, watchSaved, type SaveOffer } from "../../library";
import { ConfirmDialog, type Confirm } from "../../layout/ConfirmDialog";
import { Fmt } from "../../native";
import { SaveDrawer } from "./SaveDrawer";
import { openSourceDrawer } from "../source/SourceDrawer";
import { playGate } from "../source/playGate";
import { pickReleaseFor, play as startPlay, playing } from "../../playback";
import { u } from "../../theme";
import { AboutBlock, hasAbout } from "./AboutBlock";
import { LazyBlock } from "../../layout/LazyBlock";
import { CastRow } from "./CastRow";
import { DetailsBlock, hasDetails } from "./DetailsBlock";
import { action, castAt, focusTitle, item, releaseAt, season, similarAt, zone, type HeroAction, type Zone } from "./focus";
import { ReleasePanel } from "./ReleasePanel";
import { SeriesEpisodes } from "./SeriesEpisodes";
import { shelfCardWidth, wideCardHeight } from "../home/WideCard";
import { SimilarShelf } from "./SimilarShelf";
import { heroActions, TitleHero } from "./TitleHero";


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
  const gate = playGate(data, () => startPlay({ ...data().play, title: data() }));
  // ---- Save (design/offline-downloads.md): a film saves at once; a show opens the drawer.
  watchSaved();
  /** The drawer's season, the episodes ticked in it (keys) and its focused row. */
  const saveSeason = signal(1);
  const picked = signal<Set<string>>(new Set());
  const saveAt = signal(0);
  /** Asked only while the drawer is open (the plan reads the season's release and its files). */
  const plan = computed(() => (zone() === "save" ? seasonPlan(props.id, saveSeason(), [...picked()]) : NO_PLAN));
  /** A film's release that does not fit: the question with the smaller one the core names. */
  const noSpace = signal<Confirm | null>(null);
  const askNoSpace = (o: SaveOffer): Confirm => ({
    title: t("title.no_space_title"),
    about: t("title.no_space_about", { needed: Fmt.size(o.size ?? 0), free: Fmt.size(o.free ?? 0) }),
    action: o.smaller ? t("title.save_smaller", { quality: o.smaller.quality, size: Fmt.size(o.smaller.size) }) : t("title.other_releases"),
    onConfirm: () => (o.smaller ? saveRelease(props.id, o.smaller.id) : openPanel()),
  });
  const saveRows = () => plan().episodes.length + 2;
  const openSave = () => {
    if (!isShow()) {
      const st = titleSaveState(props.id, false).state;
      // Saved or being saved: the Saved screen shows how it goes.
      if (st !== "none" && st !== "failed") return go("saved");
      // Not started when it cannot fit (design/offline-downloads.md, "Fit").
      const offer = saveOffer(props.id);
      return offer.fits === false ? noSpace.set(askNoSpace(offer)) : saveKeys([props.id]);
    }
    saveSeason.set(season());
    picked.set(new Set());
    saveAt.set(0);
    zone.set("save");
  };
  const togglePick = (key: string) => {
    const next = new Set(picked());
    next.has(key) ? next.delete(key) : next.add(key);
    picked.set(next);
  };
  /** Whole season: tick every episode not saved yet, or untick them all when they are. */
  const toggleWhole = () => {
    const open = plan().episodes.filter((e) => !e.locked);
    const next = new Set(picked());
    const all = open.every((e) => next.has(e.key));
    for (const e of open) all ? next.delete(e.key) : next.add(e.key);
    picked.set(next);
  };
  const saveRow = (i: number) => {
    const eps = plan().episodes;
    if (i === 0) return toggleWhole();
    if (i <= eps.length) return eps[i - 1].locked ? undefined : togglePick(eps[i - 1].key);
    doSave();
  };
  const doSave = () => {
    const keys = [...picked()];
    if (!keys.length || plan().picked.fits === false) return;
    saveKeys(keys);
    picked.set(new Set());
    zone.set("actions");
  };
  const seasonsForSave = () => (data().seasonList ?? []).map((s) => ({ number: s.number, episodes: s.episodes }));
  /** Play; with no search source the drawer that adds one (the player would only fail). A
   * saved film or episode plays from its file: no source, no network needed. */
  const play = (p: Parameters<typeof startPlay>[0]) => (data().playable || isSaved(p.id) ? startPlay(p) : openSourceDrawer());
  // The episode stays set while the drawer slides out (else it shows the season's
  // releases for a moment); openPanel sets it again.
  const closePanel = () => {
    const e = panelEpisode();
    if (e) enterList(Math.max(0, eps().findIndex((x) => x.id === e.id)));
    else {
      action.set("releases");
      zone.set("actions");
    }
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
  const playEpisode = (e: Episode) => {
    if (e.upcoming) return; // not aired: nothing to play yet
    e.inRelease === "no" ? openPanel(e) : play({ id: e.id, season: e.season, episode: e.number, title: data() });
  };
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
    // Play waits for the source's answer: the release plays once known, the drawer opens if there is none.
    // A saved film plays at once, offline too; else Play waits for the source's answer.
    play: () => (isSaved(data().play.id) ? startPlay({ ...data().play, title: data() }) : gate.press()),
    releases: () => openPanel(),
    save: openSave,
    trailer: openTrailer,
  };
  const toggle = () => toggleList(props.id);
  if (caps.shortcuts) keymap.bind({ "mod+d": toggle });
  /** Down from the hero: a show's season tabs, else the rows below. */
  const underHero = () => (isShow() ? zone.set("tabs") : below(null));
  const heroRow = () => heroActions(data());
  /** Where the focus is in the row: its action, or Play when the row lost it (the search found no release). */
  const actionAt = () => Math.max(0, heroRow().indexOf(action()));
  const stepAction = (by: number) => {
    const row = heroRow();
    action.set(row[clamp(actionAt() + by, row.length - 1)]);
  };
  /** The focused action as the hero shows it (Play when the row lost it). */
  const focusedAction = () => (zone() === "actions" ? heroRow()[actionAt()] : null);
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
  /** A person of the cast: their page (one reel has none for stays where it is). */
  const openCast = (i: number) => {
    zone.set("cast");
    castAt.set(i);
    const id = cast()[i]?.person;
    if (id) openPerson(id);
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
        left: () => stepAction(-1),
        right: () => stepAction(1),
        // Add to list is above the actions on a TV (a desktop's is in the window bar, ⌘D / Ctrl+D).
        up: () => caps.remote && zone.set("header"),
        down: underHero,
        enter: () => run[heroRow()[actionAt()]](),
      },
      releases: {
        up: () => releaseAt.set(Math.max(releaseAt() - 1, 0)),
        down: () => releaseAt.set(Math.min(releaseAt() + 1, releaseRows() - 1)),
        enter: () => pressRelease(releaseAt()),
      },
      save: {
        up: () => saveAt.set(Math.max(saveAt() - 1, 0)),
        down: () => saveAt.set(Math.min(saveAt() + 1, saveRows() - 1)),
        left: () => saveSeason.set(Math.max(saveSeason() - 1, 1)),
        right: () => saveSeason.set(Math.min(saveSeason() + 1, seasonCount())),
        enter: () => saveRow(saveAt()),
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
        enter: () => playEpisode(eps()[item()]),
      },
      cast: {
        left: () => castAt.set(clamp(castAt() - 1, cast().length - 1)),
        right: () => castAt.set(clamp(castAt() + 1, cast().length - 1)),
        up: () => above("cast"),
        down: () => below("cast"),
        enter: () => openCast(clamp(castAt(), cast().length - 1)),
      },
      similar: {
        left: () => similarAt.set(clamp(similarAt() - 1, similar().length - 1)),
        right: () => similarAt.set(clamp(similarAt() + 1, similar().length - 1)),
        up: () => above("similar"),
        enter: () => openSimilar(clamp(similarAt(), similar().length - 1)),
      },
    },
    // Back closes the release panel or the Save drawer first.
    () => (panelOpen() && (closePanel(), true)) || (zone() === "save" && (zone.set("actions"), true)),
  );

  const listFocus = () => (zone() === "list" ? item() : null);

  return (
    <View style={{ flex: 1 }}>
    <PageFrame
      ctl={page}
      kind="title"
      bottom={40}
      hero={isShow() ? 640 : 700}
      // Add to list: the frame puts it (a desktop's window bar and a tablet's top row carry their own).
      action={(plain) => <ListToggle inList={() => data().inList} focused={() => zone() === "header"} onPress={toggle} plain={plain} />}
      // A phone's bar shows the name once the page has scrolled past the hero.
      barTitle={() => titleText(data())}
    >
      <View ref={page.follow(() => zone() === "header" || zone() === "actions", "start")}>
        <TitleHero
          data={data}
          focused={focusedAction}
          onPlay={run.play}
          onTrailer={run.trailer}
          onSave={run.save}
          onReleases={() => {
            action.set("releases");
            openPanel();
          }}
        />
      </View>
      <If when={isShow()}>
        <SeriesEpisodes
          data={data}
          episodes={eps}
          season={season}
          tabsFocused={() => zone() === "tabs"}
          focusedAt={listFocus}
          follow={page.follow}
          page={page}
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
            page={page}
            focusedAt={() => (zone() === "cast" ? castAt() : null)}
            onOpen={openCast}
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
          <LazyBlock page={page} height={() => wideCardHeight(shelfCardWidth()) + u(160)}>
          <SimilarShelf
            items={similar}
            page={page}
            focusedAt={() => (zone() === "similar" ? similarAt() : null)}
            onOpen={openSimilar}
          />
          </LazyBlock>
        </If>
      </View>
    </PageFrame>
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
    <ConfirmDialog ask={noSpace} onClose={() => noSpace.set(null)} />
    <If when={isShow()}>
      <SaveDrawer
        open={() => zone() === "save"}
        onClose={() => zone.set("actions")}
        seasons={seasonsForSave}
        season={saveSeason}
        onSeason={(n) => saveSeason.set(n)}
        plan={plan}
        picked={picked}
        onToggle={togglePick}
        onWhole={toggleWhole}
        focusedAt={() => (zone() === "save" ? saveAt() : null)}
        onSave={doSave}
      />
    </If>
    </View>
  );
}
