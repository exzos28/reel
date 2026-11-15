import { View, type ViewRef } from "nsh";
import { t } from "nsh/i18n";
import type { Shelf as ShelfData } from "../../catalog";
import { SectionTitle } from "../../layout/Section";
import { LazyBlock } from "../../layout/LazyBlock";
import { scroller, type ScrollCtl } from "../../layout/Scroller";
import { Rail } from "../../layout/Rail";
import { RowGap, rowWindow } from "../../layout/reach";
import { safe, u } from "../../theme";
import { WideCard } from "./WideCard";

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
  const line = scroller({ horizontal: true, anchor: () => safe().x });
  const step = () => u(352 + 24);
  const win = rowWindow({ line, focusedAt: props.focusedAt, step });
  return (
    <View ref={props.blockRef} style={{ gap: u(22) }}>
      <SectionTitle text={props.title ?? (() => t(`shelf.${props.shelf().id}`))} inset />
      <LazyBlock page={props.page} eager={props.eager} height={() => u(198 + 110)}>
      <Rail ctl={line} gap={24} top={0} bottom={24}>
        <RowGap window={win} step={step} gap={24} />
        <Each of={props.shelf().items.slice(win().from, win().to)} key={(f) => f.id}>
          {(item, c) => (
            <WideCard
              item={item}
              continuing={props.shelf().id === "continue"}
              focused={() => props.focusedAt() === win().from + c()}
              follow={line.follow}
              onPress={() => props.onOpen(win().from + c())}
            />
          )}
        </Each>
      </Rail>
      </LazyBlock>
    </View>
  );
}
