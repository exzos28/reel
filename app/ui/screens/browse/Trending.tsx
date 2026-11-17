import { View, type ViewRef } from "nsh";
import { airsText, type Summary } from "../../catalog";
import { scroller } from "../../layout/Scroller";
import { Rail } from "../../layout/Rail";
import { RowGap, rowWindow } from "../../layout/reach";
import { safe, u } from "../../theme";
import { PosterCard, posterWidth } from "./PosterCard";
import { SectionTitle } from "../../layout/Section";

/** The trending row of posters (with `airs`, a poster says when its next
 * episode airs).
 * `focusedAt`: the poster the focus is on, null while it is elsewhere. */
export function Trending(props: {
  /** The row's title ("Trending"). */
  title: () => string;
  items: () => Summary[];
  airs: boolean;
  focusedAt: () => number | null;
  blockRef: (r: ViewRef) => void;
  onOpen: (i: number) => void;
}) {
  /** The row puts the focused poster at the left edge of its inset. */
  const line = scroller({ horizontal: true, anchor: () => safe().x });
  const step = () => posterWidth() + u(20);
  const win = rowWindow({ line, focusedAt: props.focusedAt, step });
  return (
    <View ref={props.blockRef}>
      <View style={{ marginTop: u(34) }}>
        <SectionTitle text={props.title} inset rail={line} />
      </View>
      <Rail ctl={line} gap={20} top={26} bottom={16}>
        <RowGap window={win} step={step} gap={20} />
        <Each of={props.items().slice(win().from, win().to)} key={(s) => s.id}>
          {(item, i) => (
            <PosterCard
              item={item}
              sub={() => (props.airs ? airsText(item()) : null)}
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
