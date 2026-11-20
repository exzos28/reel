import { View, type ViewRef } from "nsh";
import { t } from "nsh/i18n";
import type { Shelf as ShelfData } from "../../catalog";
import { SectionTitle } from "../../layout/Section";
import { LazyBlock } from "../../layout/LazyBlock";
import { scroller, type ScrollCtl } from "../../layout/Scroller";
import { Rail, railLead } from "../../layout/Rail";
import { RowGap, rowWindow } from "../../layout/reach";
import { u } from "../../theme";
import { SHELF_GAP, shelfCardWidth, shelfStep, WideCard, wideCardHeight } from "./WideCard";

/** A shelf's title and its row of 16:9 cards. `focusedAt`: the card the
 * focus is on, null while it is elsewhere. The title is `shelf.<id>` unless
 * `title` says (Search's rows). */
export function HomeShelf(props: {
  shelf: () => ShelfData;
  focusedAt: () => number | null;
  blockRef: (r: ViewRef) => void;
  onOpen: (col: number) => void;
  /** The page's scroll: the row of cards mounts when the page nears it. */
  page: ScrollCtl;
  eager?: boolean;
  title?: () => string;
}) {
  /** The shelf puts the focused card at the left edge of its inset. */
  const line = scroller({ horizontal: true, anchor: railLead, step: () => step() });
  const step = shelfStep;
  const win = rowWindow({ line, focusedAt: props.focusedAt, step });
  return (
    <View ref={props.blockRef} style={{ gap: u(22) }}>
      <SectionTitle text={props.title ?? (() => t(`shelf.${props.shelf().id}`))} inset rail={line} />
      <LazyBlock page={props.page} eager={props.eager} height={() => wideCardHeight(shelfCardWidth()) + u(110)}>
      <Rail ctl={line} page={props.page} gap={SHELF_GAP} top={0} bottom={24}>
        <RowGap window={win} step={step} gap={SHELF_GAP} />
        <Each of={props.shelf().items.slice(win().from, win().to)} key={(f) => f.id}>
          {(item, c) => (
            <WideCard
              item={item}
              continuing={props.shelf().id === "continue"}
              facet={() => props.shelf().facet}
              focused={() => props.focusedAt() === win().from + c()}
              width={shelfCardWidth}
              follow={line.follow}
              page={props.page}
              onPress={() => props.onOpen(win().from + c())}
            />
          )}
        </Each>
      </Rail>
      </LazyBlock>
    </View>
  );
}
