// A list of choices in a panel over the right of a page (as the filter and release
// panels are): a title, one row per choice, the chosen one lighter with a check. OK or
// a click picks; Back (through the page's closer) or a press outside closes it.
import { Text, View, type ViewRef, type ViewStyle } from "nsh";
import { Icon } from "../kit/Icon";
import { rowStyle } from "../kit/Row";
import { labelText, sectionTitle } from "../kit/text";
import { alpha, colors, safe, u } from "../theme";
import checkIcon from "../icons/check.svg";
import { scroller, Scroller } from "./Scroller";

const PANEL_WIDTH = 640;

const backdropStyle = (): ViewStyle => ({
  position: "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: 20, backgroundColor: alpha(colors.ink(), 0.6),
});
const panelStyle = (): ViewStyle => ({
  position: "absolute", top: 0, right: 0, bottom: 0, width: u(PANEL_WIDTH), zIndex: 21,
  backgroundColor: colors.ink(), borderLeftWidth: 1, borderLeftColor: alpha(colors.snow(), 0.08),
  boxShadow: `${-u(30)}px 0 ${u(60)}px ${alpha(colors.ink(), 0.8)}`,
});
const listStyle = (): ViewStyle => ({ paddingHorizontal: u(48), paddingTop: safe().y, paddingBottom: safe().y, gap: u(12) });
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
}) {
  /** The panel keeps the focused row in its upper third. */
  const list = scroller({ anchor: (viewport) => viewport / 3 });
  return [
    <View testID="choice-backdrop" style={backdropStyle()} onPress={props.onClose} />,
    <View testID="choice-panel" style={panelStyle()}>
      <Scroller ctl={list} style={{ flex: 1 }}>
        <View style={listStyle()}>
          <Text style={{ ...sectionTitle(), marginBottom: u(12) }}>{props.title()}</Text>
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
        </View>
      </Scroller>
    </View>,
  ];
}
