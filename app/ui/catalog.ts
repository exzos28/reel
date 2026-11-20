// The catalog comes from the Rust core (`Catalog.*`: TMDB and AniList
// titles through the metadata layer, releases from the user's search
// source, watch progress); this file only types it and words it (titles
// and about come from the core in the app's language; UI text lives in
// locales/ under the keys the core names).
import { signal } from "nsh";
import { t } from "nsh/i18n";
import { Catalog, Fmt } from "./native";
import { hostedUrl } from "./hosted";

/** What Play starts for a title: a film, or an episode of a show (id
 * `<show>:s<season>e<episode>`). `start`: where the viewer stopped, seconds. */
export interface PlayTarget {
  id: string;
  season?: number;
  episode?: number;
  start?: number;
}

export interface ReleaseLine {
  quality: string;
  source: string;
  /** A show's season pack. */
  pack: boolean;
  size: string;
  peers: number;
  /** Starts in seconds. */
  fast: boolean;
}

/** A score with its source, in the source's own scale: TMDB "8.0", AniList
 * "85%", MAL "8.54"; `votes` "4.8K" (empty when unknown). */
export interface Score {
  source: "tmdb" | "anilist" | "mal";
  value: string;
  votes: string;
}

/** A title as cards, shelves and heroes show it. Ids are the metadata
 * ones ("tmdb:movie:603", "tmdb:tv:1399", "anilist:21"). */
export interface Summary {
  id: string;
  kind: "movie" | "short" | "show";
  /** The title and its overview, in the app's language when the source has it. */
  title: string;
  about: string;
  /** The about cut at a sentence's end for a hero's few lines (the core's). */
  aboutShort: string;
  /** A stand-in card that says something instead (key under `empty.*`):
   * "no_tmdb", "loading", "offline", "unavailable". */
  notice: string | null;
  anime: boolean;
  year: number | null;
  yearEnd: number | null;
  minutes: number;
  rating: string;
  votes: string;
  /** Every score with its source (the hero labels them). */
  ratings: Score[];
  /** The age rating for the viewer's region ("R", "TV-14"), null when none. */
  certification: string | null;
  /** Keys under `badge.*`; genre names as the source words them. */
  badges: string[];
  genres: string[];
  /** Image URLs, null when there is none (the typographic fallback shows). */
  still: string | null;
  card: string | null;
  poster: string | null;
  /** The two colours of its typographic fallback. */
  ink: string;
  paper: string;
  stoppedAt: number | null;
  /** Watched part, 0..1, and minutes left (null: not started). */
  progress: number;
  left: number | null;
  resume: { season: number; episode: number } | null;
  seasons: number;
  airs: { season: number; episode: number; month: number; day: number } | null;
  /** Key under `tag.*`. */
  tag: string | null;
  playable: boolean;
  inList: boolean;
  release: ReleaseLine | null;
  play: PlayTarget;
  /** What Play says, as the core decides it: "resume" at `at` seconds, or "play" from the start
   * (`at` null); a show's names the episode (`season`, `episode`), a film's does not. */
  playAs: { verb: "play" | "resume"; season: number | null; episode: number | null; at: number | null };
}

export interface Release {
  index: number;
  quality: string;
  source: string;
  group: string;
  /** Where it comes from without HDR ("BluRay"): the releases sheet's first line. */
  origin: string;
  size: string;
  /** The second line ("English, Russian MVO · H.264 · 700 MB"), as the core orders it. */
  line: ReleasePart[];
  /** All of the row for a screen reader. */
  spoken: ReleasePart[];
  peers: number;
  /** Key under `release.note.*`. */
  note: string;
  mbit: number;
  selected: boolean;
  /** A season pack. */
  pack: boolean;
  indexer: string | null;
  /** In the short list (the most shared of its quality, or the one Play uses). */
  top: boolean;
}

/** An audio language a release's name says: `language` ISO 639-1 (null when only the voice is
 * told), `voice` a key under `release.voice.*` (a dub, a voice-over) or null. */
export interface AudioLanguage {
  language: string | null;
  voice: string | null;
}

