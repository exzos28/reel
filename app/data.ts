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
  /** Download progress 0..1 for the "Downloading" shelf. */
  downloaded?: number;
}

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
  { id: "metropolis", year: 1927, minutes: 153, ink: "#1B1B1B", paper: "#D9B44A", stoppedAt: 4360 },
  { id: "nosferatu", year: 1922, minutes: 94, ink: "#E8E0CF", paper: "#3B4A3F", stoppedAt: 1520 },
  { id: "general", year: 1926, minutes: 78, ink: "#2A1E14", paper: "#C9A27A", stoppedAt: 610 },
  { id: "sherlock", year: 1924, minutes: 45, ink: "#F2EDE4", paper: "#7A2E2E" },
  { id: "detour", year: 1945, minutes: 68, ink: "#F0D9A8", paper: "#22313F" },
  { id: "charade", year: 1963, minutes: 113, ink: "#1F1A17", paper: "#E4A0A8", downloaded: 0.34 },
  { id: "friday", year: 1940, minutes: 92, ink: "#F3EEE2", paper: "#2F4858", downloaded: 0.81 },
  { id: "night", year: 1968, minutes: 96, ink: "#D8D4CC", paper: "#151515", downloaded: 0.07 },
];

export interface Shelf {
  /** Also the translation key `shelf.<id>`. */
  id: string;
  items: Film[];
}

export const shelves: Shelf[] = [
  { id: "continue", items: films.filter((f) => f.stoppedAt != null) },
  { id: "downloading", items: films.filter((f) => f.downloaded != null) },
  { id: "silent", items: films.filter((f) => f.year < 1930) },
];
