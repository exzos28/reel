// Where the focus was: an index kept within its list, a column per row.
import { signal } from "nsh";

/** `v` kept within `first..last`. */
export const clamp = (v: number, last: number, first = 0) => Math.min(Math.max(v, first), last);

/** The column each row was left on, so coming back to a row focuses it. */
export function rowMemory() {
  const cols = signal<number[]>([]);
  return {
    at: (row: number) => cols()[row] ?? 0,
    set(row: number, col: number, last: number) {
      const next = [...cols()];
      next[row] = clamp(col, last);
      cols.set(next);
    },
  };
}
