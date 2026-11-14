// A heavy block (a row of cards with its own horizontal scroll) mounted only
// when the page scrolls near it: until then a placeholder of about its height
// keeps the page's length, so nothing moves when it mounts. Once mounted it
// stays mounted.
import { effect, signal, View, windowSize, type JSX, type ViewRef } from "nsh";
import type { ScrollCtl } from "./scrollCtl";

/** How far ahead of the viewport (in viewports) blocks mount. */
const AHEAD = 1.5;

export function LazyBlock(props: { page: ScrollCtl; height: () => number; eager?: boolean; children: JSX.Element }) {
  const shown = signal(!!props.eager);
  let ref: ViewRef | undefined;
  const check = async () => {
    const content = props.page.content;
    const block = ref;
    if (shown() || !block || !content) return;
    const [b, c] = await Promise.all([block.measure(), content.measure()]);
    if (!b || !c) return;
    const top = b.pagePosition.y - c.pagePosition.y;
    const viewport = windowSize().height;
    if (top < (props.page.offset() ?? 0) + viewport * (1 + AHEAD)) shown.set(true);
  };
  effect(() => {
    props.page.offset();
    windowSize();
    if (!shown()) Promise.resolve().then(check);
  });
  return (
    <View ref={(r) => (ref = r)}>
      <If when={shown()} else={<View style={{ height: props.height() }} />}>
        {props.children}
      </If>
    </View>
  );
}
