// The catalog comes from the Rust core (`Catalog.*`); this file only types
// it and words it (text lives in locales/ under `films.<id>.*`,
// `shows.<id>.*` and the keys the core names).
import { signal } from "nsh";
import { t } from "nsh/i18n";
import { Catalog, Fmt } from "app/native";

/** What Play starts for a title: a film, or an episode of a show. */
export interface PlayTarget {
  id: string;
  season?: number;
  episode?: number;
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

/** A title as cards, shelves and heroes show it. */
export interface Summary {
  id: string;
  kind: "movie" | "short" | "show";
  year: number;
  yearEnd: number | null;
  minutes: number;
  rating: string;
  votes: string;
  /** Keys under `badge.*`, `genre.*`. */
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
}

export interface Title extends Summary {
  releases: Release[];
  season?: number;
  seasonList?: { number: number; year: number; episodes: number }[];
}

export interface Episode {
  id: string;
  show: string;
  season: number;
  number: number;
  minutes: number;
  date: [number, number, number];
  rating: string;
  thumb: string | null;
  progress: number;
  left: number | null;
  watched: boolean;
  quality: string | null;
  playable: boolean;
}

export interface Shelf {
  /** Also the translation key `shelf.<id>`. */
  id: string;
  items: Summary[];
}

/** Bumped when the core's catalog state changes (the list, a chosen
 * release), so what reads the catalog reads it again. */
const version = signal(0);
const read = <T>(json: () => string): T => {
  version();
  return JSON.parse(json());
};

export const home = () => read<Shelf[]>(() => Catalog.home());
export const browse = (page: "movies" | "shows") =>
  read<{ trending: Summary[]; all: Summary[] }>(() => Catalog.browse(page));
export const title = (id: string) => read<Title | null>(() => Catalog.title(id));
export const episodes = (show: string, season: number) => read<Episode[]>(() => Catalog.episodes(show, season));

export function toggleList(id: string) {
  Catalog.toggleList(id);
  version.set(version() + 1);
}
export function chooseRelease(id: string, index: number) {
  Catalog.chooseRelease(id, index);
  version.set(version() + 1);
}

// ---- Words.

const textOf = (s: Pick<Summary, "id" | "kind">, field: string) =>
  t(`${s.kind === "show" ? "shows" : "films"}.${s.id}.${field}`);

/** The title's name in the app's language. */
export const titleText = (s: Pick<Summary, "id" | "kind">) => textOf(s, "title");
export const aboutText = (s: Pick<Summary, "id" | "kind">) => textOf(s, "about");
export const genresText = (s: Summary) => s.genres.map((g) => t(`genre.${g}`)).join(", ");
export const badgeText = (b: string) => t(`badge.${b}`);

/** Runtime in the app's language: "2 h 33 min", "48 min" (Rust splits, the UI words it). */
export function runtime(minutes: number) {
  const [h, m] = Fmt.hoursMinutes(minutes);
  if (h === 0) return t("fmt.minutes", { m });
  if (m === 0) return t("fmt.hours", { h });
  return t("fmt.hours_minutes", { h, m });
}

export const episodeCode = (season: number, episode: number) => t("fmt.episode", { season, episode });

/** "1963" or "1936–1940". */
export const yearsText = (s: Summary) => (s.yearEnd ? t("fmt.years", { from: s.year, to: s.yearEnd }) : String(s.year));

/** "Movie", "Short", "3 Seasons". */
export function kindText(s: Summary) {
  if (s.kind !== "show") return t(`kind.${s.kind}`);
  return s.seasons === 1 ? t("kind.season_one") : t("kind.seasons", { count: s.seasons });
}

/** Runtime of a film, seasons of a show. */
export const lengthText = (s: Summary) => (s.kind === "show" ? kindText(s) : runtime(s.minutes));

/** Under a card: "★ 7.9 · 1963 · Movie" without the star (drawn red). */
export const cardMeta = (s: Summary) => t("card.meta", { rating: s.rating, year: s.year, kind: kindText(s) });

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

export const dateText = ([year, month, day]: [number, number, number]) =>
  t("fmt.date", { month: t(`month.${month}`), day, year });

/** The release line: its name (bold) and the rest. */
export function releaseLine(r: ReleaseLine, withStart = true) {
  const sharing = t("release.sharing", { count: r.peers });
  const size = r.pack ? t("release.pack", { size: r.size }) : r.size;
  const rest = [size, sharing, ...(withStart && r.fast ? [t("release.fast")] : [])];
  return { name: `${r.quality} ${r.source}`, rest: rest.join(" · ") };
}

export const tracksText = (r: Release) => r.tracks.map((k) => t(`tracks.${k}`)).join(", ");
export const noteText = (r: Release) => t(`release.note.${r.note}`, { mbit: r.mbit });

export const episodeText = (show: string, season: number, episode: number, field: "title" | "about") =>
  t(`shows.${show}.s${season}.e${episode}.${field}`);
