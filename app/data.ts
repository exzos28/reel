// Demo catalog: public-domain films, so screenshots can be shared.
// Text (title, director, about) lives in locales/ under `films.<id>.*`.
// `ink` / `paper` are the two colors of each film's typographic poster.
import { t } from "nsh/i18n";

export interface Film {
  id: string;
  year: number;
  minutes: number;
  ink: string;
  paper: string;
  /** Where the viewer stopped, seconds; absent if not started. */
  stoppedAt?: number;
  /** A magnet link the engine can play; demo films without one show "no source". */
  magnet?: string;
}

/** Open films with official torrents (Blender Foundation, CC BY), used to try the engine. */
const SINTEL = "magnet:?xt=urn:btih:08ada5a7a6183aae1e09d831df6748d566095a10&dn=Sintel&tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337&tr=udp%3A%2F%2Fexplodie.org%3A6969&xs=https%3A%2F%2Fwebtorrent.io%2Ftorrents%2Fsintel.torrent";
const BUNNY = "magnet:?xt=urn:btih:dd8255ecdc7ca55fb0bbf81323d87062db1f6d1c&dn=Big+Buck+Bunny&tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337&tr=udp%3A%2F%2Fexplodie.org%3A6969&xs=https%3A%2F%2Fwebtorrent.io%2Ftorrents%2Fbig-buck-bunny.torrent";

/** The film's translated text; call where it is shown so it follows the language. */
export const filmText = (f: Film, field: "title" | "director" | "about") => t(`films.${f.id}.${field}`);

/** Runtime in the app's language: "2 h 33 min", "48 min". Text stays in TS:
 * Rust modules run off the UI thread and cannot read the language. */
export function runtime(minutes: number) {
  const h = Math.floor(minutes / 60), m = minutes % 60;
  if (h === 0) return t("fmt.minutes", { m });
  if (m === 0) return t("fmt.hours", { h });
  return t("fmt.hours_minutes", { h, m });
}

export const films: Film[] = [
  { id: "sintel", year: 2010, minutes: 15, ink: "#F4E9D8", paper: "#5A2A1F", magnet: SINTEL },
  { id: "bunny", year: 2008, minutes: 10, ink: "#2B3A12", paper: "#B8D46A", magnet: BUNNY },
  { id: "metropolis", year: 1927, minutes: 153, ink: "#1B1B1B", paper: "#D9B44A", stoppedAt: 4360 },
  { id: "nosferatu", year: 1922, minutes: 94, ink: "#E8E0CF", paper: "#3B4A3F", stoppedAt: 1520 },
  { id: "general", year: 1926, minutes: 78, ink: "#2A1E14", paper: "#C9A27A", stoppedAt: 610 },
  { id: "sherlock", year: 1924, minutes: 45, ink: "#F2EDE4", paper: "#7A2E2E" },
  { id: "detour", year: 1945, minutes: 68, ink: "#F0D9A8", paper: "#22313F" },
  { id: "charade", year: 1963, minutes: 113, ink: "#1F1A17", paper: "#E4A0A8" },
  { id: "friday", year: 1940, minutes: 92, ink: "#F3EEE2", paper: "#2F4858" },
  { id: "night", year: 1968, minutes: 96, ink: "#D8D4CC", paper: "#151515" },
];

export interface Shelf {
  /** Also the translation key `shelf.<id>`. */
  id: string;
  items: Film[];
}

export const shelves: Shelf[] = [
  { id: "open", items: films.filter((f) => f.magnet != null) },
  { id: "continue", items: films.filter((f) => f.stoppedAt != null) },
  { id: "noir", items: films.filter((f) => ["detour", "friday", "night", "charade"].includes(f.id)) },
  { id: "silent", items: films.filter((f) => f.year < 1930) },
];
