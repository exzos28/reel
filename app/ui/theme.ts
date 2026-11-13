// Direction 3, "Minimal" (design/directions.md): black, white and grey; the
// film is the only colour on screen. Colors come from nsh.json's theme via
// token(); sizes are written in TV pixels and scaled by density.
import { computed, platform, token, windowSize, type TextStyle, type ViewStyle } from "nsh";
import geist from "../fonts/Geist.ttf";

export const font = geist;

export const colors = {
  /** Background. */
  ink: () => token("ink"),
  /** Raised surfaces: rows, cards, chips, panels, icon buttons. */
  card: () => token("card"),
  /** Selected pill or row, secondary button, empty tracks. */
  raise: () => token("raise"),
  /** Text, the Play button, the focus ring. */
  snow: () => token("snow"),
  /** Secondary text. */
  ash: () => token("ash"),
  /** Logo, rating star, "New season" tags; nothing else. */
  red: () => token("red"),
  /** The selected item of the nav pills. */
  nav: () => token("nav"),
  /** Long text (about) and chips. */
  soft: () => token("soft"),
  /** Nav labels that are not selected. */
  dim: () => token("dim"),
  /** One-line episode descriptions. */
  quiet: () => token("quiet"),
  /** Episode numbers. */
  faint: () => token("faint"),
  /** A player button whose panel is open. */
  control: () => token("control"),
};

/** `color` (a token, `#rrggbb` or `#rrggbbaa`) at `opacity`, for gradients and veils. */
export function alpha(color: string, opacity: number) {
  const hex = color.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `rgba(${r},${g},${b},${opacity})`;
}

/** Sizes are written in TV pixels (a 1920-wide ten-foot canvas): `u(72)`.
 * Density decides what one TV pixel is:
 * - ten-foot (TV): the screen is the canvas, so it scales with its width;
 * - regular (Mac) and compact (phone): fixed, so resizing a window reflows the
 *   layout (shelves scroll) instead of zooming it.
 * TODO: the Tizen build runs the web target; detect it as ten-foot there. */
export type Density = "ten-foot" | "regular" | "compact";
export const density: Density =
  platform.idiom === "tv" ? "ten-foot" : platform.idiom === "phone" ? "compact" : "regular";

const FIXED = { regular: 0.825, compact: 0.45 } as const;
const scale = computed(() => (density === "ten-foot" ? windowSize().width / 1920 : FIXED[density]));
export const u = (px: number) => px * scale();

/** Title-safe inset of a TV picture (5%). */
export const safe = () => ({ x: u(96), y: u(54) });

/** Radius of buttons, rows, cards and posters: 10 on a TV, 8 elsewhere. */
export const radius = () => (density === "ten-foot" ? u(10) : u(14));

const text = (size: number, weight: number, extra: TextStyle = {}): TextStyle => ({
  fontFamily: font,
  fontSize: u(size),
  fontWeight: weight,
  ...extra,
});

/** The type scale (TV pixels; nothing below 20 on a TV). */
export const type = {
  /** The film's title as a thin, wide-tracked logotype. */
  logotype: (size: number): TextStyle =>
    text(size, 200, { textTransform: "uppercase", letterSpacing: u(size) * 0.22, lineHeight: u(size) * 1.05 }),
  page: () => text(60, 600, { letterSpacing: -u(1) }),
  section: () => text(30, 600),
  body: () => text(26, 400, { lineHeight: u(36) }),
  label: () => text(24, 500),
  meta: () => text(22, 400),
  small: () => text(20, 400),
};

/** Remote and keyboard focus, the same everywhere: a 3 px `snow` ring with
 * offset, a lift and a deep shadow. `lift` says how: cards rise, rows and
 * buttons grow a little. */
export function focusRing(focused: boolean, lift: "card" | "row" | "button" = "button"): ViewStyle {
  const moved = lift === "card" ? `translateY(${-u(8)}px)` : lift === "row" ? "scale(1.01)" : "scale(1.03)";
  return {
    outlineStyle: "solid",
    outlineWidth: focused ? Math.max(2, u(3)) : 0,
    outlineOffset: u(5),
    outlineColor: colors.snow(),
    boxShadow: focused ? `0 ${u(20)}px ${u(50)}px ${alpha(colors.ink(), 0.7)}` : "none",
    transform: focused ? moved : "none",
    transitionProperty: "transform",
    transitionDuration: 120,
    transitionTimingFunction: "ease-out",
  };
}

/** Selected (active nav item, season tab, chosen release or track): a
 * lighter fill, never a ring. */
export const selectedFill = (selected: boolean, fill = colors.raise()) => (selected ? fill : "transparent");

/** The backdrop fading into the background, bottom and left. */
export const heroFade = (bottomStop = 55, leftStop = 55) =>
  `linear-gradient(0deg, ${colors.ink()} 0%, ${alpha(colors.ink(), 0.85)} 18%, ${alpha(colors.ink(), 0)} ${bottomStop}%), ` +
  `linear-gradient(90deg, ${alpha(colors.ink(), 0.75)} 0%, ${alpha(colors.ink(), 0)} ${leftStop}%)`;
