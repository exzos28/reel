// The remote-focus model the screens share: a screen is a column of zones
// (the nav, a hero's actions, shelves, a list...); one is focused, and
// each zone says what the arrows and OK do in it.
import { keymap } from "nsh";
import { byKeys } from "./keys";

export interface ZoneKeys {
  left?: () => void;
  right?: () => void;
  up?: () => void;
  down?: () => void;
  enter?: () => void;
}

/** Binds the arrows (repeating while held) and OK to the focused zone's
 * keys, and Back to `escape` when the screen has one. */
export function useZones<Z extends string>(zone: () => Z, keys: Record<Z, ZoneKeys>, escape?: () => void) {
  const run = (key: keyof ZoneKeys) => () => keys[zone()][key]?.();
  keymap.bind(byKeys({ left: run("left"), right: run("right"), up: run("up"), down: run("down") }), { repeat: true });
  keymap.bind(escape ? { enter: run("enter"), escape } : { enter: run("enter") });
}
