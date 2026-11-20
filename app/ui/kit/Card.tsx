import { effect, signal, untracked, View, type JSX, type ViewRef, type ViewStyle } from "nsh";
import { HoverCard } from "nsh/base";
import { type Summary } from "../catalog";
import { scrolled } from "../layout/scrollCtl";
import { focusRing, hoverRing, u } from "../theme";
import { PREVIEW_DELAY, PREVIEW_LIFT, PreviewBody, previewOn, previewPopup, previewStarting, previewWidth } from "./HoverPreview";
import { cardRadius, rounded } from "./shape";
import { pressFeedback } from "./pressFeedback";

/** The frame round the picture: the white ring of the focus, shown too under the pointer. The ring
 * is an outline, so it takes no room and moves nothing. */
const frameStyle = (focused: boolean): ViewStyle => ({ ...rounded(cardRadius()), ...focusRing(focused, "card") });

/** A card's box: `width`, fixed in a shelf (it does not shrink). */
export const cardBox = (width: number, gap: number, shelf = true): ViewStyle =>
  shelf ? { width, flexShrink: 0, gap: u(gap) } : { width, gap: u(gap) };

interface CardProps {
  label: () => string;
  focused: () => boolean;
  onPress: () => void;
  style: ViewStyle;
  viewRef?: (r: ViewRef) => void;
  testID?: string;
  picture: JSX.Element;
  preview?: () => Summary;
  children: JSX.Element;
}

/** A pressable card: its picture in a frame that lifts with the focus ring,
 * then what goes under it. With `preview` (a desktop) the pointer resting on it for 0.6 s makes it
 * grow into a mini card with the title's details. A TV and touch get the plain card: no layout
 * reports, no watch on the scrolling. */
export function Card(props: CardProps) {
  if (!previewOn || !props.preview) return <PlainCard {...props} />;
  return <PreviewCard {...props} preview={props.preview} />;
}

function PlainCard(props: CardProps & { onLayout?: (size: { width: number; height: number }) => void }) {
  const press = pressFeedback();
  return (
    <View
      ref={props.viewRef ?? (() => {})}
      testID={props.testID}
      role="button"
      accessibilityLabel={props.label()}
      onPress={props.onPress}
      onPressDown={press.onPressDown}
      onPressUp={press.onPressUp}
      onLayout={props.onLayout ? (e) => props.onLayout!({ width: e.bounds.size.width, height: e.bounds.size.height }) : undefined}
      style={props.style}
    >
      <View hoverStyle={hoverRing()} style={{ ...frameStyle(props.focused()), opacity: press.on() ? 0.75 : 1 }}>
        {props.picture}
      </View>
      {props.children}
    </View>
  );
}

function PreviewCard(props: CardProps & { preview: () => Summary }) {
  /** The card's size, points: the preview grows from it. */
  const size = signal({ width: 0, height: 0 });
  /** The preview is open. It closes when anything scrolls: the card moves away from the pointer,
   * which stays still and so never says it left. Only an open preview watches the scrolling, so a
   * page of cards costs nothing per scroll event. */
  const open = signal(false);
  let openedAt = -1;
  effect(() => {
    if (!open()) {
      openedAt = -1;
      return;
    }
    const n = scrolled();
    if (openedAt < 0) openedAt = n;
    else if (n !== openedAt) untracked(() => open.set(false));
  });
  const card = () => <PlainCard {...props} onLayout={(s) => size.set(s)} />;
  const width = () => previewWidth(size().width);
  return (
    <If when={!props.preview().notice} else={card()}>
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
        <PreviewBody item={props.preview} width={width()} onOpen={props.onPress} />
      </HoverCard>
    </If>
  );
}
