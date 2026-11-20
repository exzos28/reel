// The platform family reel lays its frame out for (design/navigation.md,
// "Platform families"): where the nav sits, where Back is, how panels open.
// The family comes from the platform layer (ui/platform); this file turns it
// into layout decisions, so components ask `frame` instead of the family.
import { computed, safeArea, windowSize } from "nsh";
import { Settings } from "../native";
import { family, runtime, type Family } from "../platform";

export type Chrome = Family;

/** A tablet's window narrower than this, points, is laid out as a phone's (iPadOS's windowed
 * mode, Split View, Android's multi-window): the tab bar, sheets from the bottom, phone sizes. */
export const PHONE_WIDTH = 600;

/** The family the layout follows: the device's (ui/platform), but a tablet's window follows its
 * width (`PHONE_WIDTH`), live as it is resized. What only the device decides (what Play picks,
 * the player turning the screen, Settings as a tab) reads the platform's `family`. */
const layout = computed<Chrome>(() => (family === "tablet" && windowSize().width < PHONE_WIDTH ? "phone" : family));

/** Which family the layout is for now, reactive (a tablet's narrow window is a phone's).
 * Per-family sizes read it; where things go is `frame`'s. */
export const chrome = (): Chrome => layout();
const desktop = family === "mac" || family === "windows" || family === "linux";

export type NavPlace = "page" | "window-bar" | "top-row" | "tab-bar";
export type PanelPlace = "tv" | "side-sheet" | "floating-sheet" | "bottom-sheet";

export interface Frame {
  /** The nav: on top of a TV's page (it scrolls away), a desktop's window bar, the
   * tablet's top row, the phone's tab bar (and its head over a root page). */
  nav: NavPlace;
  /** A drawer: a TV's own panel at the right, a desktop's sheet at the right, the
   * tablet's floating sheet, the phone's sheet from the bottom. */
  panel: PanelPlace;
  /** A title's Add to list on the page (a TV, a phone), not in the bar (a desktop, a tablet). */
  listInPage: boolean;
}

const FRAMES: Record<Chrome, Frame> = {
  tv: { nav: "page", panel: "tv", listInPage: true },
  mac: { nav: "window-bar", panel: "side-sheet", listInPage: false },
  windows: { nav: "window-bar", panel: "side-sheet", listInPage: false },
  linux: { nav: "window-bar", panel: "side-sheet", listInPage: false },
  tablet: { nav: "top-row", panel: "floating-sheet", listInPage: false },
  phone: { nav: "tab-bar", panel: "bottom-sheet", listInPage: true },
};

/** Where the frame's parts go now, reactive (a tablet's window resized under the phone's width
 * moves them): read it where it is used, never once at import. */
export const frame = (): Frame => FRAMES[chrome()];

/** A phone held sideways (its window wider than tall): a drawer that asks for it (`Drawer`'s
 * `sideways`) is a full-height sheet at the right instead of a short one from the bottom. */
export const phoneSideways = () => {
  if (chrome() !== "phone") return false;
  const w = windowSize();
  return w.width > w.height;
};

/** How far iPadOS's window controls (●●● at a window's top left, in windowed mode) reach in
 * from the window's left edge, points, with a little room after them. */
const WINDOW_CONTROLS = 76;
/** The room the window controls take at the top left of an iPad's window, points: NSH reports
 * none of it. They show in a window that does not fill the screen (the core knows the screen's
 * size: `Settings.windowed`); else 0. What sits at the top left (the logo, Back, the first tab)
 * starts after it. */
export function windowControlsRoom(): number {
  if (family !== "tablet" || runtime.os !== "ios") return 0;
  const w = windowSize();
  return Settings.windowed(w.width, w.height) ? WINDOW_CONTROLS : 0;
}

/** Content margin left and right of the safe area, points (desktop 64,
 * tablet 32, phone 20). A TV's comes from its title-safe 5% (`theme.safe`). */
const MARGIN = { mac: 64, windows: 64, linux: 64, tablet: 32, phone: 20 } as const;

/** The narrowest and the widest a desktop page's content column gets, points. In between it is
 * a 16:9 screen of the window's height: a 2560 x 1440 window runs edge to edge, a short wide
 * one keeps 1680 (an ultra-wide one: `ULTRA_WIDE_RATIO`, a 3440 or 5120 x 1440 keeps a 2160
 * column in the middle), the room beside it left empty. */
export const DESKTOP_CONTENT_MIN = 1680;
export const DESKTOP_CONTENT_MAX = 2560;
/** An ultra-wide window: wider than this for its height (21:9, 32:9, a short wide window; 16:9
 * and 16:10 are 1.78 and 1.6). Its column is narrower for its height, a 3:2 screen of it with no
 * 1680 floor, so the content does not spread far wider than the window is tall; but never under
 * `ULTRA_WIDE_CONTENT_MIN`. */
export const ULTRA_WIDE_RATIO = 2.2;
export const ULTRA_WIDE_CONTENT_RATIO = 3 / 2;
export const ULTRA_WIDE_CONTENT_MIN = 1280;

/** Whether a window `width` x `height` is ultra-wide (`ULTRA_WIDE_RATIO`). */
export const isUltraWide = (width: number, height: number) => width / height > ULTRA_WIDE_RATIO;

/** This window is a desktop's ultra-wide one (never a TV's or touch's). */
export function ultraWide(): boolean {
  if (!desktop) return false;
  const w = windowSize();
  return isUltraWide(w.width, w.height);
}

/** The widest a desktop page's content gets in a window `width` x `height` points. */
export function contentWidthFor(width: number, height: number): number {
  if (isUltraWide(width, height)) {
    return Math.min(width, DESKTOP_CONTENT_MAX, Math.max(ULTRA_WIDE_CONTENT_MIN, height * ULTRA_WIDE_CONTENT_RATIO));
  }
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
  return Math.max(a.left, a.right) + MARGIN[chrome() as keyof typeof MARGIN];
}

/** The horizontal inset of content, points, off a TV: the family's, and on a wide desktop
 * window what centres its content column. */
export function sideInset(): number {
  if (family === "tv") throw new Error("a TV's inset is theme.safe()");
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
