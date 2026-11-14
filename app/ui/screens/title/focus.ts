// One title screen's focus, kept while the player or a deeper screen shows;
// another title starts over: on Play, in the season the viewer is in.
import { signal } from "nsh";
import { stack } from "../../nav";

export type Zone = "back" | "actions" | "tabs" | "list" | "cast" | "similar";

let shownId = "";
export const zone = signal<Zone>("actions");
export const action = signal(0);
export const season = signal(1);
/** The focused row under the tabs: an episode of a show, a release of a film. */
export const item = signal(0);
/** The focused person in the cast row, title in More like this. */
export const castAt = signal(0);
export const similarAt = signal(0);

type Saved = [Zone, number, number, number, number, number];
/** Where the focus was on the titles under the one shown (More like this
 * opens one on top of another; Back finds the focus where it was). */
const saved = new Map<string, Saved>();

/** Starts the focus over when `id` is not the title shown last (or takes
 * it back to where it was on `id`). */
export function focusTitle(id: string, startSeason: number) {
  if (shownId === id) return;
  if (shownId) saved.set(shownId, [zone(), action(), season(), item(), castAt(), similarAt()]);
  // Only titles still under this one are come back to.
  const open = new Set(stack().flatMap((r) => (r.name === "title" ? [r.id] : [])));
  for (const k of saved.keys()) if (!open.has(k)) saved.delete(k);
  shownId = id;
  const [z, a, s, i, c, m] = saved.get(id) ?? ["actions", 0, startSeason, 0, 0, 0];
  saved.delete(id);
  zone.set(z);
  action.set(a);
  season.set(s);
  item.set(i);
  castAt.set(c);
  similarAt.set(m);
}
