// "All movies" with the filter pills (Genres, Years, Countries) on the left
// and the order ("Sort by: Most popular") on the right. Each pill opens its
// panel; a pill with a pick, or whose panel is open, has the lighter fill.
import { Text, View, type JSX, type TextStyle, type ViewRef, type ViewStyle } from "nsh";
import { t } from "nsh/i18n";
import { filterText, sortText, type FilterGroup } from "../../catalog";
import { Icon } from "../../kit/Icon";
import { pillSlop, pillStyle } from "../../kit/Pill";
import { row } from "../../kit/shape";
import { metaText, oneLine, sectionTitle } from "../../kit/text";
import { colors, density, safe, u } from "../../theme";
import { Rail, railLead } from "../../layout/Rail";
import { scroller } from "../../layout/Scroller";
import chevronIcon from "../../icons/chevron.svg";

const barStyle = (): ViewStyle => ({ ...row(u(12)), paddingHorizontal: safe().x, marginTop: u(26) });
const pillText = (lit: boolean): TextStyle => ({ ...oneLine, ...metaText(lit ? colors.snow() : colors.soft()), maxWidth: u(520) });

function Pill(props: {
  group: () => FilterGroup;
  lit: () => boolean;
  focused: () => boolean;
  onPress: () => void;
  children: JSX.Element;
}) {
  return (
    <View
      testID={`filter-${props.group().id}`}
      role="button"
      hitSlop={pillSlop()}
      accessibilityLabel={filterText(props.group())}
      onPress={props.onPress}
      hoverStyle={{ backgroundColor: colors.raise() }}
      style={pillStyle(props.lit() ? colors.raise() : colors.card(), props.focused(), 18)}
    >
      {props.children}
      <Icon src={() => chevronIcon} size={18} color={colors.ash} />
    </View>
  );
}

/** `focusedAt`: the pill the focus is on (an index into `groups`), null
 * while it is elsewhere; `openAt`: the pill whose panel is open. */
export function FilterBar(props: {
  title: () => string;
  groups: () => FilterGroup[];
  focusedAt: () => number | null;
  openAt: () => number | null;
  blockRef: (r: ViewRef) => void;
  onOpen: (i: number) => void;
}) {
  const line = scroller({ horizontal: true, anchor: railLead });
  const sortAt = () => props.groups().findIndex((g) => g.id === "sort");
  const picked = (g: FilterGroup) => g.options.some((o) => o.selected);
  const pill = (i: () => number) => ({
    group: () => props.groups()[i()],
    focused: () => props.focusedAt() === i(),
    onPress: () => props.onOpen(i()),
  });
  const groupPills = () => (
    <Each of={props.groups().filter((g) => g.id !== "sort")} key={(g) => g.id}>
      {(g, i) => (
        <Pill {...pill(i)} lit={() => picked(g()) || props.openAt() === i()}>
          <Text style={pillText(picked(g()))}>{filterText(g())}</Text>
        </Pill>
      )}
    </Each>
  );
  const sortPill = () => (
    <If when={sortAt() >= 0}>
      <Pill {...pill(sortAt)} lit={() => props.openAt() === sortAt()}>
        <Text style={pillText(false)}>
          {`${t("browse.sort")} `}
          <Text style={{ fontWeight: 500, color: colors.snow() }}>{sortText(props.groups()[sortAt()])}</Text>
        </Text>
      </Pill>
    </If>
  );
  return (
    // A phone has no width for the row: the title over the pills, which scroll, Sort with them.
    <If
      when={density === "compact"}
      else={
        <View ref={props.blockRef} style={barStyle()}>
          <Text style={{ ...sectionTitle(), marginRight: u(22) }}>{props.title()}</Text>
          {groupPills()}
          <View style={{ flex: 1 }} />
          {sortPill()}
        </View>
      }
    >
      <View ref={props.blockRef} style={{ marginTop: u(26), gap: u(4) }}>
        <Text style={{ ...sectionTitle(), paddingHorizontal: safe().x }}>{props.title()}</Text>
        <Rail ctl={line} gap={12}>
          {groupPills()}
          {sortPill()}
        </Rail>
      </View>
    </If>
  );
}
