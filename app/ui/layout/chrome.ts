// The platform family reel lays its frame out for (design/navigation.md,
// "Platform families"): where the nav sits, where Back is, how panels open.
// The family comes from the platform layer (ui/platform); this file turns it
// into layout decisions, so components ask `frame` instead of the family.
import { safeArea, windowSize } from "nsh";
import { family, type Family } from "../platform";

export type Chrome = Family;

/** Which family this is: the platform layer's (ui/platform). Per-family sizes
 * read it; where things go is `frame`'s. */
export const chrome: Chrome = family;
const desktop = chrome === "mac" || chrome === "windows" || chrome === "linux";

/** Where the frame's parts go on this family. */
export const frame = {
  /** The nav: on top of a TV's page (it scrolls away), a desktop's window bar, the
   * tablet's top row, the phone's tab bar (and its head over a root page). */
  nav: (chrome === "tv" ? "page" : desktop ? "window-bar" : chrome === "tablet" ? "top-row" : "tab-bar") as
    "page" | "window-bar" | "top-row" | "tab-bar",
  /** A drawer: a TV's own panel at the right, a desktop's sheet at the right, the
   * tablet's floating sheet, the phone's sheet from the bottom. */
  panel: (chrome === "tv" ? "tv" : chrome === "phone" ? "bottom-sheet" : chrome === "tablet" ? "floating-sheet" : "side-sheet") as
    "tv" | "side-sheet" | "floating-sheet" | "bottom-sheet",
  /** A title's Add to list on the page (a TV, a phone), not in the bar (a desktop, a tablet). */
  listInPage: chrome === "tv" || chrome === "phone",
};

/** Content margin left and right of the safe area, points (desktop 64,
 * tablet 32, phone 20). A TV's comes from its title-safe 5% (`theme.safe`). */
const MARGIN = { mac: 64, windows: 64, linux: 64, tablet: 32, phone: 20 } as const;

/** The narrowest and the widest a desktop page's content column gets, points. In between it is
 * a 16:9 screen of the window's height: a 2560 x 1440 window runs edge to edge, a 3440 or
 * 5120 x 1440 one keeps a 2560 column in the middle (rows of posters, the hero's text, grids),
 * the room beside it left empty; a short wide window keeps 1680. */
export const DESKTOP_CONTENT_MIN = 1680;
export const DESKTOP_CONTENT_MAX = 2560;

/** The widest a desktop page's content gets in a window `width` x `height` points. */
export function contentWidthFor(width: number, height: number): number {
  return Math.min(width, Math.min(DESKTOP_CONTENT_MAX, Math.max(DESKTOP_CONTENT_MIN, (height * 16) / 9)));
}

/** A desktop's horizontal inset in a window `width` x `height`: the family's (`base`), or more
 * where the window is wider than its content column. */
export function sideInsetFor(width: number, height: number, base: number): number {
  return Math.max(base, (width - contentWidthFor(width, height)) / 2);
}

/** The family's inset: the system's safe area (a landscape phone's notch side) plus its margin. */
function baseInset(): number {
  const a = safeArea();
  return Math.max(a.left, a.right) + MARGIN[chrome as keyof typeof MARGIN];
}

/** The horizontal inset of content, points, off a TV: the family's, and on a wide desktop
 * window what centres its content column. */
export function sideInset(): number {
  if (chrome === "tv") throw new Error("a TV's inset is theme.safe()");
  if (!desktop) return baseInset();
  const w = windowSize();
  return sideInsetFor(w.width, w.height, baseInset());
}

/** How much further in than the family's margin a wide desktop window puts its content
 * column, points (0 on a TV, on touch and in an ordinary window). Blocks with a width of their
 * own (the hero's text) add it back, so the inset moves them instead of narrowing them. */
export function centering(): number {
  if (!desktop) return 0;
  return sideInset() - baseInset();
}
