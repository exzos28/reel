// Movies', Shows' and Anime's focus, one per page, kept while other screens show:
// the nav, the trending row, the filter pills, a filter's panel (its row) or
// the grid (a cell index across its rows).
import { signal } from "nsh";

export type Page = "movies" | "shows" | "anime";
export type Zone = "nav" | "trending" | "filters" | "panel" | "grid";

const pageFocus = (navAt: number) => ({
  zone: signal<Zone>("trending"),
  nav: signal(navAt),
  trend: signal(0),
  /** The filter pill (and, while the panel is open, its filter). */
  pill: signal(0),
  /** The panel's row: the Clear row first when it has one. */
  row: signal(0),
  cell: signal(0),
  /** The grid's titles when the focus was last placed in it ("" before). */
  gridIds: signal(""),
});

export const focusOf = {
  movies: pageFocus(1),
  shows: pageFocus(2),
  anime: pageFocus(3),
};
