// Where the viewer is: a stack of screens (design/navigation.md, "History
// model"). The nav's destinations are roots; a title or About opens on top;
// Back closes what is open on the page first (`onBack`), then goes one level
// up. On a phone and a tablet each tab keeps its own stack.
import { cleanup, signal } from "nsh";

export type Destination = "home" | "movies" | "shows" | "cartoons" | "anime" | "search" | "settings" | "saved";
export type Route = { name: Destination } | { name: "title"; id: string } | { name: "about" };

/** The nav's destinations: a page with nothing under it. */
export const ROOTS: Destination[] = ["home", "movies", "shows", "cartoons", "anime", "search", "settings", "saved"];
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
  // The root's own route, not a new one: a native stack takes a new route for a new page and
  // pushed a second Home over Home.
  const root = stack()[0];
  stack.set([root && root.name === name ? root : { name }]);
  toTop.set(toTop() + 1);
}

/** Opens a nav destination: its own stack (a tab's kept one, or a new one);
 * the current one chosen again goes back to its root. */
/** The destination just chosen in the nav with the keys: it opens with the focus
 * still in the nav, on its item (not where its page was left). */
let chosenInNav: Destination | null = null;

export function goFromNav(name: Destination) {
  chosenInNav = name;
  go(name);
}

/** Whether the page now showing was just chosen in the nav (asked once). */
export function takeChosenInNav(name: Destination): boolean {
  const was = chosenInNav === name;
  chosenInNav = null;
  return was;
}

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
 * controls) or handled Back itself (the player leaving). */
type Closer = () => boolean;
const closers: Closer[] = [];
/** The shown page's own rule for Back once nothing is open on it (a root's:
 * design/navigation.md, "TV"); true when it took Back. */
const pageRules: Closer[] = [];

const keep = (list: Closer[], fn: Closer) => {
  list.push(fn);
  cleanup(() => {
    const at = list.lastIndexOf(fn);
    if (at >= 0) list.splice(at, 1);
  });
};

/** Lets `fn` take Back while the component that calls it is shown. */
export const onBack = (fn: Closer) => keep(closers, fn);
/** The page's rule for Back after its closers, while the page is shown. */
export const onPageBack = (fn: Closer) => keep(pageRules, fn);

/** Back, from any key or button: the newest closer that takes it, then the
 * page's rule, else one level up. */
export function handleBack() {
  if (!closeFirst()) back();
}

/** What is open on the page, then the page's rule: true when one took Back.
 * The system back of a native stack (Android) asks this before it pops. */
export function closeFirst(): boolean {
  for (let i = closers.length - 1; i >= 0; i--) if (closers[i]()) return true;
  for (let i = pageRules.length - 1; i >= 0; i--) if (pageRules[i]()) return true;
  return false;
}
