// A pill in a row of choices: the nav's destinations, a show's seasons.
import type { ViewStyle } from "nsh";
import { cs, focusRing, targetSlop, u } from "../theme";
import { rounded, row } from "./shape";

const PILL = 52;
/** A pill's `hitSlop` on touch (a 44 / 48 pt target). */
export const pillSlop = () => targetSlop(cs(PILL));

/** `fill` says whether it is the selected one; focus is the ring. */
export const pillStyle = (fill: string, focused: boolean, paddingX: number): ViewStyle => ({
  ...row(u(10)),
  height: cs(PILL),
  paddingHorizontal: cs(paddingX),
  ...rounded(),
  backgroundColor: fill,
  ...focusRing(focused),
});
