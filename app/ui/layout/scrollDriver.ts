// What moves a scroll view to an offset: one API, one implementation per platform.
// - steps (native apps): the scroll view's own offset, stepped every animation frame with
//   an ease-out;
// - slide (a TV's web build): its content moved by a CSS transform transition, which the
//   browser's compositor runs alone, smooth however busy the page's thread is.
// `scrollCtl` decides where to go; a driver only goes there.
import { platform, type ScrollRef } from "nsh";
import { density } from "../theme";
import { slideDriver } from "./scrollDriver.slide";
import { stepDriver } from "./scrollDriver.steps";

export interface ScrollDriver {
  /** Goes to `target` (points): at once, or gliding. */
  to(target: number, animate: boolean): void;
  /** Stops a glide where it is (the viewer took over). */
  stop(): void;
  /** Gliding now (where it is comes from the driver, not from a measure). */
  moving(): boolean;
  /** The offset it was last sent to or measured at. */
  at(): number;
  /** The offset measured while it stands still. */
  sync(offset: number): void;
}

export interface DriverHost {
  horizontal: boolean;
  scroll: () => ScrollRef | undefined;
  /** The scroll view's `testID` (its element on the web). */
  domId: string;
  /** Where the view rests after a move: for what watches its offset. */
  rest(offset: number): void;
}

export const scrollDriver: (host: DriverHost) => ScrollDriver =
  platform.os === "web" && density === "ten-foot" ? slideDriver : stepDriver;
