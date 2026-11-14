// A filter's choices in a panel over the right of a browse page, as the
// release panel is on the title screen: a Clear row (not for the order), then
// one row per choice; the picked ones are lighter with a check. OK picks
// (genres toggle, the panel stays open); Back or a press outside closes it.
import { Text, View, type ViewRef, type ViewStyle } from "nsh";
import { t } from "nsh/i18n";
import { optionText, type FilterGroup, type FilterOption } from "../../catalog";
import { Icon } from "../../kit/Icon";
import { rowStyle } from "../../kit/Row";
import { labelText, sectionTitle } from "../../kit/text";
import { scroller, Scroller } from "../../layout/Scroller";
import { alpha, colors, safe, u } from "../../theme";
import checkIcon from "../../icons/check.svg";

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

/** The Clear row: its empty id clears the group (`browse.option.clear`). */
const CLEAR: FilterOption = { id: "", name: null, key: "clear", n: null, selected: false };

/** The rows of `group`'s panel, the Clear row first when it has one. */
export const panelRows = (group: FilterGroup): FilterOption[] => (group.clear ? [CLEAR, ...group.options] : group.options);

function OptionRow(props: {
  text: () => string;
  selected: () => boolean;
  focused: () => boolean;
  viewRef: (r: ViewRef) => void;
  onPress: () => void;
}) {
  return (
    <View
      ref={props.viewRef}
      role="button"
      accessibilityLabel={props.text()}
      accessibilityState={{ selected: props.selected() }}
      onPress={props.onPress}
      hoverStyle={{ backgroundColor: colors.raise() }}
      style={optionStyle(props.selected(), props.focused())}
    >
      <Text style={labelText(props.selected() ? colors.snow() : colors.soft())}>{props.text()}</Text>
      <If when={props.selected()}>
        <Icon src={() => checkIcon} size={22} />
      </If>
    </View>
  );
}

export function FilterPanel(props: {
  group: () => FilterGroup;
  focusedAt: () => number;
  onPress: (row: number) => void;
  onClose: () => void;
}) {
  /** The panel keeps the focused row in its upper third. */
  const list = scroller({ anchor: (viewport) => viewport / 3 });
  const rows = () => panelRows(props.group());
  return [
    <View testID="filter-backdrop" style={backdropStyle()} onPress={props.onClose} />,
    <View testID="filter-panel" style={panelStyle()}>
      <Scroller ctl={list} style={{ flex: 1 }}>
        <View style={listStyle()}>
          <Text style={{ ...sectionTitle(), marginBottom: u(12) }}>{t(`browse.filter.${props.group().id}`)}</Text>
          <Each of={rows()} key={(o) => o.id}>
            {(o, i) => (
              <OptionRow
                text={() => optionText(o())}
                selected={() => o().selected}
                focused={() => props.focusedAt() === i()}
                viewRef={list.follow(() => props.focusedAt() === i())}
                onPress={() => props.onPress(i())}
              />
            )}
          </Each>
        </View>
      </Scroller>
    </View>,
  ];
}
