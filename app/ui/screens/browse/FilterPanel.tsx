// A filter's choices in a drawer (ChoicePanel): an Any row (not for the order),
// then one row per choice; the picked ones are lighter with a check. OK picks
// (genres toggle, the drawer stays open); Back, ✕ or a press outside closes it.
import { t } from "nsh/i18n";
import { optionText, type FilterGroup, type FilterOption } from "../../catalog";
import { ChoicePanel } from "../../layout/ChoicePanel";

/** The Any row: its empty id clears the group (`browse.option.any`); it is the one
 * selected while nothing in the group is. */
const ANY: FilterOption = { id: "", name: null, key: "any", n: null, selected: false };

/** The rows of `group`'s panel, the Any row first when it has one. */
export const panelRows = (group: FilterGroup): FilterOption[] =>
  group.clear ? [{ ...ANY, selected: !group.options.some((o) => o.selected) }, ...group.options] : group.options;

export function FilterPanel(props: {
  group: () => FilterGroup;
  focusedAt: () => number;
  onPress: (row: number) => void;
  onClose: () => void;
}) {
  return (
    <ChoicePanel
      id="filter"
      title={() => t(`browse.filter.${props.group().id}`)}
      choices={() => panelRows(props.group()).map((o) => ({ key: o.id || "any", text: optionText(o), selected: o.selected }))}
      focusedAt={props.focusedAt}
      onPick={props.onPress}
      onClose={props.onClose}
    />
  );
}
