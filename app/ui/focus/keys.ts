// Arrow keys that move the focus: the scroll views follow the focus they
// move, and not one a pointer press moved.

/** When an arrow key last moved the focus (`byKeys`). */
let keyedAt = -Infinity;

/** Whether an arrow key moved the focus just now: within a second, as a TV's slow page
 * may take a few hundred ms from the key to the focus's effects. */
export const keyed = () => performance.now() - keyedAt < 1000;

/** Arrow-key bindings that mark their moves as keyed. */
export function byKeys(bindings: Record<string, (e: { keystroke: string }) => void>) {
  const out: typeof bindings = {};
  for (const [key, run] of Object.entries(bindings)) {
    out[key] = (e) => {
      keyedAt = performance.now();
      run(e);
    };
  }
  return out;
}
