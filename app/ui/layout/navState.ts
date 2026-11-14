// What the nav needs from the screen it sits on: which of its items the
// screen's focus is on.
import { signal } from "nsh";

/** The nav item the focus is on, null while it is elsewhere. */
export const navFocus = signal<{ at: () => number | null }>({ at: () => null });

/** Called by a top-level screen as it opens. */
export function showNav(at: () => number | null) {
  navFocus.set({ at });
}
