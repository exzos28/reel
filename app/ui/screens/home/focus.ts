// Home's focus, kept while other screens show, so coming back finds it
// where it was: the nav, the hero's actions, or a card on a shelf (each
// shelf remembers the card it was left on).
import { signal } from "nsh";
import { rowMemory } from "../../focus/memory";

export type Zone = "nav" | "hero" | "shelves";

export const zone = signal<Zone>("shelves");
export const navAt = signal(0);
export const heroAt = signal(0);
export const row = signal(0);
export const cols = rowMemory();
