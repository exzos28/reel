import { View, type ViewRef } from "nsh";
import { airsText, type Facet, type Summary } from "../../catalog";
import { scroller, type ScrollCtl } from "../../layout/Scroller";
import { Rail, railLead } from "../../layout/Rail";
import { RowGap, rowWindow } from "../../layout/reach";
import { u } from "../../theme";
import { PosterCard, posterWidth } from "./PosterCard";
import { SectionTitle } from "../../layout/Section";

/** The trending row of posters (with `airs`, a poster says when its next
 * episode airs).
 * `focusedAt`: the poster the focus is on, null while it is elsewhere. */
export function Trending(props: {
  /** The row's title ("Trending"). */
  title: () => string;
  items: () => Summary[];
  facet: () => Facet;
  airs: boolean;
  focusedAt: () => number | null;
  blockRef: (r: ViewRef) => void;
  onOpen: (i: number) => void;
  /** The page's scroll: the wheel up and down over the row moves it. */
  page: ScrollCtl;
}) {
  /** The row puts the focused poster at the left edge of its inset. */
  const line = scroller({ horizontal: true, anchor: railLead, step: () => step() });
  const step = () => posterWidth() + u(20);
  const win = rowWindow({ line, focusedAt: props.focusedAt, step });
  return (
    <View ref={props.blockRef}>
      <View style={{ marginTop: u(34) }}>
        <SectionTitle text={props.title} inset rail={line} />
      </View>
      <Rail ctl={line} page={props.page} gap={20} top={26} bottom={16}>
        <RowGap window={win} step={step} gap={20} />
        <Each of={props.items().slice(win().from, win().to)} key={(s) => s.id}>
          {(item, i) => (
            <PosterCard
              item={item}
              sub={() => (props.airs ? airsText(item()) : null)}
              facet={props.facet}
              focused={() => props.focusedAt() === win().from + i()}
              follow={line.follow}
              onPress={() => props.onOpen(win().from + i())}
            />
          )}
        </Each>
      </Rail>
    </View>
  );
}
