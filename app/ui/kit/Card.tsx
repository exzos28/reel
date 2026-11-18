import { effect, signal, untracked, View, type JSX, type ViewRef, type ViewStyle } from "nsh";
import { HoverCard } from "nsh/base";
import { type Summary } from "../catalog";
import { scrolled } from "../layout/scrollCtl";
import { focusRing, hoverRing, u } from "../theme";
import { PREVIEW_DELAY, PREVIEW_LIFT, PreviewBody, previewOn, previewPopup, previewStarting, previewWidth } from "./HoverPreview";
import { cardRadius, rounded } from "./shape";

/** The frame round the picture: the white ring of the focus, shown too under the pointer. The ring
 * is an outline, so it takes no room and moves nothing. */
const frameStyle = (focused: boolean): ViewStyle => ({ ...rounded(cardRadius()), ...focusRing(focused, "card") });

/** A card's box: `width`, fixed in a shelf (it does not shrink). */
export const cardBox = (width: number, gap: number, shelf = true): ViewStyle =>
  shelf ? { width, flexShrink: 0, gap: u(gap) } : { width, gap: u(gap) };

/** A pressable card: its picture in a frame that lifts with the focus ring,
 * then what goes under it. With `preview` (a desktop) the pointer resting on it for 0.6 s makes it
 * grow into a mini card with the title's details. */
export function Card(props: {
  label: () => string;
  focused: () => boolean;
  onPress: () => void;
  style: ViewStyle;
  viewRef?: (r: ViewRef) => void;
  testID?: string;
  picture: JSX.Element;
  preview?: () => Summary;
  children: JSX.Element;
}) {
  /** The card's size, points: the preview grows from it. */
  const size = signal({ width: 0, height: 0 });
  /** The preview is open. It closes when anything scrolls: the card moves away from the pointer,
   * which stays still and so never says it left. */
  const open = signal(false);
  effect(() => {
    scrolled();
    untracked(() => open() && open.set(false));
  });
  const card = () => (
    <View
      ref={props.viewRef ?? (() => {})}
      testID={props.testID}
      role="button"
      accessibilityLabel={props.label()}
      onPress={props.onPress}
      onLayout={(e) => size.set({ width: e.bounds.size.width, height: e.bounds.size.height })}
      style={props.style}
    >
      <View hoverStyle={hoverRing()} style={frameStyle(props.focused())}>
        {props.picture}
      </View>
      {props.children}
    </View>
  );
  const preview = () => (previewOn && props.preview && !props.preview().notice ? props.preview : null);
  return (
    <If when={preview()} else={card()}>
      {(item) => {
        const width = () => previewWidth(size().width);
        return (
          <HoverCard
            open={open()}
            onOpenChange={(e) => open.set(e.open)}
            openDelay={PREVIEW_DELAY}
            closeDelay={120}
            placement="bottom"
            align="center"
            // Back up over the card, a little above its top: it is the card that grew.
            offset={-(size().height + PREVIEW_LIFT)}
            popupStyle={previewPopup(width())}
            popupStartingStyle={previewStarting(width(), size().width)}
            trigger={card()}
          >
            <PreviewBody item={item()} width={width()} onOpen={props.onPress} />
          </HoverCard>
        );
      }}
    </If>
  );
}