/** A part of a release's line: text as it is, its audio languages, or a key with its values. */
export type ReleasePart = { text: string } | { audio: AudioLanguage[] } | ({ key: string } & Record<string, string | number>);

/** Where the search for releases is (key under `releases.state.*` except "done"). */
export type ReleasesState = "no_source" | "searching" | "failed" | "done" | "none";

export interface CastMember {
  name: string;
  character: string | null;
  /** A w185 photo, null when there is none (the initials show). */
  photo: string | null;
  initials: string;
  /** Their page's id (`person`), null when reel has none for them (not pressable). */
  person: string | null;
}

/** A person's page: the titles they are in, best known first. `state` "loading": not known yet
 * (no name, no titles); "unavailable": the source did not answer. */
export interface PersonPage {
  id: string;
  name: string;
  photo: string | null;
  initials: string;
  items: Summary[];
  state: "done" | "loading" | "unavailable";
}

/** A crew group: `job` a key under `crew.*` ("director", "writer", "novel",
 * "music", "creator"). */
export interface CrewGroup {
  job: string;
  names: string[];
}

export interface Title extends Summary {
  releases: Release[];
  releasesState: ReleasesState;
  season?: number;
  /** `year` is null when neither the season nor its episodes say it. */
  seasonList?: { number: number; year: number | null; episodes: number; name: string | null }[];
  /** The overview is longer than the hero's three lines: shown whole below. */
  aboutFull: boolean;
  cast: CastMember[];
  crew: CrewGroup[];
  tagline: string | null;
  /** Only when it differs from `title`. */
  originalTitle: string | null;
  releaseDate: [number, number, number] | null;
  /** Country names, studio names. */
  countries: string[];
  studios: string[];
  /** A series' status, a key under `status.*`. */
  status: string | null;
  /** A trailer's web page (a YouTube watch URL), or null. */
  trailer: string | null;
  /** More like this. */
  similar: Summary[];
}

export interface Episode {
  id: string;
  show: string;
  season: number;
  number: number;
  title: string;
  about: string;
  minutes: number;
  date: [number, number, number] | null;
  rating: string;
  thumb: string | null;
  /** The thumbnail's watched bar, 0..1 (the core shows a little of what is started). */
  progress: number;
  /** What follows the runtime in its row: the minutes left once started, else its air date. */
  note: { left: number } | { date: [number, number, number] } | null;
  watched: boolean;
  /** Where the viewer stopped, seconds (0: from the start). */
  start: number;
  quality: string | null;
  /** Whether its season's release holds it: "yes", "unknown" (its name does
   * not say), "no" (pick another), "own" (a release picked for it); null while
   * the season is searched. */
  inRelease: "yes" | "unknown" | "no" | "own" | null;
  /** Not aired yet (`date` is when it airs): it does not play. */
  upcoming?: boolean;
  playable: boolean;
}

/** One episode's releases, to pick one when its season's does not hold it. */
export interface EpisodeReleases {
  releases: Release[];
  releasesState: ReleasesState;
  /** The season's release, the one it is not in. */
  seasonRelease: ReleaseLine | null;
}

export interface Shelf {
  /** Also the translation key `shelf.<id>`. */
  id: string;
  items: Summary[];
}

/** Bumped when the core's catalog changes (data arrived, a search finished,
 * the list, a chosen release, progress), so what reads the catalog reads it
 * again. The core counts its changes in `Catalog.revision()`; `Catalog.changed(seen)`
 * answers the moment it goes past `seen`, so new data shows at once. */
const version = signal(0);
let seen = -1;
const saw = (r: number) => {
  if (r !== seen) {
    seen = r;
    version.set(version() + 1);
  }
};
saw(Number(Catalog.revision()));
async function watch() {
  for (;;) {
    try {
      saw(Number(await Catalog.changed(seen)));
    } catch {
      // A core without `changed` (tests' stand-ins): ask once a second instead.
      await new Promise((r) => setTimeout(r, 1000));
      saw(Number(Catalog.revision()));
    }
  }
}
void watch();
/** The last answer of each call: when the core answers the same JSON again
 * (most revisions change something elsewhere), the same object comes back,
 * so nothing that shows it updates. */
