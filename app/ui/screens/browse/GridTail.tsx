// The end of a browse grid: a line when its next page did not come. When the page scrolls near
// it (a wheel, a trackpad, a finger) it asks for more, as `LazyBlock` mounts; on a TV the focus
// asks. While more comes the grid itself ends in grey cards (`GridStub`), in the cells its
// next page takes.
import { effect, Text, View, windowSize, type ViewRef, type ViewStyle } from "nsh";
import { t } from "nsh/i18n";
import { cardRadius, rounded } from "../../kit/shape";
import { metaText } from "../../kit/text";
import type { ScrollCtl } from "../../layout/Scroller";
import { caps } from "../../platform";
import { alpha, colors, safe, u } from "../../theme";

/** How far past the viewport's end (in viewports) the tail asks for more. */
const AHEAD = 1;

const stubStyle = (width: number): ViewStyle => ({ width });
const stubPictureStyle = (width: number): ViewStyle => ({
  height: width * 0.56,
  ...rounded(cardRadius()),
  backgroundColor: alpha(colors.snow(), 0.05),
  animationName: "pulse",
  animationDuration: 1400,
  animationIterationCount: "infinite",
  animationFrameRate: 30,
});
const lineStyle = (): ViewStyle => ({ paddingHorizontal: safe().x, marginTop: u(28) });

/** A grey card in a cell of the grid that its next page's card will take. */
export function GridStub(props: { width: () => number }) {
  return (
    <View testID="grid-skeleton" style={stubStyle(props.width())}>
      <View style={stubPictureStyle(props.width())} />
    </View>
  );
}

export function GridTail(props: {
  page: ScrollCtl;
  /** The next page did not come: the line. */
  failed: () => boolean;
  /** Changes when the grid does (a page landed): look again. */
  grid: () => unknown;
  onNear: () => void;
}) {
  let ref: ViewRef | undefined;
  const check = async () => {
    const content = props.page.content;
    if (!ref || !content) return;
    const [b, c] = await Promise.all([ref.measure(), content.measure()]);
    if (!b || !c) return;
    const top = b.pagePosition.y - c.pagePosition.y;
    const viewport = windowSize().height;
    if (top < (props.page.offset() ?? 0) + viewport * (1 + AHEAD)) props.onNear();
  };
  effect(() => {
    // A TV's page moves with the focus, which asks for itself (`BrowseScreen`'s `NEAR_ROWS` before the end).
    if (caps.remote) return;
    props.page.offset();
    props.grid();
    windowSize();
    Promise.resolve().then(check);
  });
  return (
    <View ref={(r) => (ref = r)}>
      <If when={props.failed()}>
        <View style={lineStyle()}>
          <Text style={metaText()}>{t("browse.state.more_failed")}</Text>
        </View>
      </If>
    </View>
  );
}
