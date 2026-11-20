// The nav: logo left; the destinations as pills (the current one in a
// lighter pill, the same width as when it is not), then round search and
// settings buttons. The group (pills and buttons together) sits where Settings says: at the
// right edge (the default), right after the logo, or in the middle of the screen.
import { Text, View, type TextStyle, type ViewStyle } from "nsh";
import { t } from "nsh/i18n";
import { Icon } from "../kit/Icon";
import { IconButton } from "../kit/IconButton";
import { pillStyle } from "../kit/Pill";
import { rounded, row } from "../kit/shape";
import { labelText } from "../kit/text";
import type { Destination } from "../nav";
import { navPosition } from "../preferences";
import { colors, density, font, radius, safe, ts, u } from "../theme";
import { NAV_ROW, NAV_TOP } from "./metrics";
import { NAV } from "./navItems";
import { Pressable } from "../kit/Pressable";

/** Where the nav sits from the top and how tall its row is (`metrics`, TV pixels). */
const NAV_BOTTOM = NAV_TOP + NAV_ROW;

const barStyle = (): ViewStyle => ({
  ...row(0),
  height: u(NAV_BOTTOM),
  paddingHorizontal: safe().x,
  paddingTop: u(NAV_TOP),
  zIndex: 3,
  pointerEvents: "box-none",
});
const groupStyle = (): ViewStyle => ({ ...row(u(2), "stretch"), padding: u(5), ...rounded(radius() + u(5)), backgroundColor: colors.card() });
const logoStyle = (): TextStyle => ({ fontFamily: font, fontSize: ts(40), fontWeight: 700, letterSpacing: -u(0.5), color: colors.red() });

/** The room left of the group (the logo's) and right of it: in the middle both take half of
 * what is left, so the group is centred on the screen; elsewhere the one away from it all. */
const sideStyle = (grow: boolean, gap = 0): ViewStyle => (grow ? { flex: 1 } : { paddingRight: gap });

export function Logo() {
  return <Text style={logoStyle()}>{t("app.name")}</Text>;
}

type Props = { current: () => Destination; focused: () => number | null; onPick: (i: number) => void };

const pills = NAV.filter((n) => n.pill);
const buttons = NAV.filter((n) => !n.pill);

function NavPills(props: Props) {
  const tint = (id: Destination) => (props.current() === id ? colors.snow() : colors.dim());
  return (
    <View style={groupStyle()}>
      <Each of={pills} key={(n) => n.id}>
        {(n, i) => (
          <Pressable
            role="button"
            accessibilityLabel={t(`nav.${n().id}`)}
            onPress={() => props.onPick(i())}
            hoverStyle={{ backgroundColor: colors.raise() }}
            style={pillStyle(props.current() === n().id ? colors.nav() : "transparent", props.focused() === i(), 20)}
          >
            <Icon src={() => n().icon} size={24} color={() => tint(n().id)} />
            <If when={density !== "compact"}>
              <Text style={labelText(tint(n().id))}>{t(`nav.${n().id}`)}</Text>
            </If>
          </Pressable>
        )}
      </Each>
    </View>
  );
}

export function NavBar(props: Props) {
  return (
    <View style={barStyle()}>
      <View style={sideStyle(navPosition() !== "left", u(32))}>
        <Logo />
      </View>
      <View testID={`nav-${navPosition()}`} style={row(u(10))}>
        <NavPills current={props.current} focused={props.focused} onPick={props.onPick} />
        <Each of={buttons} key={(n) => n.id}>
          {(n, i) => (
            <IconButton
              icon={() => n().icon}
              label={() => t(`nav.${n().id}`)}
              focused={() => props.focused() === pills.length + i()}
              selected={() => props.current() === n().id}
              onPress={() => props.onPick(pills.length + i())}
            />
          )}
        </Each>
      </View>
      <View style={sideStyle(navPosition() !== "right")} />
    </View>
  );
}
