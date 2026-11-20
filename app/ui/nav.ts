// Where the viewer is: a stack of screens (design/navigation.md, "History
// model"). The nav's destinations are roots; a title or About opens on top;
// Back closes what is open on the page first (`onBack`), then goes one level
// up. On a phone and a tablet each tab keeps its own stack.
import { cleanup, signal } from "nsh";

export type Destination = "home" | "movies" | "shows" | "cartoons" | "anime" | "search" | "settings" | "saved";
export type Route =
  | { name: Destination }
  | { name: "title"; id: string }
  | { name: "person"; id: string }
  | { name: "about" }
  | { name: "interface" };

/** The nav's destinations: a page with nothing under it. */
export const ROOTS: Destination[] = ["home", "movies", "shows", "cartoons", "anime", "search", "settings", "saved"];
export const isRoot = (name: string) => ROOTS.includes(name as Destination);

/** What there is to watch: on a phone, one Home tab with these as the tabs at the top of its page
 * (design/navigation.md, "Phone"). */
export const CATEGORIES: Destination[] = ["home", "movies", "shows", "cartoons", "anime"];
export const isCategory = (name: string) => CATEGORIES.includes(name as Destination);
/** The category open last: where a phone's Home tab goes back to. */
export const lastCategory = signal<Destination>("home");

/** A phone's Home tab holds the categories (and Back from another tab goes to it): a phone's
 * layout, a tablet's narrow window's too. Asked as it is needed (a tablet's window is resized
 * across a phone's width). Set once at startup. */
let homeTab: () => boolean = () => false;
export function useHomeTab(on: () => boolean) {
  homeTab = on;
}

/** Saved and Settings are sections of their own beside the tabs (a tablet's top row): each its
 * own stack, opened from wherever the viewer is, and Back from its root goes back there. Asked as
 * it is needed, like `useHomeTab`. Set once at startup. */
let ownSections: () => boolean = () => false;
export function useOwnSections(on: () => boolean) {
  ownSections = on;
  from.clear();
}
const OWN: Destination[] = ["saved", "settings"];
/** Where Saved and Settings were opened from: Back from their root goes there (once). */
const from = new Map<Destination, Destination>();

export const stack = signal<Route[]>([{ name: "home" }]);
export const route = () => stack()[stack().length - 1];

/** Settings' pages: Settings, and Interface and About on it. */
const isSettingsPage = (name: string) => name === "settings" || name === "about" || name === "interface";

/** The destination the page belongs to (the nav shows it selected): the first
 * route of its stack; About belongs to Settings. */
export function section(): Destination {
  const first = stack()[0].name;
  return isSettingsPage(first) ? "settings" : first === "title" || first === "person" ? "home" : first;
}

/** Whether there is a page under this one. */
export const canGoBack = () => stack().length > 1;

/** One stack per tab (phone, tablet): switching tabs keeps each tab's place;
 * on a phone Settings opens on top of the current tab, on a tablet as its own section. Off on
 * a TV and a desktop, where a destination starts the stack over. Set once at startup. */
let tabStacks = false;
const kept = new Map<Destination, Route[]>();
export function useTabStacks(on: boolean) {
  tabStacks = on;
  kept.clear();
  from.clear();
}

/** A tab's stack changed while another tab is shown (its native stack reported a pop late):
 * kept for when it is shown again. */
export function keepTab(tab: Destination, routes: Route[]) {
  if (section() === tab) stack.set(routes);
  else kept.set(tab, routes);
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
  if (isCategory(name)) lastCategory.set(name);
  if (section() === name) return reselect(name);
  if (OWN.includes(name)) from.set(name, section());
  switchTo(name);
}

/** Shows a destination's stack (a tab's kept one, or a new one). */
function switchTo(name: Destination) {
  if (tabStacks) {
    kept.set(section(), stack());
    stack.set(kept.get(name) ?? [{ name }]);
  } else stack.set([{ name }]);
}

/** A tablet's window widened past a phone's: Settings pages a tab holds (opened on it while the
 * layout was a phone's) leave it for Settings' own section, which Back leaves for that tab. */
export function liftSettings() {
  if (!tabStacks) return;
  const cut = (routes: Route[]) => {
    const at = routes.findIndex((r, i) => i > 0 && isSettingsPage(r.name));
    return at < 0 ? null : { keep: routes.slice(0, at), lifted: routes.slice(at) };
  };
  for (const [tab, routes] of kept) {
    const c = cut(routes);
    if (c) kept.set(tab, c.keep);
  }
  const c = cut(stack());
  if (!c) return;
  const tab = section();
  kept.set(tab, c.keep);
  from.set("settings", tab);
  stack.set(c.lifted[0].name === "settings" ? c.lifted : [{ name: "settings" }, ...c.lifted]);
}

/** A category picked in the tabs at the top of a phone's Home: its page, from its top (a filter
 * of what to watch, not a place: a film opened there before is not kept). */
export function openCategory(name: Destination) {
  if (section() === name) return reselect(name);
  kept.delete(name);
  go(name);
}

/** A phone's Home tab: the category open last; chosen again, its page goes to its top. */
export function goHomeTab() {
  go(isCategory(section()) ? section() : lastCategory());
}

const push = (r: Route) => stack.set([...stack(), r]);
export const openTitle = (id: string) => push({ name: "title", id });
/** A person of a title's cast: the titles they are in. */
export const openPerson = (id: string) => push({ name: "person", id });
/** About reel and its data sources, over Settings. */
export const openAbout = () => push({ name: "about" });
/** How the app looks (Menu position, Loading animation), over Settings. */
export const openInterface = () => push({ name: "interface" });
/** Settings: a destination of its own; on a tablet its own section (on its root); on a phone's
 * layout (with tab stacks) on top of the current tab. */
export function openSettings() {
  if (!tabStacks || ownSections()) {
    if (section() !== "settings") go("settings");
    if (canGoBack()) reselect("settings");
    return;
  }
  if (route().name !== "settings") push({ name: "settings" });
}

/** One level up. From a destination other than Home, to Home; on a tablet, from Saved's or
 * Settings' root to where it was opened from. On a phone's layout, from Search, Saved or
 * Settings to the Home tab (the category open last), and from a category to All. */
export function back() {
  const s = stack();
  const root = s[0].name as Destination;
  const opener = ownSections() && OWN.includes(root) ? from.get(root) : undefined;
  if (s.length > 1) stack.set(s.slice(0, -1));
  else if (homeTab() && !isCategory(root)) go(lastCategory());
  else if (opener && opener !== root) {
    // Once: from there Back goes on by its own rule (Saved and Settings never bounce).
    from.delete(root);
    switchTo(opener);
  } else if (root !== "home") go("home");
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
