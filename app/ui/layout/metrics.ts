// Where a page's parts go on this device: the one place that knows what sits over and under
// a page (the nav, the heads, the window bar, the system's bars), so screens never work it
// out. `computeMetrics` is pure (tests call it for each family); `metrics(kind)` is this
// device's, reactive (rotation, a resized window).
import { safeArea, windowSize } from "nsh";
import { look } from "../platform/look";
import { u } from "../theme";
import { centering, frame, sideInset, sideSafeArea } from "./chrome";
import { canGoBack, isCategory, section } from "../nav";

/** A root page (a destination: the nav over it), a title (its hero runs under what is
 * over it) or a deep page (Settings on touch, About: Back over it). */
/** "bare": a page of its own with nothing over it but the system's bars (the first-run setup). */
export type PageKind = "root" | "title" | "deep" | "bare";
export type { NavPlace } from "./chrome";
import type { NavPlace } from "./chrome";

/** A TV's nav in the page: its top and its row, TV pixels. */
export const NAV_TOP = 50;
export const NAV_ROW = 62;
/** A desktop's window bar, points. */
export const BAR_HEIGHT = 52;
/** The tablet's top row under the status bar, points. */
export const TOP_ROW = 60;
/** A phone's head on a root page (the logo), points. */
export const PHONE_HEAD = 44;
/** Under it on a category's page (Home's tabs: All, Movies, Series, Cartoons, Anime), points. */
export const CATEGORY_ROW = 44;
/** What the page leaves under them before its own content (a hero's title), points. */
const CATEGORY_GAP = 28;
/** A phone's bar over a scrolled title (Back, the title, Add to list) under the status bar,
 * points: iOS's navigation bar 44, Material's top app bar 64. The discs over the hero sit
 * centred in it. */
export const PHONE_TITLE_BAR = look.system === "material" ? 64 : 44;
/** A phone's head on a deep page (Back), points. */
export const PHONE_BACK_HEAD = 52;
/** A page's title under what is over it, and a hero's text under it, TV pixels. */
const TITLE_GAP = 58;
const HERO_GAP = 40;

export interface MetricsInput {
  nav: NavPlace;
  kind: PageKind;
  safeTop: number;
  safeBottom: number;
  /** One TV pixel in points (`theme.u(1)`). */
  unit: number;
  /** The phone's tab bar's row, points (without the system's area under it). */
  tabRow: number;
  /** A landscape phone: the tabs are a rail at the left, not a bar under the content. */
  rail?: boolean;
  /** A category's root page on a phone: Home's tabs under its head. */
  category?: boolean;
}

export interface Metrics {
  /** The bottom of what sits over the page's top, points from the page's top. A page that
   * has no hero starts its content there. */
  headBottom: number;
  /** Where a page's title stands. */
  titleTop: number;
  /** Room under the content: the system's area, the tab bar, a margin. */
  bottomRoom: number;
}

export function computeMetrics(i: MetricsInput): Metrics {
  const px = (n: number) => n * i.unit;
  const head = (): number => {
    // Nothing of reel's over it: the window bar on a desktop, the status bar on touch.
    if (i.kind === "bare") return i.nav === "window-bar" ? BAR_HEIGHT : i.nav === "page" ? 0 : i.safeTop;
    switch (i.nav) {
      // A TV's nav is on its root pages only; elsewhere Back is the remote's.
      case "page":
        return i.kind === "root" ? px(NAV_TOP + NAV_ROW) : 0;
      case "window-bar":
        return BAR_HEIGHT;
      case "top-row":
        return i.safeTop + TOP_ROW;
      case "tab-bar":
        // A root page: no logo over it on a phone; a category's has Home's tabs.
        return i.safeTop + (i.kind === "deep" ? PHONE_BACK_HEAD : i.kind === "title" ? PHONE_TITLE_BAR : i.category ? CATEGORY_ROW + CATEGORY_GAP : 0);
    }
  };
  const headBottom = head();
  return {
    headBottom,
    titleTop: headBottom + px(TITLE_GAP),
    bottomRoom: px(54) + i.safeBottom + (i.nav === "tab-bar" && !i.rail && i.kind !== "bare" ? i.tabRow : 0),
  };
}

/** The phone's tab bar's row over the system's area, points: Material's 80, iOS's 49. */
export const TAB_ROW = look.system === "material" ? 80 : 49;

/** A phone held sideways (little height): its tabs are a rail at the left. */
export const phoneRail = () => frame().nav === "tab-bar" && windowSize().height < 500;
/** The rail's width, points (with the system's area at the left: a notch). */
export const RAIL = 76;
export const railWidth = () => (phoneRail() ? RAIL + sideSafeArea().left : 0);

/** Where a hero's still starts, points from the page's top: under a phone's Home tabs (a fixed bar
 * over a category's root page), else at the top (it runs under what is over the page). */
