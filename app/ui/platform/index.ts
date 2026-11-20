// The one place that knows which platform this is (README.md here). It names the
// platform family reel lays its frame out for, and answers what the UI asks of the
// platform as capabilities. Screens never check the platform: they ask `caps`, or one of
// the modules next to this file (scroll, remote, window, look, diagnostics).
import { Settings } from "../native";
import { runtime } from "./runtime";

export { runtime } from "./runtime";

/** The platform family (design/navigation.md, "Platform families"): where the nav sits,
 * where Back is, how panels open. */
export type Family = "tv" | "mac" | "windows" | "linux" | "tablet" | "phone";

const FAMILIES: Family[] = ["tv", "mac", "windows", "linux", "tablet", "phone"];
/** What the core says this device is: "tv" on a Samsung TV; on a development host serving the web
 * build in a browser (reel-core --device, dev/screens.sh), the family to stand in for. */
const device = Settings.device();

/** A TV: the system says so, or the core does (a Samsung TV's web view looks
 * like a desktop browser to NSH, but the core there runs the TV's player). */
const tv = runtime.idiom === "tv" || device === "tv";

/** The web build standing in for another family than a TV (a Mac, a phone…), for screenshots in a
 * browser: laid out as it, with a stand-in for what only the real platform has (`titleBar`). */
export const standIn = runtime.web && !tv && (FAMILIES as string[]).includes(device);

function detect(): Family {
  if (tv) return "tv";
  if (standIn) return device as Family;
  if (runtime.desktop) {
    if (runtime.os === "macos") return "mac";
    if (runtime.os === "windows") return "windows";
    // Linux, and a desktop browser: no system title bar of reel's own to fit
    // around (`titleBar()` reports no window controls there).
    return "linux";
  }
  return runtime.idiom === "phone" ? "phone" : "tablet";
}

export const family: Family = detect();
// The core picks releases for this kind of device (a phone keeps to 1080p and a sane size):
// told once, before anything asks it for one.
Settings.setFamily(family);
const desktop = family === "mac" || family === "windows" || family === "linux";
const touch = family === "tablet" || family === "phone";

/** What this platform does, by what the UI asks. */
export const caps = {
  /** A desktop window: reel draws its own window bar (Back, nav) and drag strips. */
  windowBar: desktop,
  /** Keyboard shortcuts with ⌘ / Ctrl (a desktop's menu and bindings). */
  shortcuts: desktop,
  /** A touch screen: taps and swipes, the system's own headers and stacks. */
  touch,
  /** A TV remote: arrows, OK and Back only, one focus line the page moves under. */
  remote: tv,
  /** The window can fill the screen (a full-screen button and F in the player). */
  fullscreen: runtime.desktop && !tv,
  /** The player turns the screen itself (a Rotate button): an iPhone, where the rotation lock
   * keeps a film upright otherwise. Not an iPad: its window does not turn for an app. */
  rotate: runtime.os === "ios" && family === "phone",
};
