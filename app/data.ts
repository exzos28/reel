// The catalog comes from the Rust core (`Catalog.shelves`); this file only
// types it and words it (text lives in locales/ under `films.<id>.*`).
import { t } from "nsh/i18n";
import { Catalog, Fmt } from "app/native";

export interface Film {
  id: string;
  year: number;
  minutes: number;
  /** The two colours of its typographic poster. */
  ink: string;
  paper: string;
  /** Where the viewer stopped, seconds; null if not started. */
  stoppedAt: number | null;
  /** The core has a source for it. */
  playable: boolean;
}

export interface Shelf {
  /** Also the translation key `shelf.<id>`. */
  id: string;
  items: Film[];
}

export const shelves: Shelf[] = JSON.parse(Catalog.shelves());

/** The film's translated text; call where it is shown so it follows the language. */
export const filmText = (f: Film, field: "title" | "director" | "about") => t(`films.${f.id}.${field}`);

/** Runtime in the app's language: "2 h 33 min", "48 min" (Rust splits, the UI words it). */
export function runtime(minutes: number) {
  const [h, m] = Fmt.hoursMinutes(minutes);
  if (h === 0) return t("fmt.minutes", { m });
  if (m === 0) return t("fmt.hours", { h });
  return t("fmt.hours_minutes", { h, m });
}
