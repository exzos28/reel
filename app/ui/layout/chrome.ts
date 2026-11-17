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

/** The horizontal inset of content, points, off a TV: the system's safe area
 * (a landscape phone's notch side) plus the family's margin. */
/** The widest a desktop page's content gets, points: on a wide window it stays in the middle
 * (rows of posters, the hero's text, grids), the room beside it left empty. */
export const DESKTOP_CONTENT_MAX = 1680;

export function sideInset(): number {
  if (chrome === "tv") throw new Error("a TV's inset is theme.safe()");
  const a = safeArea();
  const base = Math.max(a.left, a.right) + MARGIN[chrome];
  if (chrome === "mac" || chrome === "windows" || chrome === "linux") {
    return Math.max(base, (windowSize().width - DESKTOP_CONTENT_MAX) / 2);
  }
  return base;
}
