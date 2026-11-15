// Settings' and About's parts share one width and one field look.
import type { InputStyle } from "nsh";
import { alpha, colors, cs, type, u } from "../theme";
import { rounded } from "./shape";

/** How wide a form's text, rows and fields run: a line that reads well. */
export const formWidth = () => u(980);

/** A text field on a `card` surface, its caret and selection in the theme's white (not the
 * system's accent), its placeholder in the theme's grey (Android drew it dark). */
export const fieldStyle = (): InputStyle => ({
  height: cs(64),
  paddingHorizontal: cs(22),
  ...rounded(),
  backgroundColor: colors.card(),
  color: colors.snow(),
  placeholderColor: colors.ash(),
  caretColor: colors.snow(),
  selectionColor: alpha(colors.snow(), 0.3),
  ...type.body(),
});
