// The top of home and title screens: the still filling the top of the
// screen and fading into the background, the logotype, meta, genres,
// about and the actions bottom-left.
import { computed, Image, Text, View, type JSX, type TextStyle, type ViewStyle } from "nsh";
import { aboutText, genresText, titleText, type Summary } from "../catalog";
import { cover } from "../kit/shape";
import { bodyText, metaText } from "../kit/text";
import { alpha, colors, heroFade, insetMaxWidth, safe, ts, type, u } from "../theme";
import { MetaLine } from "./HeroMeta";
import { heroBoxNow, heroFollowsWindow, type HeroBox } from "./metrics";

/** The backdrop: from the window's right edge, as wide and tall as the hero's box says. */
const backdropStyle = (box: HeroBox): ViewStyle => ({
  position: "absolute", top: 0, right: 0, width: box.stillWidth, height: box.height, overflow: "hidden",
});
const paperStyle = (paper: string): ViewStyle => ({ flex: 1, backgroundColor: paper, opacity: 0.55 });
// A backdrop is a 16:9 frame, and people's heads sit in its upper part. On a TV and touch the
// box keeps at least 16:9 of its width (taller only when the hero is), never stretched, and
// anchored to the top: what does not fit is cut at the bottom, where the fade hides it anyway.
// A desktop's box is no wider than shows most of the frame (`heroBox`): the still covers it,
// cut a little more at the bottom than at the top.
const stillStyle = (heroFollowsWindow
  ? { ...cover(), objectFit: "cover", objectPosition: "center 30%" }
  : { width: "100%", minHeight: "100%", aspectRatio: 16 / 9, objectFit: "cover", objectPosition: "center top" }) as ViewStyle;
const fadeStyle = (): ViewStyle => ({ ...cover(), backgroundImage: heroFade() });
const leftFadeStyle = (): ViewStyle => ({
  position: "absolute", top: 0, left: 0, bottom: 0, width: "40%",
  backgroundImage: `linear-gradient(90deg, ${colors.ink()} 0%, ${alpha(colors.ink(), 0)} 100%)`,
});
/** The text's column: at the inset, as wide as in an ordinary window (a wide desktop window's
 * larger inset moves it, `insetMaxWidth`, instead of narrowing it). */
const textBlockStyle = (top: number, bottom = 0): ViewStyle => ({
  paddingHorizontal: safe().x, paddingTop: top, paddingBottom: bottom, gap: u(14), maxWidth: insetMaxWidth(1300),
});
/** Steady: the text stands on the hero's bottom, so the actions keep their place whatever
 * the title's lines (it grows upwards into the room `top` leaves). The room under the actions
 * is the design's (`design`, TV pixels), however tall the hero (`height`, points) grows. */
const steadyBlockStyle = (top: number, design: number, height: number): ViewStyle => ({
  ...textBlockStyle(0), height, justifyContent: "flex-end", paddingBottom: u(design - HERO_TEXT_ROOM) - top,
});
/** The hero's own height (points): at least the backdrop's, or (`fit`) only what its text needs. */
const heroStyle = (height: number, fit: boolean): ViewStyle => (fit ? {} : { minHeight: height });
const ABOUT_LINES = 3;
/** A steady hero's text block, from `top` to its actions' bottom (TV pixels): a one-line
 * title, the meta, genres, three lines of about and the actions. */
const HERO_TEXT_ROOM = 444;
/** `steady`: always the height of its three lines, so what is under it stays put as the text changes. */
const aboutStyle = (steady: boolean): TextStyle => {
  const body = bodyText(colors.soft());
  return { numberOfLines: ABOUT_LINES, ...body, maxWidth: u(980), ...(steady ? { height: (body.lineHeight as number) * ABOUT_LINES } : {}) };
};
const logotypeStyle = (size: number): TextStyle => ({ numberOfLines: 2, ...type.logotype(size), color: colors.snow(), marginBottom: u(10) });

/** The still (or the title's paper colour) fading into the background; where it starts
 * after the window's left edge, it also fades in from there. */
function Backdrop(props: { item: () => Summary; box: () => HeroBox }) {
  const s = props.item;
  return (
    <View style={backdropStyle(props.box())}>
      <If when={s().still} else={<View style={paperStyle(s().paper)} />}>
        <Image src={s().still!} style={stillStyle} />
      </If>
      <View style={fadeStyle()} />
      <If when={props.box().stillLeft > 0.5}>
        <View style={leftFadeStyle()} />
      </If>
    </View>
  );
}

export function Hero(props: {
  item: () => Summary;
  /** The design's height in TV pixels, and where the backdrop starts from the left (a desktop
   * window grows the one and moves the other: `metrics.heroBox`). */
  height: number;
  backdropLeft?: number;
  titleSize: number;
  /** Where the text starts, points (`metrics.heroTop`: under what is over the page). */
  top: number;
  /** As tall as its text (the backdrop still fades out under what follows),
   * so a title screen's next block starts right under the actions. */
  fit?: boolean;
  /** The title, pressed (a tap or a click): opens the title's page. Keys open it from the card. */
  onOpen?: () => void;
  /** Room under the actions before what follows, TV pixels (56 when not `fit`, else none). */
  room?: number;
  /** The about keeps the height of three lines and the text stands on the hero's bottom
   * (Home: the hero follows the focus, its buttons stay put). */
  steadyAbout?: boolean;
  children: JSX.Element;
}) {
  const s = props.item;
  const box = computed(() => heroBoxNow(props.height, props.backdropLeft ?? 0));
  return (
    <View style={heroStyle(box().height, !!props.fit)}>
      <Backdrop item={s} box={box} />
      {/* Not fit to its text: room under the actions before what follows. */}
      <View style={props.steadyAbout ? steadyBlockStyle(props.top, props.height, box().height) : textBlockStyle(props.top, u(props.room ?? (props.fit ? 0 : 56)))}>
        <If when={props.onOpen} else={<Text style={logotypeStyle(props.titleSize)}>{titleText(s())}</Text>}>
          {(open) => (
            <View role="link" accessibilityLabel={titleText(s())} onPress={open()} style={{ alignSelf: "flex-start" }}>
              <Text style={logotypeStyle(props.titleSize)}>{titleText(s())}</Text>
            </View>
          )}
        </If>
        <MetaLine item={s} />
        <Text style={{ ...metaText(), fontSize: ts(24) }}>{genresText(s())}</Text>
        <Text style={aboutStyle(!!props.steadyAbout)}>{aboutText(s())}</Text>
        {props.children}
      </View>
    </View>
  );
}
