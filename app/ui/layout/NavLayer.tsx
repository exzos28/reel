// The nav of the top-level screens (Home, Movies, Shows): one view over
// them, so switching between them leaves it where it is. It stays put
// while a screen scrolls; once the content runs under it, a band of the
// background keeps it readable.
import { View, type ViewStyle } from "nsh";
import { go, type Destination } from "../nav";
import { colors, u } from "../theme";
import { NAV_BOTTOM, NavBar } from "./NavBar";
import { NAV } from "./navItems";
import { navCovered, navFocus } from "./navState";

/** Only the nav's buttons take the pointer; the wheel over the rest scrolls the screen. */
const layerStyle: ViewStyle = { position: "absolute", top: 0, left: 0, right: 0, zIndex: 3, pointerEvents: "box-none" };
const bandStyle = (shown: boolean): ViewStyle => ({
  position: "absolute",
  top: 0,
  left: 0,
  right: 0,
  height: u(NAV_BOTTOM + 24),
  backgroundColor: colors.ink(),
  opacity: shown ? 1 : 0,
  pointerEvents: "none",
  transitionProperty: "opacity",
  transitionDuration: 150,
  transitionTimingFunction: "ease-out",
});

export function NavLayer(props: { current: () => Destination }) {
  return (
    <View style={layerStyle}>
      <View style={bandStyle(navCovered())} />
      <NavBar current={props.current} focused={() => navFocus().at()} onPick={(i) => go(NAV[i].id)} />
    </View>
  );
}
