// The "Projector" direction (design/directions.md): the room is dark, the
// focused thing is lit. Colors come from nsh.json's theme via token().
import { computed, platform, token, windowSize } from "nsh";
import "../fonts/Unbounded.ttf";
import "../fonts/GolosText.ttf";

export const fonts = {
  display: "Unbounded",
  body: "Golos Text",
};

export const colors = {
  hall: () => token("background"),
  seat: () => token("card"),
  line: () => token("border"),
  screen: () => token("foreground"),
  dim: () => token("muted-foreground"),
  beam: () => token("primary"),
  alert: () => token("destructive"),
};

/** Sizes are written in TV pixels (a 1920-wide ten-foot canvas): `u(72)`.
 * Density decides what one TV pixel is:
 * - ten-foot (TV): the screen is the canvas, so it scales with its width;
 * - regular (Mac) and compact (phone): fixed, so resizing a window reflows the
 *   layout (shelves scroll) instead of zooming it.
 * TODO: the Tizen build runs the web target; detect it as ten-foot there. */
export type Density = "ten-foot" | "regular" | "compact";
export const density: Density =
  platform.idiom === "tv" ? "ten-foot" : platform.idiom === "phone" ? "compact" : "regular";

const FIXED = { regular: 0.55, compact: 0.45 } as const;
const scale = computed(() =>
  density === "ten-foot" ? windowSize().width / 1920 : FIXED[density],
);
export const u = (px: number) => px * scale();

export const type = {
  caption: () => ({ fontFamily: fonts.body, fontSize: u(28), lineHeight: u(36) }),
  body: () => ({ fontFamily: fonts.body, fontSize: u(34), lineHeight: u(48) }),
  subtitle: () => ({ fontFamily: fonts.body, fontSize: u(44), fontWeight: "600" as const }),
  title: () => ({ fontFamily: fonts.display, fontSize: u(72), lineHeight: u(84), fontWeight: "700" as const }),
};

export const radius = { control: 10, poster: 6, sheet: 20 };

/** Title-safe inset of a TV picture (5%). */
export const safe = () => ({ x: u(96), y: u(54) });
