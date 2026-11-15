// Arrow keys that move the focus: the scroll views follow the focus they
// move, and not one a pointer press moved.

import { signal } from "nsh";

/** When an arrow key last moved the focus (`byKeys`). */
let keyedAt = -Infinity;

/** Whether an arrow key moved the focus just now: within a second, as a TV's slow page
 * may take a few hundred ms from the key to the focus's effects. */
export const keyed = () => performance.now() - keyedAt < 1000;

/** The keys are driving: the focus ring shows (`theme.focusRing`). Arrow keys turn it on; a
 * touch or a mouse click turns it off (App's root view). A TV shows it always. */
export const keysInUse = signal(false);

/** Arrow-key bindings that mark their moves as keyed. */
export function byKeys(bindings: Record<string, (e: { keystroke: string }) => void>) {
  const out: typeof bindings = {};
  for (const [key, run] of Object.entries(bindings)) {
    out[key] = (e) => {
      keyedAt = performance.now();
      keysInUse.set(true);
      run(e);
    };
  }
  return out;
}
