// Input from the platform: keys and buttons that are the platform's, not the app's,
// turned into the app's actions. One API; the parts this platform has, chosen here:
// - tizen (a TV's web build): the remote's Back (keyCode 10009) becomes Escape; the TV
//   shell is told when the app has drawn (its splash goes then);
// - desktop: the menu bar (macOS) and the navigation shortcuts;
// - android: the system back (touch: the system's rule; Android TV: the app's Back).
// Escape itself (every platform's Back key) is bound by the app; focus and the screens'
// keys stay in `ui/focus`.
import type { Destination } from "../nav";
import { caps, runtime } from ".";
import { androidInput } from "./remote.android";
import { desktopInput } from "./remote.desktop";
import { tizenInput } from "./remote.tizen";

/** What platform input does in the app. */
export interface InputActions {
  /** Back, through what is open first. */
  back: () => void;
  /** Android's back on touch: true when the app took it, false to let the system pop. */
  systemBack: () => boolean;
  /** To a destination of the nav. */
  go: (to: Destination) => void;
}

export interface PlatformInput {
  /** Before the app mounts: keys the platform sends that the app's keymap does not know. */
  mapKeys?(): void;
  /** While the app renders: the platform's shortcuts and back buttons. */
  bind?(actions: InputActions): void;
  /** Once the app has drawn. */
  drawn?(): void;
}

const parts: PlatformInput[] = [
  ...(runtime.web ? [tizenInput] : []),
  ...(caps.shortcuts ? [desktopInput] : []),
  ...(runtime.os === "android" ? [androidInput] : []),
];

/** Before the app mounts. */
export function mapPlatformKeys() {
  for (const p of parts) p.mapKeys?.();
}

/** In the app's root, once. */
export function bindPlatformInput(actions: InputActions) {
  for (const p of parts) p.bind?.(actions);
}

/** After the app has mounted. */
export function appDrawn() {
  for (const p of parts) p.drawn?.();
}
