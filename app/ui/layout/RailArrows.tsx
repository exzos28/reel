// ‹ › beside a row's title on a computer: they move the row by a page. Not every mouse scrolls
// sideways, and not everyone knows Shift + wheel; a TV and touch move rows with the keys or a
// swipe and show none.
import { View, type ViewStyle } from "nsh";
import { t } from "nsh/i18n";
import chevronIcon from "../icons/chevron.svg";
import { Icon } from "../kit/Icon";
import { row } from "../kit/shape";
import { colors, iconPt, targetSlop, u } from "../theme";
import { chrome } from "./chrome";
import type { ScrollCtl } from "./Scroller";
import { Pressable } from "../kit/Pressable";

/** Rows get arrows on the desktops only. */
export const railArrows = chrome === "mac" || chrome === "windows" || chrome === "linux";

const arrowStyle = (off: boolean): ViewStyle => ({
  width: u(56),
  height: u(56),
  borderRadius: u(28),
  alignItems: "center",
  justifyContent: "center",
  backgroundColor: colors.card(),
  opacity: off ? 0.35 : 1,
});

function Arrow(props: { dir: 1 | -1; ctl: ScrollCtl }) {
  const off = () => !!(props.dir < 0 ? props.ctl.atStart() : props.ctl.atEnd());
  return (
    <Pressable
      role="button"
      accessibilityLabel={t(props.dir < 0 ? "nav.row_back" : "nav.row_on")}
      accessibilityState={{ disabled: off() }}
      hitSlop={targetSlop(u(56))}
      onPress={() => props.ctl.page(props.dir)}
      hoverStyle={{ backgroundColor: colors.raise() }}
      style={arrowStyle(off())}
    >
      <View style={{ transform: props.dir < 0 ? "rotate(90deg)" : "rotate(-90deg)" }}>
        <Icon src={() => chevronIcon} size={iconPt(16)} />
      </View>
    </Pressable>
  );
}

/** The two arrows of the row `ctl` scrolls. */
export function RailArrows(props: { ctl: ScrollCtl }) {
  return (
    <If when={railArrows}>
      <View style={row(u(10))}>
        <Arrow dir={-1} ctl={props.ctl} />
        <Arrow dir={1} ctl={props.ctl} />
      </View>
    </If>
  );
}
