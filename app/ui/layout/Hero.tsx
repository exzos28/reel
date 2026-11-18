// The top of home and title screens: the still filling the top of the
// screen and fading into the background, the logotype, meta, genres,
// about and the actions bottom-left.
import { computed, Image, Text, View, windowSize, type JSX, type TextStyle, type ViewStyle } from "nsh";
import { aboutText, genresText, titleText, type Summary } from "../catalog";
import { cover } from "../kit/shape";
import { bodyText, metaText } from "../kit/text";
import { alpha, colors, density, heroFade, insetMaxWidth, safe, ts, type, u } from "../theme";
import { centering, frame } from "./chrome";
import { MetaLine } from "./HeroMeta";
import { heroBoxNow, heroFollowsWindow, type HeroBox } from "./metrics";

/** The backdrop: from the window's right edge, as wide and tall as the hero's box says. */
const backdropStyle = (box: HeroBox): ViewStyle => ({
  position: "absolute", top: 0, right: 0, width: box.stillWidth, height: box.height, overflow: "hidden",
});
// ---- Split: a desktop window's title hero. The still lies whole (a 16:9 frame, never cropped) at
// the top of the page, against the window's sides, and the text stands lower, on the still's foot:
// there four layers of blur, deepening downwards, and the page's colour melt the picture into the
// text. The still only ever fades into the page's own colour, solid where it stops, so no edge of it
// can show (a picture cannot be faded itself: masks are not drawn everywhere).
// - Up to the width where the content column stops growing, it runs edge to edge, its two sides
//   softened just at the window's edges.
// - Wider (the column at its widest, room beside it), the two stand side by side in the column: the
//   text high, at its left, and the still at its right, from the window's top; the still's side
//   towards the text melts into the page in an arc, its other sides as a plain frame's would.
/** A window this wide or wider gets the whole-still hero. */
const SPLIT_MIN_WIDTH = 640;
export const heroSplit = () => frame.nav === "window-bar" && windowSize().width >= SPLIT_MIN_WIDTH;
const columnWidth = () => windowSize().width - 2 * safe().x;
/** Side by side: the column is at its widest and the window leaves room beside it. */
const corner = () => centering() > 0;
/** Side by side, the still's share of the column, from its right edge; the text keeps to the rest, and
 * runs this much more of the column over the still's arc, where the picture is mostly faded. */
const CORNER_SHARE = 0.64;
const CORNER_TEXT_OVER = 0.12;
const splitWidth = () => (corner() ? columnWidth() * CORNER_SHARE : windowSize().width);
const splitHeight = () => (splitWidth() * 9) / 16;
/** The still's foot is cut a little: its box is this much of the 16:9 height (the text still stands by the full one). */
const SPLIT_KEPT = 0.88;
/** Where the text starts: this much of the still's height down it, so the still's upper part is clear
 * (side by side the text is beside the still, so it starts as high as the page lets it). */
const SPLIT_TEXT_AT = 0.52;
const splitTop = (top: number) => (corner() ? top : Math.max(top, splitHeight() * SPLIT_TEXT_AT));
/** A steady split hero (Home): its text block from the title's start to the actions' end, TV pixels, with a
 * one-line title; the block stands on the hero's bottom, a longer title grows upwards. */
const SPLIT_STEADY_ROOM = 400;
const splitSteadyStyle = (top: number): ViewStyle => ({
  ...textBlockStyle(0, 0, true), height: splitTop(top) + u(SPLIT_STEADY_ROOM), justifyContent: "flex-end",
});
/** Side by side, the still reaches this far under the text's end (TV pixels), so its foot fades out
 * below the actions; and the hero is as tall as it, so what follows starts under it. */
const CORNER_FOOT = 90;
const splitBoxHeight = (top: number) =>
  corner() ? Math.max(splitHeight(), top + u(SPLIT_STEADY_ROOM + CORNER_FOOT)) : splitHeight() * SPLIT_KEPT;
