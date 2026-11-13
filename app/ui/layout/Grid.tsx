// A grid of cards that fills the safe area's width: as many columns as fit
// at about `cell` TV pixels each.
import { View, windowSize, type JSX, type ViewRef, type ViewStyle } from "nsh";
import { safe, u } from "../theme";

export interface GridRow<T> {
  /** The index of its first item among all of them. */
  at: number;
  items: T[];
}

/** Columns that fit `cell`-wide cards `gap` apart (at least two). */
export function gridColumns(cell: number, gap: number) {
  const width = windowSize().width - 2 * safe().x;
  return Math.max(2, Math.floor((width + u(gap)) / (u(cell) + u(gap))));
}

/** The width of a card in `columns` columns `gap` apart. */
export const cellWidth = (columns: number, gap: number) => (windowSize().width - 2 * safe().x - (columns - 1) * u(gap)) / columns;

export function gridRows<T>(all: T[], columns: number): GridRow<T>[] {
  const out: GridRow<T>[] = [];
  for (let i = 0; i < all.length; i += columns) out.push({ at: i, items: all.slice(i, i + columns) });
  return out;
}

const gridStyle = (top: number, rowGap: number): ViewStyle => ({ paddingHorizontal: safe().x, marginTop: u(top), gap: u(rowGap) });

/** `rowRef` follows a row; `cell` draws the item at index `at` of all. */
export function Grid<T>(props: {
  rows: () => GridRow<T>[];
  key: (item: T) => string;
  top: number;
  rowGap: number;
  gap: number;
  rowRef: (row: () => GridRow<T>) => (r: ViewRef) => void;
  cell: (item: () => T, at: () => number) => JSX.Element;
}) {
  return (
    <View style={gridStyle(props.top, props.rowGap)}>
      <Each of={props.rows()} key={(r) => r.at}>
        {(r) => (
          <View ref={props.rowRef(r)} style={{ flexDirection: "row", gap: u(props.gap) }}>
            <Each of={r().items} key={props.key}>
              {(item, c) => props.cell(item, () => r().at + c())}
            </Each>
          </View>
        )}
      </Each>
    </View>
  );
}
