import { View, type ViewRef } from "nsh";
import { airsText, type Summary } from "../../catalog";
import { scroller } from "../../layout/Scroller";
import { Shelf } from "../../layout/Shelf";
import { rowReach } from "../../layout/reach";
import { safe, u } from "../../theme";
import { PosterCard } from "./PosterCard";

/** The trending row of posters (with `airs`, a poster says when its next
 * episode airs).
 * `focusedAt`: the poster the focus is on, null while it is elsewhere. */
export function Trending(props: {
  items: () => Summary[];
  airs: boolean;
  focusedAt: () => number | null;
  blockRef: (r: ViewRef) => void;
  onOpen: (i: number) => void;
}) {
  /** The row puts the focused poster at the left edge of its inset. */
  const line = scroller({ horizontal: true, anchor: () => safe().x });
  const reach = rowReach({ line, focusedAt: props.focusedAt, step: () => u(196 + 20) });
  return (
    <View ref={props.blockRef}>
      <Shelf ctl={line} gap={20} top={26} bottom={16}>
        <Each of={props.items().slice(0, reach())} key={(s) => s.id}>
          {(item, i) => (
            <PosterCard
              item={item}
              sub={() => (props.airs ? airsText(item()) : null)}
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
