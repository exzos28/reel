// More like this: 16:9 cards as on Home; OK (or a click) opens the title.
import { View } from "nsh";
import { t } from "nsh/i18n";
import type { Summary } from "../../catalog";
import { SectionTitle } from "../../layout/Section";
import { scroller } from "../../layout/Scroller";
import { Shelf } from "../../layout/Shelf";
import { rowReach } from "../../layout/reach";
import { safe, u } from "../../theme";
import { WideCard } from "../home/WideCard";

export function SimilarShelf(props: { items: () => Summary[]; focusedAt: () => number | null; onOpen: (i: number) => void }) {
  /** The row puts the focused card at the left edge of its inset. */
  const line = scroller({ horizontal: true, anchor: () => safe().x });
  const reach = rowReach({ line, focusedAt: props.focusedAt, step: () => u(352 + 24) });
  return (
    <View style={{ gap: u(22) }}>
      <SectionTitle text={() => t("about.similar")} inset />
      <Shelf ctl={line} gap={24} top={0} bottom={24}>
        <Each of={props.items().slice(0, reach())} key={(s) => s.id}>
          {(item, i) => (
            <WideCard
              item={item}
              continuing={false}
              focused={() => props.focusedAt() === i()}
              follow={line.follow}
              onPress={() => props.onOpen(i())}
            />
          )}
        </Each>
      </Shelf>
    </View>
  );
}