const last = new Map<string, { raw: string; value: unknown }>();
const read = <T>(key: string, json: () => string): T => {
  version();
  const raw = json();
  const before = last.get(key);
  if (before && before.raw === raw) return before.value as T;
  const value = JSON.parse(raw) as T;
  last.set(key, { raw, value });
  return value;
};

/** Home: the hero (the title watched last, else the first card) and the shelves, which do not
 * show the hero again (the core's). */
export interface Home {
  hero: Summary;
  shelves: Shelf[];
}

export const home = () => read<Home>("home", () => Catalog.home());
/** A row of a filter panel: `name` when the source names it (a genre, a
 * country), else `key` under `browse.option.*` with its number `n`. */
export interface FilterOption {
  id: string;
  name: string | null;
  key: string | null;
  n: number | null;
  selected: boolean;
}

/** A filter of a browse page and its panel; `id` is also the key under
 * `browse.filter.*`. `multi`: OK toggles; `clear`: the panel has a Clear row. */
export interface FilterGroup {
  id: "genres" | "years" | "countries" | "sort";
  multi: boolean;
  clear: boolean;
  options: FilterOption[];
}

export interface Browse {
  trending: Summary[];
  /** The catalog through the page's filters. */
  all: Summary[];
  filters: FilterGroup[];
  /** "loading": a new filter's grid is on its way (`all` is the last one). */
  allState: "done" | "loading" | "empty" | "offline";
  /** The source has more after `all` (`browseMore` asks for the next page). */
  more: boolean;
  /** The next page: "loading" on its way, "failed" (asking again retries). */
  moreState: "idle" | "loading" | "failed";
}

export type BrowsePage = "movies" | "shows" | "cartoons" | "anime";

export const browse = (page: BrowsePage) => read<Browse>(`browse:${page}`, () => Catalog.browse(page));
export const title = (id: string) => read<Title | null>(`title:${id}`, () => Catalog.title(id));
export const episodes = (show: string, season: number) =>
  read<Episode[]>(`episodes:${show}:${season}`, () => Catalog.episodes(show, season));

export const person = (id: string) => read<PersonPage>(`person:${id}`, () => Catalog.person(id));

export const episodeReleases = (key: string) =>
  read<EpisodeReleases>(`episodeReleases:${key}`, () => Catalog.episodeReleases(key));

/** The search screen, as the core answers a query (it asks once the query
 * rests; `revision` brings the answer). */
export interface SearchAnswer {
  query: string;
  /** "recent": nothing typed (`recent` lists the last searches); "searching":
   * `sections` still hold the previous query's results; "done": `sections`
   * empty means nothing found; "failed": the sources did not answer. */
  state: "recent" | "searching" | "done" | "failed";
  /** Films and shows are searched (a TMDB key); without one only anime is. */
  tmdb: boolean;
  recent: string[];
  /** `id` is also the translation key `search.section.<id>`. `state` "failed":
   * the row's source did not answer (no items); `retrySearch` asks again. */
  sections: { id: "movies" | "shows" | "anime"; state: "done" | "failed"; items: Summary[] }[];
}

export const search = (query: string) => read<SearchAnswer>("search", () => Catalog.search(query));
/** Asks `query` again (a row that did not load). */
export const retrySearch = (query: string) => Catalog.retrySearch(query);
/** Keeps `query` among the recent searches. */
export const rememberSearch = (query: string) => Catalog.rememberSearch(query);
/** Clears the recent searches. */
export const forgetSearches = () => Catalog.forgetSearches();

export function toggleList(id: string) {
  Catalog.toggleList(id);
  version.set(version() + 1);
}
/** Asks the core for the next page of a browse grid; `changed` brings it. */
export function browseMore(page: BrowsePage) {
  if (Catalog.browseMore(page)) version.set(version() + 1);
}
/** One choice in a filter panel (`id` empty: clear the group). */
export function chooseFilter(page: BrowsePage, group: string, id: string) {
  if (Catalog.chooseFilter(page, group, id)) version.set(version() + 1);
}
export function chooseRelease(id: string, index: number) {
  Catalog.chooseRelease(id, index);
  version.set(version() + 1);
}

