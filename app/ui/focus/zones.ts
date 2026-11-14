// The remote-focus model the screens share: a screen is a column of zones
// (the nav, a hero's actions, shelves, a list...); one is focused, and
// each zone says what the arrows and OK do in it.
import { keymap } from "nsh";
import { onBack } from "../nav";
import { byKeys } from "./keys";

export interface ZoneKeys {
  left?: () => void;
  right?: () => void;
  up?: () => void;
  down?: () => void;
  enter?: () => void;
}

/** Binds the arrows (repeating while held) and OK to the focused zone's
 * keys. `closer` takes Back first while the screen shows (`onBack`): it
 * returns true when it closed something of the screen's (a panel). */
export function useZones<Z extends string>(zone: () => Z, keys: Record<Z, ZoneKeys>, closer?: () => boolean) {
  const run = (key: keyof ZoneKeys) => () => keys[zone()][key]?.();
  keymap.bind(byKeys({ left: run("left"), right: run("right"), up: run("up"), down: run("down") }), { repeat: true });
  keymap.bind({ enter: run("enter") });
  if (closer) onBack(closer);
}
