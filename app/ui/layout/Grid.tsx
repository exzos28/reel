// A grid of cards that fills the safe area's width: as many columns as fit
// at about `cell` TV pixels each.
import { computed, signal, View, windowSize, type JSX, type ViewRef, type ViewStyle } from "nsh";
import { density, safe, u } from "../theme";
import { ultraWide } from "./chrome";
import type { ScrollCtl } from "./scrollCtl";

/** Rows mounted before and after the one in view: the rest are blanks of a row's height,
 * so a grid of hundreds keeps a few dozen cards (and their pictures) in the page. */
const BEFORE = 3;
const AFTER = 6;

export interface GridRow<T> {
  /** The index of its first item among all of them. */
  at: number;
  items: T[];
}

/** The most cards in a row: more make them small and the page heavy to look at. An ultra-wide
 * window's column is narrow for its height (`chrome.ultraWide`): six there are too small, five. */
export const MAX_COLUMNS = 6;
export const MAX_COLUMNS_ULTRA_WIDE = 5;

/** Columns that fit `cell`-wide cards `gap` apart (at least two, at most `MAX_COLUMNS`). */
export function gridColumns(cell: number, gap: number) {
  const width = windowSize().width - 2 * safe().x;
  const most = ultraWide() ? MAX_COLUMNS_ULTRA_WIDE : MAX_COLUMNS;
  return Math.min(most, Math.max(2, Math.floor((width + u(gap)) / (u(cell) + u(gap)))));
}

/** The width of a card in `columns` columns `gap` apart. */
export const cellWidth = (columns: number, gap: number) => (windowSize().width - 2 * safe().x - (columns - 1) * u(gap)) / columns;

/** The 16:9 cards' grid (Films, Series), TV pixels: about this wide, this far apart and between
 * rows. More room on a desktop, where the cards are seen closer and the pointer's ring and preview
 * need space round a card. */
export const GRID_CELL = 326;
export const GRID_GAP = density === "ten-foot" ? 24 : 30;
export const GRID_ROW_GAP = density === "ten-foot" ? 28 : 38;
/** Columns of the grid now. */
export const gridColumnsNow = () => gridColumns(GRID_CELL, GRID_GAP);
/** A grid card's width, points: what a desktop's shelves of 16:9 cards use too (Home), so a shelf
 * and the grid show cards of one size. */
export const gridCardWidth = () => cellWidth(gridColumnsNow(), GRID_GAP);

export function gridRows<T>(all: T[], columns: number): GridRow<T>[] {
  const out: GridRow<T>[] = [];
  for (let i = 0; i < all.length; i += columns) out.push({ at: i, items: all.slice(i, i + columns) });
  return out;
}

const gridStyle = (top: number, rowGap: number): ViewStyle => ({ paddingHorizontal: safe().x, marginTop: u(top), gap: u(rowGap) });

/** `rowRef` follows a row; `cell` draws the item at index `at` of all. Only the rows
 * around the one in view are mounted: the focused row (`focusRow`), else the one the
 * page (`page`) is scrolled to. */
export function Grid<T>(props: {
  rows: () => GridRow<T>[];
  key: (item: T) => string;
  top: number;
  rowGap: number;
  gap: number;
  rowRef: (row: () => GridRow<T>) => (r: ViewRef) => void;
  cell: (item: () => T, at: () => number) => JSX.Element;
  page: ScrollCtl;
  focusRow: () => number | null;
}) {
  /** A row's height (points) and where the grid starts in the page, once measured. */
  const rowHeight = signal(0);
  const gridTop = signal(0);
  let grid: ViewRef | undefined;
  const measure = async (row: ViewRef) => {
    if (rowHeight() || !grid || !props.page.content) return;
    const [r, g, c] = await Promise.all([row.measure(), grid.measure(), props.page.content.measure()]);
    if (!r || !g || !c || r.bounds.size.height <= 0) return;
    gridTop.set(g.pagePosition.y - c.pagePosition.y);
    rowHeight.set(r.bounds.size.height);
  };
  const step = () => rowHeight() + u(props.rowGap);
  const center = computed(() => {
    const f = props.focusRow();
    if (f != null) return f;
    if (!rowHeight()) return 0;
    return Math.max(0, Math.floor(((props.page.offset() ?? 0) - gridTop()) / step()));
  });
  const mounted = (i: number) => {
    if (!rowHeight()) return i < BEFORE + AFTER;
    const c = center();
    return i >= c - BEFORE && i <= c + AFTER;
  };
  return (
    <View ref={(r) => (grid = r)} style={gridStyle(props.top, props.rowGap)}>
      <Each of={props.rows()} key={(r) => r.at}>
        {(r, i) => (
          <If when={mounted(i())} else={<View style={{ height: rowHeight() }} />}>
            <View
              ref={(v: ViewRef) => {
                props.rowRef(r)(v);
                Promise.resolve().then(() => measure(v));
              }}
              style={{ flexDirection: "row", gap: u(props.gap) }}
            >
              <Each of={r().items} key={props.key}>
                {(item, c) => props.cell(item, () => r().at + c())}
              </Each>
            </View>
          </If>
        )}
      </Each>
    </View>
  );
}