const splitBoxStyle = (top: number): ViewStyle => ({
  position: "absolute", top: 0, right: corner() ? safe().x : 0, width: splitWidth(), height: splitBoxHeight(top), overflow: "hidden",
});
const splitStillStyle = (): ViewStyle => ({ width: "100%", height: "100%", objectFit: "cover", objectPosition: "center top" } as ViewStyle);
/** The blur's four layers, from the still's foot up: how far each reaches (of its height) and its radius. */
const BLUR_LAYERS = [
  { reach: 0.32, blur: 1.2 },
  { reach: 0.23, blur: 2.5 },
  { reach: 0.15, blur: 4.5 },
  { reach: 0.08, blur: 7 },
] as const;
const blurLayerStyle = (reach: number, blur: number): ViewStyle => ({
  position: "absolute", left: 0, right: 0, bottom: 0, height: `${reach * 100}%`, backdropFilter: `blur(${blur}px)`,
});
/** An S-curve from 0 to 1, flat at both ends: a fade on it shows neither where it starts nor where it stops. */
const ease = (p: number) => p * p * (3 - 2 * p);
const EASE_STEPS = 16;
/** A gradient of the page's colour from `from` (at 0) to none at `length` points, on `ease`. */
const inkRamp = (deg: number, from: number, length: number): string => {
  const ink = colors.ink();
  const stops = Array.from({ length: EASE_STEPS + 1 }, (_, i) => {
    const p = i / EASE_STEPS;
    return `${alpha(ink, from * (1 - ease(p)))} ${(length * p).toFixed(1)}px`;
  });
  return `linear-gradient(${deg}deg, ${stops.join(", ")})`;
};
// The sides. Each is a band at a side of the still: the page's colour over it, from `ink` at the
// still's edge to none, and blur under that, in small steps (of the band's width, and a radius), only
// where the colour is dense enough that a step cannot show.
type Band = { width: number; ink: number; blur: readonly { reach: number; blur: number }[] };
/** At a window's edge (edge to edge): a light touch, close to the edge. */
const EDGE_BAND = 0.06;
const EDGE_INK = 0.5;
const EDGE_BLUR = [
  { reach: 0.5, blur: 1 },
  { reach: 0.36, blur: 2 },
  { reach: 0.24, blur: 3.5 },
  { reach: 0.13, blur: 5.5 },
] as const;
const edgeBand = (): Band => ({ width: splitWidth() * EDGE_BAND, ink: EDGE_INK, blur: EDGE_BLUR });
/** Side by side, the still's right side, in the window: a plain frame's edge, solid where it stops. */
const FRAME_BAND = 0.1;
const frameBand = (): Band => ({ width: splitWidth() * FRAME_BAND, ink: 1, blur: EDGE_BLUR });
/** Side by side, the still's side towards the text: an ellipse round the picture's right part (its
 * centre and radii, of the still's width and height), clear inside `clear` of its radius and solid at
 * its rim, which passes through the still's left edge; past the rim the page's colour runs on, so the
 * still's left corners are gone and its left side is an arc. */
const ARC = { x: 0.62, y: 0.4, rx: 0.62, ry: 0.95, clear: 0.48 } as const;
/** Blur under the arc, where it is dense: near the still's left edge (of its width). */
const ARC_BLUR = [
  { reach: 0.07, blur: 1.5 },
  { reach: 0.045, blur: 3 },
  { reach: 0.025, blur: 5 },
] as const;
const arcBand = (): Band => ({ width: splitWidth(), ink: 1, blur: ARC_BLUR });
/** The arc: a layer as wide and tall as the ellipse, its gradient the plain `radial-gradient(...)` (an
 * ellipse through the layer's corners, so the one its sides touch is at 1/√2 of that). */
const SIDE_TOUCH = Math.SQRT1_2;
const arcStyle = (height: number): ViewStyle => {
  const ink = colors.ink();
  const w = splitWidth();
  const stops = Array.from({ length: EASE_STEPS + 1 }, (_, i) => {
    const p = i / EASE_STEPS;
    return `${alpha(ink, ease(p))} ${((ARC.clear + (1 - ARC.clear) * p) * SIDE_TOUCH * 100).toFixed(2)}%`;
  });
  return {
    position: "absolute", left: 0, top: (ARC.y - ARC.ry) * height, width: 2 * ARC.rx * w, height: 2 * ARC.ry * height,
    backgroundImage: `radial-gradient(${alpha(ink, 0)} 0%, ${stops.join(", ")}, ${ink} 100%)`,
  };
};
const leftBand = (): Band => (corner() ? arcBand() : edgeBand());
const rightBand = (): Band => (corner() ? frameBand() : edgeBand());
const bandBlurStyle = (side: "left" | "right", width: number, blur: number): ViewStyle => ({
  position: "absolute", top: 0, bottom: 0, [side]: 0, width, backdropFilter: `blur(${blur}px)`,
});
/** The page's colour over the blur: dense at the foot, so the layers' steps do not show and the still
 * melts into the page; a touch at the top under the bar; the sides. */
const splitFade = (top: number): ViewStyle => {
  const ink = colors.ink();
  const clear = alpha(ink, 0);
  const right = rightBand();
  const left = corner() ? "" : `${inkRamp(90, EDGE_INK, edgeBand().width)}, `;
  return {
    ...cover(),
    backgroundImage:
      `linear-gradient(0deg, ${ink} 0%, ${alpha(ink, 0.9)} 8%, ${alpha(ink, 0.78)} 18%, ${alpha(ink, 0.64)} 28%, ${alpha(ink, 0.4)} 38%, ${alpha(ink, 0.15)} 50%, ${clear} 64%), ` +
      `linear-gradient(180deg, ${alpha(ink, 0.6)} 0%, ${clear} 12%), ` +
      `${left}${inkRamp(270, right.ink, right.width)}`,
  };
};
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
/** A split hero's text keeps to the left part of the column, so a long title wraps instead of running across the still. */
const splitTextMax = () =>
  (corner() ? columnWidth() * (1 - CORNER_SHARE + CORNER_TEXT_OVER) : Math.max(columnWidth() * 0.64, Math.min(columnWidth(), 560))) + 2 * safe().x;
