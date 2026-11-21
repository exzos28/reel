// The box a view lays itself out in: the window, or the phone's player drawn sideways inside its
// upright window (`TurnedBox`). What reads the window's size and the system's insets for a layout
// the player shows (its controls, its drawers, the subtitles, `chrome`'s side insets and so
// `theme.safe`) reads them here, so inside the turned box they are the box's: its own size, and
// the screen's insets on the sides they are on once turned.
import { context, safeArea, windowSize } from "nsh";

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
}

/** The window as it is: what everything outside the turned player reads. */
export const SurfaceContext = context<Surface>({ size: windowSize, insets: safeArea, turned: () => false });

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
