// One title screen's focus, kept while the player or a deeper screen shows;
// another title starts over: on Play, in the season the viewer is in.
import { signal } from "nsh";

export type Zone = "back" | "actions" | "tabs" | "list";

let shownId = "";
export const zone = signal<Zone>("actions");
export const action = signal(0);
export const season = signal(1);
/** The focused row under the tabs: an episode of a show, a release of a film. */
export const item = signal(0);

/** Starts the focus over when `id` is not the title shown last. */
export function focusTitle(id: string, startSeason: number) {
  if (shownId === id) return;
  shownId = id;
  zone.set("actions");
  action.set(0);
  season.set(startSeason);
  item.set(0);
}
