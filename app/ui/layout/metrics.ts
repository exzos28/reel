// Where a page's parts go on this device: the one place that knows what sits over and under
// a page (the nav, the heads, the window bar, the system's bars), so screens never work it
// out. `computeMetrics` is pure (tests call it for each family); `metrics(kind)` is this
// device's, reactive (rotation, a resized window).
import { safeArea } from "nsh";
import { look } from "../platform/look";
import { u } from "../theme";
import { frame } from "./chrome";

/** A root page (a destination: the nav over it), a title (its hero runs under what is
 * over it) or a deep page (Settings on touch, About: Back over it). */
export type PageKind = "root" | "title" | "deep";
export type NavPlace = typeof frame.nav;

/** A TV's nav in the page: its top and its row, TV pixels. */
export const NAV_TOP = 50;
export const NAV_ROW = 62;
/** A desktop's window bar, points. */
export const BAR_HEIGHT = 52;
/** The tablet's top row under the status bar, points. */
export const TOP_ROW = 60;
/** A phone's head on a root page (the logo, Settings), points. */
export const PHONE_HEAD = 44;
/** A phone's discs over a title's hero: 4 under the status bar, 40 across. */
export const PHONE_DISCS = 44;
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
    switch (i.nav) {
      // A TV's nav is on its root pages only; elsewhere Back is the remote's.
      case "page":
        return i.kind === "root" ? px(NAV_TOP + NAV_ROW) : 0;
      case "window-bar":
        return BAR_HEIGHT;
      case "top-row":
        return i.safeTop + TOP_ROW;
      case "tab-bar":
        return i.safeTop + (i.kind === "deep" ? PHONE_BACK_HEAD : i.kind === "title" ? PHONE_DISCS : PHONE_HEAD);
    }
  };
  const headBottom = head();
  return {
    headBottom,
    titleTop: headBottom + px(TITLE_GAP),
    bottomRoom: px(54) + i.safeBottom + (i.nav === "tab-bar" ? i.tabRow : 0),
  };
}

/** The phone's tab bar's row over the system's area, points: Material's 80, iOS's 49. */
export const TAB_ROW = look.system === "material" ? 80 : 49;

/** This device's metrics for a page of `kind`. */
export function metrics(kind: PageKind): Metrics {
  const a = safeArea();
  return computeMetrics({ nav: frame.nav, kind, safeTop: a.top, safeBottom: a.bottom, unit: u(1), tabRow: TAB_ROW });
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
