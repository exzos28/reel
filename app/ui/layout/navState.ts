// What the shared nav needs from the screen under it: which of its items
// the screen's focus is on, and whether the screen scrolled its content
// under it.
import { signal } from "nsh";

/** The nav item the focus is on, null while it is elsewhere. */
export const navFocus = signal<{ at: () => number | null }>({ at: () => null });

/** The screen's content runs under the nav: it gets a band of background. */
export const navCovered = signal(false);

/** Called by a top-level screen as it opens. */
export function showNav(at: () => number | null) {
  navFocus.set({ at });
  navCovered.set(false);
}
