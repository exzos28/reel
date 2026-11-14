// The top of home and title screens: the still filling the top of the
// screen and fading into the background, the logotype, meta, genres,
// about and the actions bottom-left.
import { Image, Text, View, type JSX, type TextStyle, type ViewStyle } from "nsh";
import { aboutText, genresText, titleText, type Summary } from "../catalog";
import { cover } from "../kit/shape";
import { bodyText, metaText } from "../kit/text";
import { alpha, colors, heroFade, safe, type, u } from "../theme";
import { MetaLine } from "./HeroMeta";

const backdropStyle = (height: number, left: number): ViewStyle => ({ position: "absolute", top: 0, right: 0, left: u(left), height: u(height) });
const paperStyle = (paper: string): ViewStyle => ({ flex: 1, backgroundColor: paper, opacity: 0.55 });
const stillStyle = { flex: 1, objectFit: "cover", objectPosition: "center 30%" } as ViewStyle;
const fadeStyle = (): ViewStyle => ({ ...cover(), backgroundImage: heroFade() });
const leftFadeStyle = (): ViewStyle => ({
  position: "absolute", top: 0, left: 0, bottom: 0, width: "40%",
  backgroundImage: `linear-gradient(90deg, ${colors.ink()} 0%, ${alpha(colors.ink(), 0)} 100%)`,
});
const textBlockStyle = (top: number): ViewStyle => ({ paddingHorizontal: safe().x, paddingTop: u(top), gap: u(14), maxWidth: u(1300) });
const logotypeStyle = (size: number): TextStyle => ({ numberOfLines: 2, ...type.logotype(size), color: colors.snow(), marginBottom: u(10) });

/** The still (or the title's paper colour) fading into the background;
 * moved right by `left`, it also fades in from the left edge. */
function Backdrop(props: { item: () => Summary; height: number; left: number }) {
  const s = props.item;
  return (
    <View style={backdropStyle(props.height, props.left)}>
      <If when={s().still} else={<View style={paperStyle(s().paper)} />}>
        <Image src={s().still!} style={stillStyle} />
      </If>
      <View style={fadeStyle()} />
      <If when={props.left > 0}>
        <View style={leftFadeStyle()} />
      </If>
    </View>
  );
}

export function Hero(props: {
  item: () => Summary;
  /** Height in TV pixels, and where the backdrop starts from the left. */
  height: number;
  backdropLeft?: number;
  titleSize: number;
  /** Top padding of the text block (room for the nav or the back button). */
  top: number;
  children: JSX.Element;
}) {
  const s = props.item;
  return (
    <View style={{ minHeight: u(props.height) }}>
      <Backdrop item={s} height={props.height} left={props.backdropLeft ?? 0} />
      <View style={textBlockStyle(props.top)}>
        <Text style={logotypeStyle(props.titleSize)}>{titleText(s())}</Text>
        <MetaLine item={s} />
        <Text style={{ ...metaText(), fontSize: u(24) }}>{genresText(s())}</Text>
        <Text style={{ numberOfLines: 2, ...bodyText(colors.soft()), maxWidth: u(980) }}>{aboutText(s())}</Text>
        {props.children}
      </View>
    </View>
  );
}
