// A pill in a row of choices: the nav's destinations, a show's seasons.
import type { ViewStyle } from "nsh";
import { focusRing, u } from "../theme";
import { rounded, row } from "./shape";

/** `fill` says whether it is the selected one; focus is the ring. */
export const pillStyle = (fill: string, focused: boolean, paddingX: number): ViewStyle => ({
  ...row(u(10)),
  height: u(52),
  paddingHorizontal: u(paddingX),
  ...rounded(),
  backgroundColor: fill,
  ...focusRing(focused),
});
