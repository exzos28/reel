import { Image, Text, View, type TextStyle, type ViewStyle } from "nsh";
import { titleText, type Summary } from "../catalog";
import { colors, radius, type, u } from "../theme";
import { cover } from "./shape";

const pictureStyle = (fill: string, style: ViewStyle): ViewStyle => ({ overflow: "hidden", backgroundColor: fill, ...style });
const fallbackStyle = (): ViewStyle => ({ flex: 1, padding: u(18), justifyContent: "flex-end" });
const fallbackTitle = (size: number, ink: string): TextStyle => ({ numberOfLines: 3, ...type.logotype(size), fontWeight: 300, color: ink });
const imageStyle = (position: string) => ({ ...cover(), objectFit: "cover", objectPosition: position }) as ViewStyle;
const trackStyle = (): ViewStyle => ({ position: "absolute", left: 0, right: 0, bottom: 0, height: u(5), backgroundColor: colors.raise() });
const watchedStyle = (progress: number): ViewStyle => ({ height: "100%", width: `${Math.round(progress * 100)}%`, backgroundColor: colors.snow() });

/** A still or a poster; without one, the title set in its own two colours. */
export function Picture(props: {
  item: () => Summary;
  src: () => string | null;
  style: ViewStyle;
  /** Fallback title size, TV pixels. */
  titleSize: number;
  position?: string;
}) {
  return (
    <View style={pictureStyle(props.src() ? colors.card() : props.item().paper, props.style)}>
      <If
        when={props.src()}
        else={
          <View style={fallbackStyle()}>
            <Text style={fallbackTitle(props.titleSize, props.item().ink)}>
              {titleText(props.item())}
            </Text>
          </View>
        }
      >
        <Image src={props.src()!} style={imageStyle(props.position ?? "center")} />
      </If>
    </View>
  );
}

/** A thin watched bar along the bottom of a thumbnail. */
export function WatchedBar(props: { progress: () => number }) {
  return (
    <View style={trackStyle()}>
      <View style={watchedStyle(props.progress())} />
    </View>
  );
}

/** Clips a watched bar to a card's rounded bottom corners. */
export const watchedClip = (): ViewStyle => ({
  position: "absolute",
  left: 0,
  right: 0,
  bottom: 0,
  height: u(5),
  overflow: "hidden",
  borderBottomLeftRadius: radius(),
  borderBottomRightRadius: radius(),
});
