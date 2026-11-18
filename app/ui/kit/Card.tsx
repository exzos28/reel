import { View, type JSX, type ViewRef, type ViewStyle } from "nsh";
import { focusRing, u } from "../theme";
import { rounded } from "./shape";

const frameStyle = (focused: boolean): ViewStyle => ({ ...rounded(), ...focusRing(focused, "card") });

/** A card's box: `width`, fixed in a shelf (it does not shrink). */
export const cardBox = (width: number, gap: number, shelf = true): ViewStyle =>
  shelf ? { width, flexShrink: 0, gap: u(gap) } : { width, gap: u(gap) };

/** A pressable card: its picture in a frame that lifts with the focus ring,
 * then what goes under it. */
export function Card(props: {
  label: () => string;
  focused: () => boolean;
  onPress: () => void;
  style: ViewStyle;
  viewRef?: (r: ViewRef) => void;
  testID?: string;
  picture: JSX.Element;
  children: JSX.Element;
}) {
  return (
    <View
      ref={props.viewRef ?? (() => {})}
      testID={props.testID}
      role="button"
      accessibilityLabel={props.label()}
      onPress={props.onPress}
      hoverStyle={{ opacity: 0.92 }}
      style={props.style}
    >
      <View style={frameStyle(props.focused())}>{props.picture}</View>
      {props.children}
    </View>
  );
}
