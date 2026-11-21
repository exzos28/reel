// The box a view lays itself out in: the window, or the phone's player drawn sideways inside its
// upright window (`TurnedBox`). What reads the window's size and the system's insets for a layout
// the player shows (its controls, its drawers, the subtitles, `chrome`'s side insets and so
// `theme.safe`) reads them here, so inside the turned box they are the box's: its own size, and
// the screen's insets on the sides they are on once turned. A pan in it is the box's too
// (`boxPan`), where the platform measures pans on the screen.
import { context, safeArea, windowSize, type AnimatedValue, type PanEvent, type Point } from "nsh";
import { caps } from "../platform";

export interface Edges {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface Surface {
  /** Its size, points. */
  size: () => { width: number; height: number };
  /** The system's insets on its edges, points. */
  insets: () => Edges;
  /** Turned a quarter inside the window: a modal (NSH's `Sheet`, a dialog of its own) shows the
   * window's way up, so what opens over it is drawn in place instead. */
  turned: () => boolean;
  /** How far it is turned, degrees clockwise: 0, 90 or -90. */
  angle: () => number;
}

/** The window as it is: what everything outside the turned player reads. */
export const SurfaceContext = context<Surface>({ size: windowSize, insets: safeArea, turned: () => false, angle: () => 0 });

export const surfaceSize = () => SurfaceContext().size();
export const surfaceInsets = () => SurfaceContext().insets();
export const surfaceTurned = () => SurfaceContext().turned();

/** The screen's `insets` on the edges of a box turned `angle` degrees clockwise inside it (90: the
 * box's left edge is the screen's top). */
export function turnedInsets(insets: Edges, angle: number): Edges {
  if (angle === 90) return { top: insets.right, right: insets.bottom, bottom: insets.left, left: insets.top };
  if (angle === -90) return { top: insets.left, right: insets.top, bottom: insets.right, left: insets.bottom };
  return insets;
}

/** A point measured on the screen (a pan's translation, its speed) in the axes of a box turned
 * `angle` degrees clockwise inside it (90: the box's x runs down the screen, its y to the
 * screen's left). */
export function turnedPoint(p: Point, angle: number): Point {
  if (angle === 90) return { x: p.y, y: -p.x };
  if (angle === -90) return { x: -p.y, y: p.x };
  return p;
}

export interface BoxPan {
  /** The view's `pan`: `value` bound to the platform's axis that runs along the box's (which
   * also decides which moves start the pan). */
  bind: () => { x?: AnimatedValue; y?: AnimatedValue };
  /** -1 where the bound value grows against the box's axis, else 1. */
  sign: () => 1 | -1;
  /** A pan's event in the box's axes. */
  event: (e: PanEvent) => PanEvent;
}

/** A pan along `axis` of the box the view is in, driving `value`. iOS measures a pan in the
 * view's superview, so in the box; NSH's Android runtime on the screen (`caps.panOnScreen`), so
 * in the turned player the box's x is the screen's y and its y the screen's x, one of them the
 * other way round. Read where the view renders (it reads the view's box). */
export function boxPan(axis: "x" | "y", value: AnimatedValue): BoxPan {
  const surface = SurfaceContext();
  const angle = () => (caps.panOnScreen ? surface.angle() : 0);
  /** The screen's axis along the box's, and which way. */
  const along = (): { axis: "x" | "y"; sign: 1 | -1 } => {
    const a = angle();
    if (a === 0) return { axis, sign: 1 };
    const unit = turnedPoint(axis === "x" ? { x: 0, y: 1 } : { x: 1, y: 0 }, a);
    return { axis: axis === "x" ? "y" : "x", sign: (axis === "x" ? unit.x : unit.y) < 0 ? -1 : 1 };
  };
  return {
    bind: () => (along().axis === "x" ? { x: value } : { y: value }),
    sign: () => along().sign,
    event: (e) => {
      const a = angle();
      if (a === 0) return e;
      const { axis: on, sign } = along();
      const bound = e.value?.[on];
      return {
        ...e,
        translation: turnedPoint(e.translation, a),
        velocity: turnedPoint(e.velocity, a),
        value: bound == null ? undefined : axis === "x" ? { x: sign * bound } : { y: sign * bound },
      };
    },
  };
}
