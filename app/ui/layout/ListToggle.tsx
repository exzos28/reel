// Add to list: a title page's one header action (design/navigation.md, "Add
// to list and the title hero"). A pill with its label on a TV and a desktop,
// an icon-only disc on touch (the label is its accessibility name); added, a
// check and the selected fill.
import { Text, View, type TextStyle, type ViewStyle } from "nsh";
import { t } from "nsh/i18n";
import checkIcon from "../icons/check.svg";
import plusIcon from "../icons/plus.svg";
import { Icon } from "../kit/Icon";
import { rounded, row } from "../kit/shape";
import { alpha, colors, cs, focusRing, font, u } from "../theme";
import { caps } from "../platform";
import { chrome } from "./chrome";

/** Sizes, points (TV: TV pixels): height, icon, label, padding left / right. */
const size = () =>
  chrome === "tv"
    ? { height: cs(62), icon: 24, label: u(24), left: u(22), right: u(28), gap: u(12) }
    : { height: 34, icon: 15 / u(1), label: 13, left: 12, right: 14, gap: 7 };
/** The touch disc, points. */
const DISC = 40;

const fill = (inList: boolean) => (inList ? colors.nav() : alpha(colors.card(), 0.82));

const pillStyle = (inList: boolean, focused: boolean): ViewStyle => ({
  ...row(size().gap),
  height: size().height,
  paddingLeft: size().left,
  paddingRight: size().right,
  ...rounded(999),
  backgroundColor: fill(inList),
  ...focusRing(focused),
});
const discStyle = (inList: boolean): ViewStyle => ({
  width: DISC,
  height: DISC,
  ...rounded(999),
  alignItems: "center",
  justifyContent: "center",
  backgroundColor: fill(inList),
});
const labelStyle = (inList: boolean): TextStyle => ({
  fontFamily: font,
  fontSize: size().label,
  fontWeight: 500,
  color: inList ? colors.snow() : colors.dim(),
});

export function ListToggle(props: { inList: () => boolean; focused: () => boolean; onPress: () => void }) {
  const label = () => (props.inList() ? t("title.in_list") : t("title.add_to_list"));
  const icon = () => (props.inList() ? checkIcon : plusIcon);
  const tint = () => (props.inList() ? colors.snow() : colors.dim());
  return (
    <If
      when={caps.touch}
      else={
        <View role="button" accessibilityLabel={label()} onPress={props.onPress} hoverStyle={{ backgroundColor: colors.raise() }} style={pillStyle(props.inList(), props.focused())}>
          <Icon src={icon} size={size().icon} color={tint} />
          <Text style={labelStyle(props.inList())}>{label()}</Text>
        </View>
      }
    >
      <View role="button" accessibilityLabel={label()} onPress={props.onPress} style={discStyle(props.inList())}>
        <Icon src={icon} size={20 / u(1)} color={tint} />
      </View>
    </If>
  );
}
