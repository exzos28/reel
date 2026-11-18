// Direction 3, "Minimal" (design/directions.md): black, white and grey; the
// film is the only colour on screen. Colors come from nsh.json's theme via
// token(); sizes are written in TV pixels and scaled by density.
import { computed, token, windowSize, type TextStyle, type ViewStyle } from "nsh";
import geist from "../fonts/Geist.ttf";
import { centering, chrome, sideInset } from "./layout/chrome";
import { keysInUse } from "./focus/keys";
import { look } from "./platform/look";

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
 * - regular (desktop, tablet) and compact (phone): fixed, so resizing a window
 *   reflows the layout (shelves scroll) instead of zooming it. */
export type Density = "ten-foot" | "regular" | "compact";
export const density: Density = chrome === "tv" ? "ten-foot" : chrome === "phone" ? "compact" : "regular";

const FIXED = { regular: 0.66, compact: 0.45 } as const;
const scale = computed(() => (density === "ten-foot" ? windowSize().width / 1920 : FIXED[density]));
export const u = (px: number) => px * scale();
/** Type sizes (font size, line height). The same as `u` but on a phone, where the layout's
 * 0.45 made body text 12 pt and meta 10 pt: there text scales by 0.6 (body 15.6 pt). */
const TEXT_COMPACT = 0.6;
export const ts = (px: number) => (density === "compact" ? px * TEXT_COMPACT : u(px));
/** Control sizes (buttons, pills, fields, rows, icons): the same as `u` but on a phone, where
 * the layout's 0.45 made a 60 px button 27 pt, under a finger's 44: there they scale by 0.75. */
const CONTROL_COMPACT = 0.75;
export const cs = (px: number) => (density === "compact" ? px * CONTROL_COMPACT : u(px));
/** An `Icon`'s size for a size in points (`Icon` scales its size by `cs`). */
export const iconPt = (points: number) => points / cs(1);

/** The smallest a touch target may be, points: Material's 48, iOS's 44; a remote and a mouse
 * need none. Controls keep their look and reach the rest with `hitSlop` (`targetSlop`). */
export const MIN_TARGET = chrome === "phone" || chrome === "tablet" ? (look.system === "material" ? 48 : 44) : 0;
/** The `hitSlop` a control `size` points across (its smaller side) needs to be a touch target. */
export const targetSlop = (size: number) => Math.max(0, Math.ceil((MIN_TARGET - size) / 2));

/** Where content starts from the screen's edges: a TV picture's title-safe
 * 5%; elsewhere the system's safe area plus the family's margin (`chrome`). */
export const safe = () => ({ x: chrome === "tv" ? u(96) : sideInset(), y: u(54) });

/** The max width (`px`, TV pixels) of a block padded by `safe().x` on both sides (the hero's
 * text, a title's about): on a wide desktop window the larger inset moves the block to the
 * content column instead of narrowing its text (`chrome.centering`); elsewhere it is `u(px)`. */
export const insetMaxWidth = (px: number) => u(px) + 2 * centering();

/** Radius of buttons, rows, cards and posters: 10 on a TV, 8 elsewhere. */
export const radius = () => (density === "ten-foot" ? u(10) : u(14));

const text = (size: number, weight: number, extra: TextStyle = {}): TextStyle => ({
  fontFamily: font,
  fontSize: ts(size),
  fontWeight: weight,
  ...extra,
});

/** The type scale (TV pixels; nothing below 20 on a TV). */
export const type = {
  /** The film's title as a thin, wide-tracked logotype. */
  logotype: (size: number): TextStyle =>
    text(size, 200, { textTransform: "uppercase", fontSize: u(size), letterSpacing: u(size) * 0.22, lineHeight: u(size) * 1.05 }),
  page: () => text(60, 600, { letterSpacing: -u(1) }),
  section: () => text(30, 600),
  body: () => text(26, 400, { lineHeight: ts(36) }),
  label: () => text(24, 500),
  meta: () => text(22, 400),
  small: () => text(20, 400),
};

/** Remote and keyboard focus, the same everywhere: a 3 px `snow` ring with
 * offset, a lift and a deep shadow. `lift` says how: cards rise, rows and
 * buttons grow a little. */
/** Room a scroll view must leave around its items so the focus ring (offset,
 * width) and the card lift are not cut off by its edges. */
export const ringRoom = () => u(8 + 5 + 4) + Math.max(2, u(3));

/** Whether the focus shows: always on a TV (the remote is all there is), elsewhere only while
 * the keys drive (not after a tap or a click, where a ring on what was pressed is noise). */
export const showFocus = () => chrome === "tv" || keysInUse();

export function focusRing(shownFocus: boolean, lift: "card" | "row" | "button" = "button"): ViewStyle {
  const focused = shownFocus && showFocus();
  const moved = lift === "card" ? `translateY(${-u(8)}px)` : lift === "row" ? "scale(1.01)" : "scale(1.03)";
  return {
    outlineStyle: "solid",
    outlineWidth: focused ? Math.max(2, u(3)) : 0,
    outlineOffset: u(5),
    outlineColor: colors.snow(),
    // No blurred shadow where the platform cannot afford it (look.blurShadows): the ring
    // and the lift show the focus.
    boxShadow: focused && look.blurShadows ? `0 ${u(20)}px ${u(50)}px ${alpha(colors.ink(), 0.7)}` : "none",
    transform: focused ? moved : "none",
    // The ring and its shadow draw over the neighbours (a row of pills, tabs).
    zIndex: focused ? 2 : 0,
    transitionProperty: "transform",
    transitionDuration: 120,
    transitionTimingFunction: "ease-out",
  };
}

/** Under the pointer: the focus's white ring alone (no lift, no shadow), over a view styled with
 * `focusRing`, whose offset it keeps. An outline, so it takes no room and moves nothing. */
export const hoverRing = (): ViewStyle => ({ outlineWidth: Math.max(2, u(3)), outlineColor: colors.snow() });

/** Selected (active nav item, season tab, chosen release or track): a
 * lighter fill, never a ring. */
export const selectedFill = (selected: boolean, fill = colors.raise()) => (selected ? fill : "transparent");

/** The backdrop fading into the background, bottom and left. */
export const heroFade = (bottomStop = 55, leftStop = 55) =>
  `linear-gradient(0deg, ${colors.ink()} 0%, ${alpha(colors.ink(), 0.85)} 18%, ${alpha(colors.ink(), 0)} ${bottomStop}%), ` +
  `linear-gradient(90deg, ${alpha(colors.ink(), 0.75)} 0%, ${alpha(colors.ink(), 0)} ${leftStop}%)`;
