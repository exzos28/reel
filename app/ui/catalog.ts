// The catalog comes from the Rust core (`Catalog.*`: TMDB and AniList
// titles through the metadata layer, releases from the user's search
// source, watch progress); this file only types it and words it (titles
// and about come from the core in the app's language; UI text lives in
// locales/ under the keys the core names).
import { signal } from "nsh";
import { t } from "nsh/i18n";
import { Catalog, Fmt } from "app/native";

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
}

export interface Release {
  index: number;
  quality: string;
  source: string;
  group: string;
  size: string;
  /** Keys under `tracks.*`. */
  tracks: string[];
  peers: number;
  /** Signal bars, 1..4. */
  bars: number;
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

/** Where the search for releases is (key under `releases.state.*` except "done"). */
export type ReleasesState = "no_source" | "searching" | "failed" | "done" | "none";

export interface CastMember {
  name: string;
  character: string | null;
  /** A w185 photo, null when there is none (the initials show). */
  photo: string | null;
  initials: string;
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
  seasonList?: { number: number; year: number; episodes: number; name: string | null }[];
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
  progress: number;
  left: number | null;
  watched: boolean;
  /** Where the viewer stopped, seconds (0: from the start). */
  start: number;
  quality: string | null;
  playable: boolean;
}

export interface Shelf {
  /** Also the translation key `shelf.<id>`. */
  id: string;
  items: Summary[];
}

/** Bumped when the core's catalog changes (data arrived, a search finished,
 * the list, a chosen release, progress), so what reads the catalog reads it
 * again. The core counts its changes in `Catalog.revision()`; asked each second. */
const version = signal(0);
let seen = -1;
const check = () => {
  const r = Number(Catalog.revision());
  if (r !== seen) {
    seen = r;
    version.set(version() + 1);
  }
};
setInterval(check, 1000);
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

export const home = () => read<Shelf[]>("home", () => Catalog.home());
export const browse = (page: "movies" | "shows" | "anime") =>
  read<{ trending: Summary[]; all: Summary[] }>(`browse:${page}`, () => Catalog.browse(page));
export const title = (id: string) => read<Title | null>(`title:${id}`, () => Catalog.title(id));
export const episodes = (show: string, season: number) =>
  read<Episode[]>(`episodes:${show}:${season}`, () => Catalog.episodes(show, season));

export function toggleList(id: string) {
  Catalog.toggleList(id);
  version.set(version() + 1);
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

/** Under a card: "★ 7.9 · 1963 · Movie" without the star (drawn red). */
export const cardMeta = (s: Summary) => t("card.meta", { rating: s.rating, year: s.year ?? "", kind: kindText(s) });

/** Under a Continue watching card: "1 h 12 min left", "S3:E4 · 7 min left". */
export function leftText(s: Summary) {
  if (s.left == null) return cardMeta(s);
  const left = t("card.left", { time: runtime(s.left) });
  return s.resume ? `${episodeCode(s.resume.season, s.resume.episode)} · ${left}` : left;
}

/** Under a show's poster: "S3:E5 · Nov 20". */
export const airsText = (s: Summary) =>
  s.airs ? `${episodeCode(s.airs.season, s.airs.episode)} · ${t("fmt.day", { month: t(`month.${s.airs.month}`), day: s.airs.day })}` : cardMeta(s);

/** What Play says: "Play", "Resume 41:12", "Resume S3:E4". */
export function playLabel(s: Summary) {
  if (s.resume) return t("title.resume", { at: episodeCode(s.resume.season, s.resume.episode) });
  if (s.stoppedAt != null) return t("title.resume", { at: Fmt.position(s.stoppedAt) });
  return t("title.play");
}

export const dateText = (date: [number, number, number] | null) =>
  date ? t("fmt.date", { month: t(`month.${date[1]}`), day: date[2], year: date[0] }) : "";

/** The release line: its name (bold) and the rest. */
export function releaseLine(r: ReleaseLine, withStart = true) {
  const sharing = t("release.sharing", { count: r.peers });
  const size = r.pack ? t("release.pack", { size: r.size }) : r.size;
  const rest = [size, sharing, ...(withStart && r.fast ? [t("release.fast")] : [])];
  return { name: `${r.quality} ${r.source}`, rest: rest.join(" · ") };
}

/** A score's source: "TMDB", "AniList", "MAL". */
export const scoreSource = (s: Score) => t(`score.${s.source}`);
/** "4.8K votes" (empty when unknown). */
export const votesText = (s: Score) => (s.votes ? t("score.votes", { votes: s.votes }) : "");

/** A crew group's label: "Director", "Writers", "Created by". */
export const crewLabel = (g: CrewGroup) => t(`crew.${g.job}.${g.names.length === 1 ? "one" : "other"}`);
export const namesText = (names: string[]) => names.join(", ");

export const statusText = (status: string) => t(`status.${status}`);

export const tracksText = (r: Release) => r.tracks.map((k) => t(`tracks.${k}`)).join(", ");
export const noteText = (r: Release) => t(`release.note.${r.note}`, { mbit: r.mbit });

/** An episode's name or overview, from the core (empty while its season is not known). */
export function episodeText(show: string, season: number, episode: number, field: "title" | "about") {
  const e = read<Episode | null>(`episode:${show}:${season}:${episode}`, () => Catalog.episode(show, season, episode));
  return e ? e[field] : "";
}

/** The line over the release list: how many, or why there are none. */
export function releasesText(s: Title) {
  if (s.releasesState === "done" || s.releasesState === "none")
    return s.releases.length ? t("releases.found", { count: s.releases.length }) : t("releases.state.none");
  return t(`releases.state.${s.releasesState}`);
}

/** A season tab's line: "22 episodes · Season 3 name". */
export function seasonText(s: { episodes: number; name: string | null }) {
  const count = t("series.episodes", { count: s.episodes });
  return s.name ? `${count} · ${s.name}` : count;
}
