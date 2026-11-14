// The web build's smooth scroll (a TV's browser): the scroll element itself is asked to
// glide (`scrollTo` with `behavior: "smooth"`), which Chromium animates on its compositor
// thread, smooth while the page's own thread is busy. NSH's animated scroll steps it from
// script frame by frame instead, which on a TV's slow thread takes seconds.
// The element is found by its `data-testid` (a Scroller's `domId`), in the documents the
// app's code can reach (its own frame and NSH's page above it, same origin).

type El = { scrollTo(o: { top?: number; left?: number; behavior: string }): void };
type Doc = { querySelector(s: string): El | null };
type Win = { document?: Doc; parent?: Win };

const docs = (): Doc[] => {
  const g = globalThis as unknown as Win;
  const out: Doc[] = [];
  for (const w of [g, g.parent]) {
    try {
      if (w?.document && !out.includes(w.document)) out.push(w.document);
    } catch {
      // another origin
    }
  }
  return out;
};

/** Glides the scroll element `id` to `target` (points); false when it is not in reach. */
export function glide(id: string, horizontal: boolean, target: number): boolean {
  for (const d of docs()) {
    const el = d.querySelector(`[data-testid="${id}"]`);
    if (!el) continue;
    el.scrollTo(horizontal ? { left: target, behavior: "smooth" } : { top: target, behavior: "smooth" });
    return true;
  }
  return false;
}
