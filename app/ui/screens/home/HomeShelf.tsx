import { View, type ViewRef } from "nsh";
import { t } from "nsh/i18n";
import type { Shelf as ShelfData } from "../../catalog";
import { SectionTitle } from "../../layout/Section";
import { scroller } from "../../layout/Scroller";
import { Shelf } from "../../layout/Shelf";
import { safe, u } from "../../theme";
import { WideCard } from "./WideCard";

/** A shelf's title and its row of 16:9 cards. `focusedAt`: the card the
 * focus is on, null while it is elsewhere. */
export function HomeShelf(props: {
  shelf: () => ShelfData;
  focusedAt: () => number | null;
  blockRef: (r: ViewRef) => void;
  onOpen: (col: number) => void;
}) {
  /** The shelf puts the focused card at the left edge of its inset. */
  const line = scroller({ horizontal: true, anchor: () => safe().x });
  return (
    <View ref={props.blockRef} style={{ gap: u(22) }}>
      <SectionTitle text={() => t(`shelf.${props.shelf().id}`)} inset />
      <Shelf ctl={line} gap={24} top={0} bottom={24}>
        <Each of={props.shelf().items} key={(f) => f.id}>
          {(item, c) => (
            <WideCard
              item={item}
              continuing={props.shelf().id === "continue"}
              focused={() => props.focusedAt() === c()}
              follow={line.follow}
              onPress={() => props.onOpen(c())}
            />
          )}
        </Each>
      </Shelf>
    </View>
  );
}
