// A list of choices in a drawer (as the filter and release panels are): a title,
// one row per choice, the chosen one lighter with a check. OK or a click picks;
// Back (through the page's closer), ✕ or a press outside closes it.
import { Text, View, type ViewRef, type ViewStyle } from "nsh";
import { Icon } from "../kit/Icon";
import { rowStyle } from "../kit/Row";
import { labelText } from "../kit/text";
import { colors, u } from "../theme";
import checkIcon from "../icons/check.svg";
import { Drawer } from "./Drawer";

const optionStyle = (selected: boolean, focused: boolean): ViewStyle => ({
  ...rowStyle(selected, focused, u(16)),
  height: u(68),
  paddingHorizontal: u(28),
  justifyContent: "space-between",
});

export interface Choice {
  key: string;
  text: string;
  selected: boolean;
}

function ChoiceRow(props: { choice: () => Choice; focused: () => boolean; viewRef: (r: ViewRef) => void; onPress: () => void }) {
  const c = props.choice;
  return (
    <View
      ref={props.viewRef}
      role="button"
      accessibilityLabel={c().text}
      accessibilityState={{ selected: c().selected }}
      onPress={props.onPress}
      hoverStyle={{ backgroundColor: colors.raise() }}
      style={optionStyle(c().selected, props.focused())}
    >
      <Text style={labelText(c().selected ? colors.snow() : colors.soft())}>{c().text}</Text>
      <If when={c().selected}>
        <Icon src={() => checkIcon} size={22} />
      </If>
    </View>
  );
}

export function ChoicePanel(props: {
  title: () => string;
  choices: () => Choice[];
  focusedAt: () => number;
  onPick: (i: number) => void;
  onClose: () => void;
  /** Test ids (`<id>-panel`, …); "choice" by default. */
  id?: string;
}) {
  return (
    <Drawer id={props.id ?? "choice"} open={() => true} onClose={props.onClose} title={props.title}>
      {(list) => (
        <Each of={props.choices()} key={(c) => c.key}>
          {(c, i) => (
            <ChoiceRow
              choice={c}
              focused={() => props.focusedAt() === i()}
              viewRef={list.follow(() => props.focusedAt() === i())}
              onPress={() => props.onPick(i())}
            />
          )}
        </Each>
      )}
    </Drawer>
  );
}