// ---- Words.

type Named = Pick<Summary, "title" | "about" | "notice">;

/** The title's name (a notice card: what it says). */
export const titleText = (s: Named) => (s.notice ? t(`empty.${s.notice}.title`) : s.title);
export const aboutText = (s: Named) => (s.notice ? t(`empty.${s.notice}.about`) : s.about);
/** A hero's few lines of the about: whole sentences, not a cut mid-word. */
export const shortAboutText = (s: Summary) => (s.notice ? t(`empty.${s.notice}.about`) : s.aboutShort);
export const genresText = (s: Summary) => s.genres.join(", ");
export const badgeText = (b: string) => t(`badge.${b}`);

/** Runtime in the app's language: "2 h 33 min", "48 min" (Rust splits, the UI words it). */
export function runtime(minutes: number) {
  const [h, m] = Fmt.hoursMinutes(minutes);
  if (h === 0) return t("fmt.minutes", { m });
  if (m === 0) return t("fmt.hours", { h });
  return t("fmt.hours_minutes", { h, m });
}

export const episodeCode = (season: number, episode: number) => t("fmt.episode", { season, episode });

/** "1963" or "1936–1940" (empty when unknown). */
export const yearsText = (s: Summary) =>
  s.year == null ? "" : s.yearEnd ? t("fmt.years", { from: s.year, to: s.yearEnd }) : String(s.year);

/** "Movie", "Short", "3 Seasons" ("Show" while the seasons are not known). */
export function kindText(s: Summary) {
  if (s.kind !== "show") return t(`kind.${s.kind}`);
  if (!s.seasons) return t("kind.show");
  return s.seasons === 1 ? t("kind.season_one") : t("kind.seasons", { count: s.seasons });
}

/** Runtime of a film, seasons of a show. */
export const lengthText = (s: Summary) => (s.kind === "show" ? kindText(s) : s.minutes ? runtime(s.minutes) : "");

/** Under a card: "★ 7.9 · 1963 · Movie" without the star (drawn red, `CardMeta`), what is not
 * known left out ("1963 · Movie"). */
export const cardMeta = (s: Summary) => [s.rating, s.year == null ? "" : String(s.year), kindText(s)].filter((x) => x).join(" · ");

/** Under a Continue watching card: "1 h 12 min left", "S3:E4 · 7 min left". */
export function leftText(s: Summary) {
  if (s.left == null) return cardMeta(s);
  const left = t("card.left", { time: runtime(s.left) });
  return s.resume ? `${episodeCode(s.resume.season, s.resume.episode)} · ${left}` : left;
}

/** Under a show's poster: "S3:E5 · Nov 20". */
export const airsText = (s: Summary) =>
  s.airs ? `${episodeCode(s.airs.season, s.airs.episode)} · ${t("fmt.day", { month: t(`month.${s.airs.month}`), day: s.airs.day })}` : cardMeta(s);

/** What Play says (the core's `playAs`): "Play", "Resume 41:12", "Play S1:E1", "Resume S2:E3 · 14:30". */
export function playLabel(s: Summary) {
  const p = s.playAs;
  const episode = p.season != null && p.episode != null ? episodeCode(p.season, p.episode) : null;
  const at = p.at != null ? Fmt.position(p.at) : null;
  if (at != null) return episode ? t("title.resume_episode", { episode, at }) : t("title.resume", { at });
  return episode ? t("title.play_episode", { episode }) : t("title.play");
}

/** What an episode's row says after its runtime: "23 min left", else its air date. */
export const episodeNote = (e: Episode) =>
  !e.note ? "" : "left" in e.note ? t("card.left", { time: runtime(e.note.left) }) : dateText(e.note.date);

export const dateText = (date: [number, number, number] | null) =>
  date ? t("fmt.date", { month: t(`month.${date[1]}`), day: date[2], year: date[0] }) : "";

/** "Nov 20": a date without its year (an episode that airs soon). */
export const shortDate = (date: [number, number, number] | null) =>
  date ? t("fmt.month_day", { month: t(`month.${date[1]}`), day: date[2] }) : "";

