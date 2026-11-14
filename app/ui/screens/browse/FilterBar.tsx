// "All movies" with the filter chips (static for now) and the sort order.
import { Text, View, type ViewStyle } from "nsh";
import { t } from "nsh/i18n";
import { Icon } from "../../kit/Icon";
import { rounded, row } from "../../kit/shape";
import { metaText, sectionTitle } from "../../kit/text";
import { colors, safe, u } from "../../theme";
import chevronIcon from "../../icons/chevron.svg";

const FILTERS = ["genres", "years", "countries"];

const barStyle = (): ViewStyle => ({ ...row(u(12)), paddingHorizontal: safe().x, marginTop: u(26) });
const chipStyle = (): ViewStyle => ({ ...row(u(8)), height: u(46), paddingHorizontal: u(18), ...rounded(), backgroundColor: colors.card() });

function Chip(props: { filter: () => string }) {
  return (
    <View style={chipStyle()}>
      <Text style={metaText(colors.soft())}>{t(`browse.filter.${props.filter()}`)}</Text>
      <Icon src={() => chevronIcon} size={18} color={colors.ash} />
    </View>
  );
}

export function FilterBar(props: { title: () => string }) {
  return (
    <View style={barStyle()}>
      <Text style={{ ...sectionTitle(), marginRight: u(22) }}>{props.title()}</Text>
      <Each of={FILTERS} key="index">
        {(f) => <Chip filter={f} />}
      </Each>
      <View style={{ flex: 1 }} />
      <Text style={metaText()}>
        {`${t("browse.sort")} `}
        <Text style={{ fontWeight: 500, color: colors.snow() }}>{t("browse.popular")}</Text>
      </Text>
    </View>
  );
}
