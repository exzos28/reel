// The app's window: its frame (title bar, reel's window bar, drag strips) and full
// screen. One API; the implementation chosen here:
// - desktop (window.desktop.tsx): macOS, Windows, Linux;
// - touch: the player takes the whole screen while it is up (Android hides the system bars);
// - none: a TV, where the app is the screen.
// Full screen follows NSH's desktop behaviour (`runtime.desktop`), which a TV's web build
// has too; whether the player offers it (button, F) is `caps.fullscreen`.
import { cleanup, type JSX } from "nsh";
import { VideoEngine } from "../native";
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

/** Touch: full screen while the player is up, back when it goes; nothing to switch (the
 * player offers no button there, and Back closes it). */
const playerScreen = (): Fullscreen => {
  VideoEngine.fullscreen(true);
  cleanup(() => VideoEngine.fullscreen(false));
  return noFullscreen();
};

/** The window's full screen, for a component that offers it (the player): left as it
 * was found when the component goes. */
export const useFullscreen: () => Fullscreen = runtime.desktop ? windowFullscreen : caps.touch ? playerScreen : noFullscreen;
