// Search's state, kept while a title opened from it shows, so Back finds the
// query, its results and the focus where they were: the nav, the field, a
// recent search, or a card on a row (each row remembers its card).
import { signal } from "nsh";
import { rowMemory } from "../../focus/memory";

export type Zone = "nav" | "field" | "recent" | "results";

export const query = signal("");
export const zone = signal<Zone>("field");
/** The nav item the focus is on while it is in the nav. */
export const navAt = signal(4);
export const recentAt = signal(0);
export const row = signal(0);
export const cols = rowMemory();
