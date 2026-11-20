// One title screen's focus, kept while the player or a deeper screen shows;
// another title starts over: on Play, in the season the viewer is in.
import { signal } from "nsh";
import { stack } from "../../nav";

/** `header`: Add to list, top-right; `actions`: the hero's row (`action` says which);
 * `releases`: the panel the ⌄ in Play opens. */
export type Zone = "header" | "actions" | "releases" | "save" | "tabs" | "list" | "cast" | "similar";
/** The hero's actions, left to right as the remote walks them: Play, its ⌄ (the other
 * releases), Save, Trailer. */
export type HeroAction = "play" | "releases" | "save" | "trailer";

let shownId = "";
export const zone = signal<Zone>("actions");
/** The focused action, by name: the row changes as the release comes in or the search finds
 * none, and the focus stays on what it was on (Play when that is gone). */
export const action = signal<HeroAction>("play");
export const season = signal(1);
/** The focused row under the tabs: an episode of a show, a release of a film. */
export const item = signal(0);
/** The focused person in the cast row, title in More like this. */
export const castAt = signal(0);
export const similarAt = signal(0);
/** A show's focused release (of the episode Play starts). */
export const releaseAt = signal(0);

type Saved = [Zone, HeroAction, number, number, number, number];
/** Where the focus was on the titles under the one shown (More like this
 * opens one on top of another; Back finds the focus where it was). */
const saved = new Map<string, Saved>();

/** Starts the focus over when `id` is not the title shown last (or takes
 * it back to where it was on `id`). */
export function focusTitle(id: string, startSeason: number) {
  if (shownId === id) return;
  // The release panel and the Save drawer close when the screen does: back on their buttons.
  if (shownId) saved.set(shownId, [zone() === "releases" || zone() === "save" ? "actions" : zone(), action(), season(), item(), castAt(), similarAt()]);
  // Only titles still under this one are come back to.
  const open = new Set(stack().flatMap((r) => (r.name === "title" ? [r.id] : [])));
  for (const k of saved.keys()) if (!open.has(k)) saved.delete(k);
  shownId = id;
  const [z, a, s, i, c, m] = saved.get(id) ?? ["actions", "play", startSeason, 0, 0, 0];
  saved.delete(id);
  zone.set(z);
  action.set(a);
  season.set(s);
  item.set(i);
  castAt.set(c);
  similarAt.set(m);
  releaseAt.set(0);
}
