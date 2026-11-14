// A horizontal row of cards. The remote and the keyboard move along it by the focus; with a
// mouse (desktop density) there is no scrollbar: round arrows at its edges, shown while the
// pointer is over the row and only where there is more to see, page it (a trackpad swipes
// it as before).
import { signal, View, type JSX, type ViewStyle } from "nsh";
import { t } from "nsh/i18n";
import { Icon } from "../kit/Icon";
import { rounded } from "../kit/shape";
import { alpha, colors, density, ringRoom, safe, u } from "../theme";
import chevronIcon from "../icons/chevron.svg";
import { Scroller, type ScrollCtl } from "./Scroller";

/** Arrows only where a mouse moves the pointer. */
const mouse = density === "regular";
/** Size of an arrow, TV pixels. */
const ARROW = 64;

/** The row inside the safe area, with room for the focus ring above and
 * below (at least `top` and `bottom` TV pixels). */
const shelfRow = (gap: number, top: number, bottom: number): ViewStyle => ({
  flexDirection: "row",
  gap: u(gap),
  paddingHorizontal: safe().x,
  paddingTop: Math.max(u(top), ringRoom()),
  paddingBottom: Math.max(u(bottom), ringRoom()),
});
const arrowSide = (side: "left" | "right"): ViewStyle => ({
  position: "absolute",
  top: 0,
  bottom: 0,
  [side]: u(24),
  justifyContent: "center",
  zIndex: 2,
});
const arrowStyle = (): ViewStyle => ({
  width: u(ARROW),
  height: u(ARROW),
  ...rounded(999),
  alignItems: "center",
  justifyContent: "center",
  backgroundColor: alpha(colors.ink(), 0.82),
  borderWidth: 1,
  borderColor: alpha(colors.snow(), 0.12),
});

function Arrow(props: { side: "left" | "right"; onPress: () => void }) {
  return (
    <View style={arrowSide(props.side)}>
      <View
        role="button"
        accessibilityLabel={t(props.side === "left" ? "shelf.previous" : "shelf.next")}
        onPress={props.onPress}
        hoverStyle={{ backgroundColor: colors.raise() }}
        style={arrowStyle()}
      >
        {/* The chevron points down: turned to point the way it pages. */}
        <View style={{ transform: props.side === "left" ? "rotate(90deg)" : "rotate(-90deg)" }}>
          <Icon src={() => chevronIcon} size={30} />
        </View>
      </View>
    </View>
  );
}

/** A horizontal row of cards that scrolls as `ctl` follows the focus. */
export function Shelf(props: { ctl: ScrollCtl; gap: number; top: number; bottom: number; children: JSX.Element }) {
  const over = signal(false);
  const c = props.ctl;
  const row = (
    <Scroller ctl={c}>
      <View style={shelfRow(props.gap, props.top, props.bottom)}>{props.children}</View>
    </Scroller>
  );
  if (!mouse) return row;
  return (
    <View
      onMouseEnter={() => {
        over.set(true);
        void c.measure();
      }}
      onMouseLeave={() => over.set(false)}
    >
      {row}
      <If when={over() && (c.offset() ?? 0) > 2}>
        <Arrow side="left" onPress={() => void c.page(-1)} />
      </If>
      <If when={over() && (c.offset() ?? 0) < (c.room() ?? 0) - 2}>
        <Arrow side="right" onPress={() => void c.page(1)} />
      </If>
    </View>
  );
}