export function stillTop(): number {
  return frame().nav === "tab-bar" && isCategory(section()) && !canGoBack() ? safeArea().top + CATEGORY_ROW : 0;
}

/** This device's metrics for a page of `kind`. */
export function metrics(kind: PageKind): Metrics {
  const a = safeArea();
  const category = kind === "root" && isCategory(section());
  return computeMetrics({ nav: frame().nav, kind, safeTop: a.top, safeBottom: a.bottom, unit: u(1), tabRow: TAB_ROW, rail: phoneRail(), category });
}

/** Where a hero's text starts, points: its design's place (`design`, TV pixels), or lower
 * where what is over the page reaches further (a phone's head under the status bar). */
export function heroTop(kind: PageKind, design: number): number {
  return heroTopFor(metrics(kind), u(1), design);
}

/** `heroTop` for given metrics and TV pixel (`unit`, points). */
export function heroTopFor(m: Metrics, unit: number, design: number): number {
  return Math.max(design * unit, m.headBottom + HERO_GAP * unit);
}

/** The most of the window's height a desktop hero's backdrop takes. */
const HERO_SHARE = 0.6;
/** The least of a still's height (a 16:9 frame) a desktop hero shows: the still is no wider
 * than leaves that much, so a wide window does not crop it to a strip of sky. */
const STILL_SHOWN = 0.62;

export interface HeroBoxInput {
  /** The design's height and where its backdrop starts from the left, points. */
  height: number;
  left: number;
  /** The window, points. */
  width: number;
  windowHeight: number;
  /** A desktop: the box follows the window. Elsewhere (a TV's ten-foot canvas, touch) it is the design's. */
  desktop: boolean;
}

export interface HeroBox {
  /** The hero's (and its backdrop's) height, points. */
  height: number;
  /** The still's width, points, from the window's right edge, and where it starts from the
   * window's left (more than 0: it fades in from the background there). */
  stillWidth: number;
  stillLeft: number;
  /** How far in from the window's right edge the still ends, points: a desktop window wider than
   * its content column runs it past the column into the room beside it, not to the window's edge
   * when that room is wide. */
  stillRight: number;
  /** How wide the still's fade on its right is, points (0: none, it ends at the window's edge):
   * across the room past the column and a little into it, so the column shows the still whole. */
  stillFadeRight: number;
  /** How far the still runs on under the hero's bottom, points: on a desktop it goes on behind
   * the first shelf's title and fades out there, instead of ending at the actions. */
  stillBelow: number;
}

/** A hero's box. On a desktop it grows with the window (up to 60% of its height, never past a
 * 16:9 frame of its width) and its still is no wider than shows 62% of the frame's height,
 * anchored right; where it starts after the window's left edge it fades in from the background. */
export function heroBox(i: HeroBoxInput): HeroBox {
  const room = i.width - i.left;
  if (!i.desktop) return { height: i.height, stillWidth: room, stillLeft: i.left, stillRight: 0, stillFadeRight: 0, stillBelow: 0 };
  const height = Math.max(i.height, Math.min(HERO_SHARE * i.windowHeight, (i.width * 9) / 16));
  const stillWidth = Math.min(room, (height * 16) / 9 / STILL_SHOWN);
  return { height, stillWidth, stillLeft: i.width - stillWidth, stillRight: 0, stillFadeRight: 0, stillBelow: 0 };
}

/** How far a desktop's still runs on under the hero, TV pixels: to about the first shelf's title. */
const STILL_BELOW = 150;
/** How far past a wide window's content column the still runs at most, TV pixels, and how far into
 * the column its fade starts: a little, so the fade is long enough to be gentle without the still
 * running far past the column. */
const STILL_PAST = 240;
const STILL_FADE_IN = 360;

/** A desktop's hero follows its window; a TV's and touch's keep their design. */
export const heroFollowsWindow = frame().nav === "window-bar";

/** This window's hero box for a design `height` and backdrop `left`, TV pixels. */
export function heroBoxNow(height: number, left = 0): HeroBox {
  const w = windowSize();
  // A window wider than its content column: the still runs past the column's right edge by up to
  // `STILL_PAST` and fades out there, rather than to the window's edge in a wide room.
  const wide = heroFollowsWindow && centering() > 0.5;
  const right = wide ? Math.max(0, sideInset() - u(STILL_PAST)) : 0;
  const fade = wide ? sideInset() - right + u(STILL_FADE_IN) : 0;
  const box = heroBox({ height: u(height), left: u(left), width: w.width - right, windowHeight: w.height, desktop: heroFollowsWindow });
  return { ...box, stillRight: right, stillFadeRight: Math.min(fade, box.stillWidth * 0.6), stillBelow: heroFollowsWindow ? u(STILL_BELOW) : 0 };
}
