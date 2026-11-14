// The platform family reel lays its frame out for (design/navigation.md,
// "Platform families"): where the nav sits, where Back is, how panels open.
import { platform, safeArea } from "nsh";
import { Settings } from "../native";

export type Chrome = "tv" | "mac" | "windows" | "linux" | "tablet" | "phone";

/** A TV: the system says so, or the core does (a Samsung TV's web view looks
 * like a desktop browser to NSH, but the core there runs the TV's player). */
const tv = platform.idiom === "tv" || Settings.device() === "tv";

function detect(): Chrome {
  if (tv) return "tv";
  if (platform.desktop) {
    if (platform.os === "macos") return "mac";
    if (platform.os === "windows") return "windows";
    // Linux, and a desktop browser: no system title bar of reel's own to fit
    // around (`titleBar()` reports no window controls there).
    return "linux";
  }
  return platform.idiom === "phone" ? "phone" : "tablet";
}

export const chrome: Chrome = detect();
export const isDesktop = chrome === "mac" || chrome === "windows" || chrome === "linux";
export const isTouch = chrome === "tablet" || chrome === "phone";

/** Content margin left and right of the safe area, points (desktop 64,
 * tablet 32, phone 20). A TV's comes from its title-safe 5% (`theme.safe`). */
const MARGIN = { mac: 64, windows: 64, linux: 64, tablet: 32, phone: 20 } as const;

/** The horizontal inset of content, points, off a TV: the system's safe area
 * (a landscape phone's notch side) plus the family's margin. */
export function sideInset(): number {
  if (chrome === "tv") throw new Error("a TV's inset is theme.safe()");
  const a = safeArea();
  return Math.max(a.left, a.right) + MARGIN[chrome];
}
