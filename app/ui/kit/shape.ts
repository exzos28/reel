// Shapes every component shares: the direction's continuous corners, a
// view covering its parent, a row of children.
import type { ViewStyle } from "nsh";
import { radius, u } from "../theme";

/** Continuous corners, the shared radius unless `r` says otherwise. */
export const rounded = (r: number = radius()): ViewStyle => ({ borderRadius: r, borderCurve: "continuous" });

/** A card's corners: a little rounder than the shared radius. */
export const cardRadius = () => radius() + u(4);

/** Covers its parent. */
export const cover = (): ViewStyle => ({ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 });

/** Children side by side, `gap` apart. */
export const row = (gap: number, alignItems: ViewStyle["alignItems"] = "center"): ViewStyle => ({
  flexDirection: "row",
  alignItems,
  gap,
});
