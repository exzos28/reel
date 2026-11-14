// The app's window: its frame (title bar, reel's window bar, drag strips) and full
// screen. One API; the implementation chosen here:
// - desktop (window.desktop.tsx): macOS, Windows, Linux;
// - none: a TV and touch, where the app is the screen.
// Full screen follows NSH's desktop behaviour (`runtime.desktop`), which a TV's web build
// has too; whether the player offers it (button, F) is `caps.fullscreen`.
import type { JSX } from "nsh";
import { caps, runtime } from ".";
import { DesktopFrame, hideTitleBar, windowFullscreen } from "./window.desktop";

export interface WindowFrameProps {
  /** A film plays (the player has the screen). */
  playing: () => boolean;
}

export interface Fullscreen {
  /** The window fills the screen. */
  on: () => boolean;
  set: (on: boolean) => void;
}

/** Once, as the app renders: the window's own frame. */
export const setupWindow: () => void = caps.windowBar ? hideTitleBar : () => {};

/** What the platform draws around the app: a desktop's window bar (or the player's drag
 * strips); nothing elsewhere. */
export const WindowFrame: (props: WindowFrameProps) => JSX.Element | null = caps.windowBar ? DesktopFrame : () => null;

const noFullscreen = (): Fullscreen => ({ on: () => false, set: () => {} });

/** The window's full screen, for a component that offers it (the player): left as it
 * was found when the component goes. */
export const useFullscreen: () => Fullscreen = runtime.desktop ? windowFullscreen : noFullscreen;
