// More like this: 16:9 cards as on Home; OK (or a click) opens the title.
import { View } from "nsh";
import { t } from "nsh/i18n";
import type { Summary } from "../../catalog";
import { SectionTitle } from "../../layout/Section";
import { scroller } from "../../layout/Scroller";
import { Rail, railLead } from "../../layout/Rail";
import { RowGap, rowWindow } from "../../layout/reach";
import { u } from "../../theme";
import { SHELF_GAP, shelfCardWidth, shelfStep, WideCard } from "../home/WideCard";

export function SimilarShelf(props: { items: () => Summary[]; focusedAt: () => number | null; onOpen: (i: number) => void }) {
  /** The row puts the focused card at the left edge of its inset. */
  const line = scroller({ horizontal: true, anchor: railLead, step: () => step() });
  const step = shelfStep;
  const win = rowWindow({ line, focusedAt: props.focusedAt, step });
  return (
    <View style={{ gap: u(22) }}>
      <SectionTitle text={() => t("about.similar")} inset rail={line} />
      <Rail ctl={line} gap={SHELF_GAP} top={0} bottom={24}>
        <RowGap window={win} step={step} gap={SHELF_GAP} />
        <Each of={props.items().slice(win().from, win().to)} key={(s) => s.id}>
          {(item, i) => (
            <WideCard
              item={item}
              continuing={false}
              focused={() => props.focusedAt() === win().from + i()}
              width={shelfCardWidth}
              follow={line.follow}
              onPress={() => props.onOpen(win().from + i())}
            />
          )}
        </Each>
      </Rail>
    </View>
  );
}
