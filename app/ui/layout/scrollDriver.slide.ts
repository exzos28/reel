// A TV's web build driver: the scroll view's content moved by a CSS `transform` transition
// (scrollDriver.ts). The browser's compositor runs it alone, so it stays smooth while the
// page's thread is busy; scrolling the element (even a smooth `scrollTo`) runs on that
// thread on a TV. The element itself stays at 0; its content is found by the element's
// `data-testid` in the documents the app's code reaches (its frame and NSH's page, one origin).
import type { DriverHost, ScrollDriver } from "./scrollDriver";

/** How long a slide takes, ms. */
const SLIDE_MS = 320;
const EASE = "cubic-bezier(0.22, 0.8, 0.3, 1)";

type Styled = { style: { transform: string; transition: string }; classList: { contains(c: string): boolean } };
type El = { children: ArrayLike<Styled> };
type Doc = { querySelector(s: string): El | null };
type Win = { document?: Doc; parent?: Win };

function element(id: string): El | null {
  const g = globalThis as unknown as Win;
  for (const w of [g, g.parent]) {
    try {
      const el = w?.document?.querySelector(`[data-testid="${id}"]`);
      if (el) return el;
    } catch {
      // another origin
    }
  }
  return null;
}

export function slideDriver(host: DriverHost): ScrollDriver {
  let at = 0;
  let resting: ReturnType<typeof setTimeout> | undefined;
  const move = (target: number, animate: boolean) => {
    const el = element(host.domId);
    if (!el) return false;
    const transform = host.horizontal ? `translate3d(${-target}px, 0, 0)` : `translate3d(0, ${-target}px, 0)`;
    // NSH's own children of a scroll view: a spacer (its length) and the content.
    for (const child of Array.from(el.children)) {
      if (child.classList.contains("nsh-spacer")) continue;
      child.style.transition = animate ? `transform ${SLIDE_MS}ms ${EASE}` : "none";
      child.style.transform = transform;
    }
    return true;
  };
  return {
    to(target, animate) {
      if (resting) clearTimeout(resting);
      resting = undefined;
      at = target;
      if (!move(target, animate)) {
        // Not in the DOM (yet): the view's own offset.
        host.scroll()?.scrollTo(host.horizontal ? { x: target, animated: false } : { y: target, animated: false });
        return host.rest(target);
      }
      if (!animate) return host.rest(target);
      resting = setTimeout(() => {
        resting = undefined;
        host.rest(target);
      }, SLIDE_MS);
    },
    // A transition cannot be caught midway from here: it finishes where it was sent.
    stop: () => {},
    moving: () => resting !== undefined,
    at: () => at,
    // NSH's measures do not see the transform: where the content is, only the driver knows.
    sync: () => {},
  };
}
