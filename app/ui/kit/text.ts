// Text styles by role: the theme's type scale with the direction's colours.
import type { TextStyle } from "nsh";
import { colors, font, type, u } from "../theme";

/** One line, cut at its end. */
export const oneLine = { numberOfLines: 1 } as TextStyle;

/** Geist at `size` TV pixels (rows and cards that sit between the scale's steps). */
export const fontText = (size: number, color: string, fontWeight = 400): TextStyle => ({
  fontFamily: font,
  fontSize: u(size),
  fontWeight,
  color,
});

export const pageTitle = (): TextStyle => ({ ...type.page(), color: colors.snow() });
export const sectionTitle = (): TextStyle => ({ ...type.section(), color: colors.snow() });
export const bodyText = (color: string = colors.ash()): TextStyle => ({ ...type.body(), color });
export const metaText = (color: string = colors.ash()): TextStyle => ({ ...type.meta(), color });
export const labelText = (color: string = colors.snow()): TextStyle => ({ ...type.label(), color });
