// Where the viewer is: a stack of screens. The nav's destinations replace
// the stack; a title opens on top of it; Back goes one level up.
import { signal } from "nsh";

export type Destination = "home" | "movies" | "shows" | "anime" | "search" | "settings";
export type Route = { name: Destination } | { name: "title"; id: string } | { name: "about" };

export const stack = signal<Route[]>([{ name: "home" }]);
export const route = () => stack()[stack().length - 1];

/** Opens a nav destination (the stack starts over from it). */
export const go = (name: Destination) => stack.set([{ name }]);
export const openTitle = (id: string) => stack.set([...stack(), { name: "title", id }]);
/** About reel and its data sources, over Settings. */
export const openAbout = () => stack.set([...stack(), { name: "about" }]);

/** One level up; from a destination other than Home, to Home. */
export function back() {
  const s = stack();
  if (s.length > 1) stack.set(s.slice(0, -1));
  else if (s[0].name !== "home") go("home");
}
