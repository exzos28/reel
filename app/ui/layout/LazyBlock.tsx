// A heavy block (a row of cards with its own horizontal scroll) mounted only while the page
// is near it: within AHEAD viewports above or below what shows. Away from it, a blank of
// the block's height keeps the page's length (its measured height once it has been shown,
// `height` before), so nothing moves when it comes or goes. A page of many rows keeps the
// few around the view in the page, not every row it has passed.
import { effect, signal, View, windowSize, type JSX, type ViewRef } from "nsh";
import type { ScrollCtl } from "./scrollCtl";

/** How far from the viewport (in viewports) blocks stay mounted. */
const AHEAD = 1.5;

export function LazyBlock(props: { page: ScrollCtl; height: () => number; eager?: boolean; children: JSX.Element }) {
  const shown = signal(!!props.eager);
  /** The block's height while it was shown, for its blank. */
  const measured = signal(0);
  let ref: ViewRef | undefined;
  const check = async () => {
    const content = props.page.content;
    const block = ref;
    if (!block || !content) return;
    const [b, c] = await Promise.all([block.measure(), content.measure()]);
    if (!b || !c) return;
    const height = b.bounds.size.height;
    if (shown() && height > 0) measured.set(height);
    const top = b.pagePosition.y - c.pagePosition.y;
    const viewport = windowSize().height;
    const offset = props.page.offset() ?? 0;
    const near = top < offset + viewport * (1 + AHEAD) && top + Math.max(height, 1) > offset - viewport * AHEAD;
    if (near !== shown()) shown.set(near);
  };
  effect(() => {
    props.page.offset();
    windowSize();
    Promise.resolve().then(check);
  });
  return (
    <View ref={(r) => (ref = r)}>
      <If when={shown()} else={<View style={{ height: measured() || props.height() }} />}>
        {props.children}
      </If>
    </View>
  );
}