const textBlockStyle = (top: number, bottom = 0, split = false): ViewStyle => ({
  paddingHorizontal: safe().x, paddingTop: top, paddingBottom: bottom, gap: u(14),
  maxWidth: split ? splitTextMax() : insetMaxWidth(density === "ten-foot" ? 1300 : 1900),
});
/** Steady: the text stands on the hero's bottom, so the actions keep their place whatever
 * the title's lines (it grows upwards into the room `top` leaves). The room under the actions
 * is the design's (`design`, TV pixels), however tall the hero (`height`, points) grows. */
const steadyBlockStyle = (top: number, design: number, height: number): ViewStyle => ({
  ...textBlockStyle(0), height, justifyContent: "flex-end", paddingBottom: u(design - HERO_TEXT_ROOM) - top,
});
/** The hero's own height (points): at least the backdrop's, or (`fit`) only what its text needs; side by side,
 * at least the still's, which stands beside the text rather than over it. */
const heroStyle = (height: number, fit: boolean, split: boolean, top: number): ViewStyle =>
  split ? (corner() ? { minHeight: splitBoxHeight(top) } : {}) : fit ? {} : { minHeight: height };
const ABOUT_LINES = 3;
/** A steady hero's text block, from `top` to its actions' bottom (TV pixels): a one-line
 * title, the meta, genres, three lines of about and the actions. */
const HERO_TEXT_ROOM = 444;
/** `steady`: always the height of its three lines, so what is under it stays put as the text changes. */
const aboutStyle = (steady: boolean): TextStyle => {
  const body = bodyText(colors.soft());
  return { numberOfLines: ABOUT_LINES, ...body, maxWidth: u(980), ...(steady ? { height: (body.lineHeight as number) * ABOUT_LINES } : {}) };
};
/** A soft dark halo under the title, so it reads on a bright still too. */
const titleHalo = "0 2px 20px #00000099, 0 1px 3px #00000066";
const logotypeStyle = (size: number, lines = 2): TextStyle => ({
  numberOfLines: lines, ...type.logotype(size), color: colors.snow(), marginBottom: u(10), textShadow: titleHalo,
});

/** The split hero's still: whole, at the top, its foot blurred and faded into the text, lit at the sides by its own glow. */
function SplitBackdrop(props: { item: () => Summary; top: number }) {
  const s = props.item;
  return (
    <View style={{ ...cover(), pointerEvents: "none" }}>
      <View style={splitBoxStyle(props.top)}>
        <If when={s().still} else={<View style={paperStyle(s().paper)} />}>
          <Image src={s().still!} style={splitStillStyle()} />
        </If>
        <Each of={BLUR_LAYERS} key={(l) => l.reach}>
          {(l) => <View style={blurLayerStyle(l().reach, l().blur)} />}
        </Each>
        <Each of={leftBand().blur} key={(l) => l.reach}>
          {(l) => <View style={bandBlurStyle("left", leftBand().width * l().reach, l().blur)} />}
        </Each>
        <Each of={rightBand().blur} key={(l) => l.reach}>
          {(l) => <View style={bandBlurStyle("right", rightBand().width * l().reach, l().blur)} />}
        </Each>
        <If when={corner()}>
          <View style={arcStyle(splitBoxHeight(props.top))} />
        </If>
        <View style={splitFade(props.top)} />
      </View>
    </View>
  );
}

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
  /** On a wide desktop window: the text at the left, the whole still at the right (`heroSplit`). */
  split?: boolean;
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
  const split = () => !!props.split && heroSplit();
  const box = computed(() => heroBoxNow(props.height, props.backdropLeft ?? 0));
  return (
    <View style={heroStyle(box().height, !!props.fit, split(), props.top)}>
      <If when={split()} else={<Backdrop item={s} box={box} />}>
        <SplitBackdrop item={s} top={props.top} />
      </If>
      {/* Not fit to its text: room under the actions before what follows. */}
      <View style={props.steadyAbout ? (split() ? splitSteadyStyle(props.top) : steadyBlockStyle(props.top, props.height, box().height)) : textBlockStyle(split() ? splitTop(props.top) : props.top, u(props.room ?? (props.fit ? 0 : 56)), split())}>
        <If when={props.onOpen} else={<Text style={logotypeStyle(props.titleSize, split() ? 3 : 2)}>{titleText(s())}</Text>}>
          {(open) => (
            <View role="link" accessibilityLabel={titleText(s())} onPress={open()} style={{ alignSelf: "flex-start" }}>
              <Text style={logotypeStyle(props.titleSize, split() ? 3 : 2)}>{titleText(s())}</Text>
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
