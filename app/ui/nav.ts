// Where the viewer is: a stack of screens (design/navigation.md, "History
// model"). The nav's destinations are roots; a title or About opens on top;
// Back closes what is open on the page first (`onBack`), then goes one level
// up. On a phone and a tablet each tab keeps its own stack.
import { cleanup, signal } from "nsh";

export type Destination = "home" | "movies" | "shows" | "anime" | "search" | "settings";
export type Route = { name: Destination } | { name: "title"; id: string } | { name: "about" };

/** The nav's destinations: a page with nothing under it. */
export const ROOTS: Destination[] = ["home", "movies", "shows", "anime", "search", "settings"];
export const isRoot = (name: string) => ROOTS.includes(name as Destination);

export const stack = signal<Route[]>([{ name: "home" }]);
export const route = () => stack()[stack().length - 1];

/** The destination the page belongs to (the nav shows it selected): the first
 * route of its stack; About belongs to Settings. */
export function section(): Destination {
  const first = stack()[0].name;
  return first === "about" ? "settings" : first === "title" ? "home" : first;
}

/** Whether there is a page under this one. */
export const canGoBack = () => stack().length > 1;

/** One stack per tab (phone, tablet): switching tabs keeps each tab's place,
 * and Settings opens on top of the current tab. Off on a TV and a desktop,
 * where a destination starts the stack over. Set once at startup. */
let tabStacks = false;
const kept = new Map<Destination, Route[]>();
export function useTabStacks(on: boolean) {
  tabStacks = on;
  kept.clear();
}

/** Bumped when the current destination is chosen again: its page scrolls to
 * the top (`layout/Screen`). */
export const toTop = signal(0);

/** The current destination chosen again: back to its root, at the top. */
export function reselect(name: Destination) {
  stack.set([{ name }]);
  toTop.set(toTop() + 1);
}

/** Opens a nav destination: its own stack (a tab's kept one, or a new one);
 * the current one chosen again goes back to its root. */
export function go(name: Destination) {
  if (section() === name) return reselect(name);
  if (tabStacks) {
    kept.set(section(), stack());
    stack.set(kept.get(name) ?? [{ name }]);
  } else stack.set([{ name }]);
}

const push = (r: Route) => stack.set([...stack(), r]);
export const openTitle = (id: string) => push({ name: "title", id });
/** About reel and its data sources, over Settings. */
export const openAbout = () => push({ name: "about" });
/** Settings: a destination of its own, or (with tab stacks) on top of the current tab. */
export function openSettings() {
  if (!tabStacks) return go("settings");
  if (route().name !== "settings") push({ name: "settings" });
}

/** One level up; from a destination other than Home, to Home. */
export function back() {
  const s = stack();
  if (s.length > 1) stack.set(s.slice(0, -1));
  else if (s[0].name !== "home") go("home");
}

/** What Back closes before it leaves the page, newest first: a closer returns
 * true when it closed something (a keyboard, a panel, a card, the player's
 * controls) or handled Back itself (the player leaving, a root's own rule). */
type Closer = () => boolean;
const closers: Closer[] = [];

/** Lets `fn` take Back while the component that calls it is shown. */
export function onBack(fn: Closer) {
  closers.push(fn);
  cleanup(() => {
    const at = closers.lastIndexOf(fn);
    if (at >= 0) closers.splice(at, 1);
  });
}

/** Back, from any key or button: the newest closer that takes it, else one level up. */
export function handleBack() {
  for (let i = closers.length - 1; i >= 0; i--) if (closers[i]()) return;
  back();
}
