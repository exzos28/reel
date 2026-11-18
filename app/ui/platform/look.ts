// How the platform draws: rendering that differs for performance or for the system's own
// look. Styles ask these, never the platform.
import { family, standIn } from ".";
import { runtime } from "./runtime";

export const look = {
  /** Blurred shadows (the focus's): none in a TV's web view, where repainting them on
   * every scrolled frame is the most its browser struggles with. */
  // A browser standing in for a desktop or a phone draws them as that platform does.
  blurShadows: !runtime.web || (standIn && family !== "tv"),
  /** The system's design language for touch's bars: Android's Material, else iOS's. */
  system: runtime.os === "android" ? ("material" as const) : ("ios" as const),
};
