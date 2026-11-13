// A full-width row on a `card` surface: releases, episodes, buffer sizes.
import type { ViewStyle } from "nsh";
import { colors, focusRing } from "../theme";
import { rounded, row } from "./shape";

/** Selected is the lighter fill (with a check beside it); focus is the ring. */
export const rowStyle = (selected: boolean, focused: boolean, gap = 0): ViewStyle => ({
  ...row(gap),
  ...rounded(),
  backgroundColor: selected ? colors.raise() : colors.card(),
  ...focusRing(focused, "row"),
});