/** The release line: its name (bold) and the rest; `spoken`, the whole line in words. For the
 * short form (the number of people sharing with a person icon): `size`, `peers` (the number
 * alone) and `fast` (with `withStart`: how fast it starts, or null). */
export function releaseLine(r: ReleaseLine, withStart = true) {
  const sharing = t("release.sharing", { count: r.peers });
  const size = r.pack ? t("release.pack", { size: r.size }) : r.size;
  const fast = withStart && r.fast ? [t("release.fast")] : [];
  const rest = [size, sharing, ...fast];
  const name = `${r.quality} ${r.source}`;
  const restText = rest.join(" · ");
  return { name, rest: restText, spoken: `${name} · ${restText}`, size, peers: `${r.peers}`, fast: fast[0] ?? null };
}

/** A filter panel's row: "Drama", "2010s", "Before 1960", "Top rated". */
export const optionText = (o: FilterOption) => o.name ?? t(`browse.option.${o.key}`, { n: o.n ?? 0 });

/** What a filter pill says: its name until something is picked, then the
 * pick ("2010s", "France"); genres keep the name ("Genres: Drama, Crime").
 * The order's pill is worded by `FilterBar` (two weights). */
export function filterText(g: FilterGroup) {
  const picked = g.options.filter((o) => o.selected).map(optionText);
  const name = t(`browse.filter.${g.id}`);
  if (picked.length === 0) return name;
  return g.multi ? t("browse.filter.picked", { filter: name, picked: picked.join(", ") }) : picked.join(", ");
}

/** The picked order's name ("Most popular"). */
export function sortText(g: FilterGroup) {
  const o = g.options.find((x) => x.selected);
  return o ? optionText(o) : "";
}

/** A score's source: "TMDB", "AniList", "MAL". */
export const scoreSource = (s: Score) => t(`score.${s.source}`);
/** "4.8K votes" (empty when unknown). */
export const votesText = (s: Score) => (s.votes ? t("score.votes", { votes: s.votes }) : "");

/** A crew group's label: "Director", "Writers", "Created by". */
export const crewLabel = (g: CrewGroup) => t(`crew.${g.job}.${g.names.length === 1 ? "one" : "other"}`);
export const namesText = (names: string[]) => names.join(", ");

export const statusText = (status: string) => t(`status.${status}`);

/** "Russian MVO", "English", "MVO". */
function audioText(a: AudioLanguage) {
  const voice = a.voice ? t(`release.voice.${a.voice}`) : "";
  if (!a.language) return voice;
  const language = t(`languages.${a.language}`);
  return voice ? t("release.voiced", { language, voice }) : language;
}

function partText(p: ReleasePart): string {
  if ("audio" in p) return (p.audio as AudioLanguage[]).map(audioText).join(", ");
  if ("text" in p) return p.text as string;
  return t(p.key as string, p);
}

/** A release row's second line: "English, Russian MVO · H.264 · 700 MB". */
export const releaseDetails = (r: Release) => r.line.map(partText).join(" · ");

/** A release row as a screen reader says it. */
export const releaseSpoken = (r: Release) => r.spoken.map(partText).join(", ");

/** An episode's name or overview, from the core (empty while its season is not known). */
export function episodeText(show: string, season: number, episode: number, field: "title" | "about") {
  const e = read<Episode | null>(`episode:${show}:${season}:${episode}`, () => Catalog.episode(show, season, episode));
  return e ? e[field] : "";
}

/** The line over the release list: how many, or why there are none. */
export function releasesText(s: Title) {
  if (s.releasesState === "done" || s.releasesState === "none")
    return s.releases.length ? t("releases.found", { count: s.releases.length }) : t("releases.state.none");
  // Where the TV serves the settings page, the address to set the source from a phone.
  const url = hostedUrl();
  if (s.releasesState === "no_source" && url) return t("releases.state.no_source_hosted", { url });
  return t(`releases.state.${s.releasesState}`);
}

/** A season tab's line: "22 episodes · Season 3 name". */
export function seasonText(s: { episodes: number; name: string | null }) {
  const count = t("series.episodes", { count: s.episodes });
  return s.name ? `${count} · ${s.name}` : count;
}
