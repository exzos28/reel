// A tablet's row of results (Movies, Shows, Anime, Trending now): its title, then its cards in a
// grid as wide as the page (four across held wide, three upright), the first two rows; Show all N
// opens the rest in place. A phone, a TV and a computer show a row that scrolls sideways instead
// (HomeShelf). `focusedAt`: the card the keys are on (a tablet's keyboard), null elsewhere.
import { computed, View, type ViewRef, type ViewStyle } from "nsh";
import { t } from "nsh/i18n";
import type { Facet, Summary } from "../../catalog";
import { Button } from "../../kit/Button";
import { cellWidth, GRID_GAP, GRID_ROW_GAP, gridRows } from "../../layout/Grid";
import { SectionTitle } from "../../layout/Section";
import { cardColumns } from "../../layout/wide";
import { safe, u } from "../../theme";
import { GridCard } from "../browse/GridCard";

/** Rows shown before Show all. */
const FIRST_ROWS = 2;

const gridStyle = (): ViewStyle => ({ paddingHorizontal: safe().x, gap: u(GRID_ROW_GAP) });
const rowStyle = (): ViewStyle => ({ flexDirection: "row", gap: u(GRID_GAP) });

export function SearchGrid(props: {
  title: () => string;
  items: () => Summary[];
  facet: () => Facet;
  focusedAt: () => number | null;
  blockRef: (r: ViewRef) => void;
  /** Showing them all (Show all pressed). */
  all: () => boolean;
  onAll: () => void;
  onOpen: (at: number) => void;
}) {
  const columns = computed(() => cardColumns());
  /** The first rows, or all of them once asked (or the keys went past them). */
  const shown = () => {
    const first = columns() * FIRST_ROWS;
    const f = props.focusedAt();
    return props.all() || (f != null && f >= first) ? props.items() : props.items().slice(0, first);
  };
  const more = () => props.items().length - shown().length;
  return (
    <View ref={props.blockRef} style={{ gap: u(22) }}>
      <SectionTitle text={props.title} inset />
      <View style={gridStyle()}>
        <Each of={gridRows(shown(), columns())} key={(r) => r.at}>
          {(r) => (
            <View style={rowStyle()}>
              <Each of={r().items} key={(s) => s.id}>
                {(item, c) => (
                  <GridCard
                    item={item}
                    facet={props.facet}
                    width={() => cellWidth(columns(), GRID_GAP)}
                    focused={() => props.focusedAt() === r().at + c()}
                    onPress={() => props.onOpen(r().at + c())}
                  />
                )}
              </Each>
            </View>
          )}
        </Each>
        <If when={more() > 0}>
          <View style={{ flexDirection: "row" }}>
            <Button kind="secondary" label={() => t("search.show_all", { count: props.items().length })} focused={() => false} onPress={props.onAll} />
          </View>
        </If>
      </View>
    </View>
  );
}
