// The room the system's window controls take in reel's window bar (macOS's traffic lights at its
// left, Windows' and GNOME's caption buttons at its right): NSH's `titleBar()`, or in a browser
// standing in for a Mac or Windows (index.ts `standIn`) the room their controls take there, so
// the bar's Back, logo and nav sit where they do in the app.
import { titleBar as systemTitleBar, type TitleBarArea } from "nsh/desktop";
import { family, standIn } from ".";

/** About what the systems report for reel's 52 pt bar, points. */
const STAND_IN: Partial<Record<typeof family, TitleBarArea>> = {
  mac: { height: 52, left: 70, right: 0 },
  windows: { height: 52, left: 0, right: 138 },
};

export const titleBar = (): TitleBarArea => (standIn && STAND_IN[family]) || systemTitleBar();
