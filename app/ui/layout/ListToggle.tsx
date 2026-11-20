// Add to list: a title page's one header action (design/navigation.md, "Add
// to list and the title hero"). A pill with its label on a TV and a desktop,
// an icon-only disc on touch (the label is its accessibility name); added, a
// check and the selected fill (a phone's disc: a heart, red once added, as on Home).
import { Text, type TextStyle, type ViewStyle } from "nsh";
import { t } from "nsh/i18n";
import checkIcon from "../icons/check.svg";
import plusIcon from "../icons/plus.svg";
import heartIcon from "../icons/heart.svg";
import heartFilledIcon from "../icons/heart-filled.svg";
import { Icon } from "../kit/Icon";
import { rounded, row } from "../kit/shape";
import { alpha, colors, cs, focusRing, font, iconPt, targetSlop, u } from "../theme";
import { caps } from "../platform";
import { chrome } from "./chrome";
import { Pressable } from "../kit/Pressable";

/** Sizes, points (TV: TV pixels): height, icon, label, padding left / right. */
const size = () =>
  chrome === "tv"
    ? { height: cs(62), icon: 24, label: u(24), left: u(22), right: u(28), gap: u(12) }
    : { height: 34, icon: iconPt(15), label: 13, left: 12, right: 14, gap: 7 };
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
  /** What a screen reader says: the action, not the button's short words. */
  const spoken = () => (props.inList() ? t("title.remove_from_list_spoken") : t("title.add_to_list_spoken"));
  const icon = () => (props.inList() ? checkIcon : plusIcon);
  const tint = () => (props.inList() ? colors.snow() : colors.dim());
  /** The phone's disc: the heart Home's hero has. */
  const discIcon = () => (chrome !== "phone" ? icon() : props.inList() ? heartFilledIcon : heartIcon);
  const discTint = () => (chrome !== "phone" ? tint() : props.inList() ? colors.red() : colors.snow());
  return (
    <If
      when={caps.touch}
      else={
        <Pressable haptic role="button" hitSlop={targetSlop(size().height)} accessibilityLabel={spoken()} onPress={props.onPress} hoverStyle={{ backgroundColor: colors.raise() }} style={pillStyle(props.inList(), props.focused())}>
          <Icon src={icon} size={size().icon} color={tint} />
          <Text style={labelStyle(props.inList())}>{label()}</Text>
        </Pressable>
      }
    >
      <Pressable haptic role="button" hitSlop={targetSlop(DISC)} accessibilityLabel={spoken()} onPress={props.onPress} style={discStyle(props.inList())}>
        <Icon src={discIcon} size={iconPt(20)} color={discTint} />
      </Pressable>
    </If>
  );
}
