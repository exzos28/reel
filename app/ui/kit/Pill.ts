// A pill in a row of choices: the nav's destinations, a show's seasons.
import type { ViewStyle } from "nsh";
import { cs, focusRing, ringRoom, targetSlop, u } from "../theme";
import { rounded, row } from "./shape";

const PILL = 52;
/** Pills that wrap onto more lines (recent searches), `gap` TV pixels apart, with room for the ring. */
export const pillWrap = (gap: number): ViewStyle => ({ flexDirection: "row", flexWrap: "wrap", gap: u(gap), paddingVertical: ringRoom() / 2 });
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
