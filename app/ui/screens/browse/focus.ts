// Movies' and Shows' focus, one per page, kept while other screens show:
// the nav, the trending row or the grid (a cell index across its rows).
import { signal } from "nsh";

export type Page = "movies" | "shows";
export type Zone = "nav" | "trending" | "grid";

const pageFocus = (navAt: number) => ({ zone: signal<Zone>("trending"), nav: signal(navAt), trend: signal(0), cell: signal(0) });

export const focusOf = {
  movies: pageFocus(1),
  shows: pageFocus(2),
};
