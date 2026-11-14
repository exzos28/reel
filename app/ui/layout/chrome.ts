// The platform family reel lays its frame out for (design/navigation.md,
// "Platform families"): where the nav sits, where Back is, how panels open.
import { safeArea } from "nsh";
import { family, type Family } from "../platform";

export type Chrome = Family;

/** Which family this is: the platform layer's (ui/platform). */
export const chrome: Chrome = family;
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
