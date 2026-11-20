// The frame's state that belongs to a page (whether content is under the bars), kept by the
// page on top only. Touch keeps the pages under the top one mounted (its native stack); each
// knows its route through `PageRoute`, and only the one on top writes. Elsewhere one page
// is mounted at a time (`PageRoute` is null): it is the one on top.
import { context, signal } from "nsh";
import { route, type Route } from "../nav";

/** The route of the page being rendered (touch's stack), or null where one page shows. */
export const PageRoute = context<Route | null>(null);

/** The page is one of a tablet's Settings sheet (`SettingsSheet`): its head has the title and
 * nothing of the app's frame is over it. */
export const InSheet = context(false);

/** Content is under the bars (the window bar, the tablet's top row, a phone's status bar):
 * they turn solid. Written by the page on top. */
export const frameSolid = signal(false);

/** Whether the page rendering this (its `PageRoute`) is the one on top. */
export function onTop(): () => boolean {
  const mine = PageRoute();
  return () => mine === null || route() === mine;
}
