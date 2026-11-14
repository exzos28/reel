// Where a scroll view goes so a focused block sits at its anchor: the pure
// offset math behind `Scroller`, kept apart so tests can check it alone.

export interface AnchorInput {
  /** The block's start and end along the axis, in content coordinates. */
  start: number;
  end: number;
  /** The viewport's length and the content's length along the axis. */
  viewport: number;
  content: number;
  /** Where the block's start should sit, from the viewport's start. */
  anchor: number;
  /** Room kept around the block at both edges (the focus ring and its lift). */
  pad: number;
}

/** The offset that puts the block's start at `anchor`, moved as little as
 * needed to show the whole block (with `pad` around it; its start wins when
 * it is longer than the viewport), within the content's ends. */
export function anchorOffset(o: AnchorInput): number {
  let at = o.start - o.anchor;
  if (o.end + o.pad - at > o.viewport) at = o.end + o.pad - o.viewport;
  if (o.start - o.pad < at) at = o.start - o.pad;
  const max = Math.max(0, o.content - o.viewport);
  return Math.min(Math.max(at, 0), max);
}

/** The offset nearest to `current` that shows the whole block (with `pad`
 * around it; its start wins when it is longer than the viewport). */
export function nearestOffset(o: Omit<AnchorInput, "anchor">, current: number): number {
  let at = current;
  if (o.end + o.pad - at > o.viewport) at = o.end + o.pad - o.viewport;
  if (o.start - o.pad < at) at = o.start - o.pad;
  const max = Math.max(0, o.content - o.viewport);
  return Math.min(Math.max(at, 0), max);
}

/** Ease-out cubic, 0..1 to 0..1. */
export const easeOut = (p: number) => 1 - (1 - p) ** 3;
