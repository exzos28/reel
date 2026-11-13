// A typographic poster: the film's title set on its own two colors. Focus is
// the projector light: lift, beam outline, brighter; the rest of the row dims.
import { effect, Text, View, type ViewRef } from "nsh";
import { filmText, type Film } from "../data";
import { colors, fonts, radius, u } from "./theme";

export function Poster(props: {
  film: () => Film;
  focused: () => boolean;
  rowFocused: () => boolean;
  onPress: () => void;
}) {
  const w = () => u(220);
  let ref: ViewRef | undefined;
  // Keep the focused poster on screen when its shelf scrolls.
  effect(() => {
    if (props.focused()) ref?.reveal({ horizontal: "nearest", vertical: "nearest" });
  });
  return (
    <View
      ref={(r) => (ref = r)}
      onPress={props.onPress}
      style={{
        width: w(),
        flexShrink: 0,
        gap: u(14),
        opacity: props.rowFocused() && !props.focused() ? 0.7 : 1,
        transform: props.focused() ? `translateY(${-u(8)}px)` : "none",
        transitionProperty: "opacity, transform",
        transitionDuration: 120,
        transitionTimingFunction: "ease-out",
      }}
    >
      <View
        style={{
          width: w(),
          height: w() * 1.5,
          borderRadius: radius.poster,
          backgroundColor: props.film().paper,
          padding: u(18),
          justifyContent: "space-between",
          outlineStyle: "solid",
          outlineWidth: props.focused() ? u(4) : 0,
          outlineOffset: u(6),
          outlineColor: colors.beam(),
          filter: props.focused() ? "brightness(1.12)" : "brightness(0.85)",
          transitionProperty: "filter",
          transitionDuration: 120,
        }}
      >
        <Text style={{ fontFamily: fonts.display, fontWeight: "700", fontSize: u(30), lineHeight: u(36), color: props.film().ink }}>
          {filmText(props.film(), "title")}
        </Text>
        <Text style={{ fontFamily: fonts.body, fontSize: u(24), color: props.film().ink, opacity: 0.8 }}>
          {String(props.film().year)}
        </Text>
      </View>
    </View>
  );
}
