// The end of a browse grid: grey cards while its next page comes, a line when
// it did not come. When the page scrolls near it (a wheel, a trackpad, a
// finger) it asks for more, as `LazyBlock` mounts; on a TV the focus asks.
import { effect, Text, View, windowSize, type ViewRef, type ViewStyle } from "nsh";
import { t } from "nsh/i18n";
import { rounded } from "../../kit/shape";
import { metaText } from "../../kit/text";
import type { ScrollCtl } from "../../layout/Scroller";
import { alpha, colors, density, safe, u } from "../../theme";

/** How far past the viewport's end (in viewports) the tail asks for more. */
const AHEAD = 1;

const rowStyle = (gap: number): ViewStyle => ({ flexDirection: "row", gap: u(gap), paddingHorizontal: safe().x, marginTop: u(28) });
const skeletonStyle = (width: number): ViewStyle => ({
  width,
  height: width * 0.56,
  ...rounded(),
  backgroundColor: alpha(colors.snow(), 0.05),
  animationName: "pulse",
  animationDuration: 1400,
  animationIterationCount: "infinite",
  animationFrameRate: 30,
});
const lineStyle = (): ViewStyle => ({ paddingHorizontal: safe().x, marginTop: u(28) });

export function GridTail(props: {
  page: ScrollCtl;
  /** "loading": grey cards; "failed": the line. */
  state: () => "idle" | "loading" | "failed";
  columns: () => number;
  width: () => number;
  gap: number;
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
    // A TV's page moves with the focus, which asks for itself (two rows before the end).
    if (density === "ten-foot") return;
    props.page.offset();
    props.grid();
    windowSize();
    Promise.resolve().then(check);
  });
  return (
    <View ref={(r) => (ref = r)}>
      <If when={props.state() === "loading"}>
        <View testID="grid-skeleton" style={rowStyle(props.gap)}>
          <Each of={Array.from({ length: props.columns() }, (_, i) => i)} key={(i) => i}>
            {() => <View style={skeletonStyle(props.width())} />}
          </Each>
        </View>
      </If>
      <If when={props.state() === "failed"}>
        <View style={lineStyle()}>
          <Text style={metaText()}>{t("browse.state.more_failed")}</Text>
        </View>
      </If>
    </View>
  );
}
