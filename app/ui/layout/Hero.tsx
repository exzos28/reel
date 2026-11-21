// The top of home and title screens: the still filling the top of the
// screen and fading into the background, the logotype, meta, genres,
// about and the actions bottom-left.
import { computed, effect, Image, signal, Text, untracked, View, windowSize, type ImageStyle, type JSX, type TextLayoutLine, type TextStyle, type ViewStyle } from "nsh";
import { t } from "nsh/i18n";
import { aboutText, genresText, shortAboutText, titleText, type Summary } from "../catalog";
import { cover } from "../kit/shape";
import { bodyText, metaText } from "../kit/text";
import { alpha, colors, density, heroFade, insetMaxWidth, safe, ts, type, u } from "../theme";
import { heroMeta, MetaLine } from "./HeroMeta";
import { heroBoxNow, heroFollowsWindow, stillTop, type HeroBox } from "./metrics";
import { Pressable } from "../kit/Pressable";
import { caps } from "../platform";

/** The backdrop: from the window's right edge (a wide desktop window's: its content column's), as
 * wide and tall as the hero's box says. */
const backdropStyle = (box: HeroBox, top: number): ViewStyle => ({
  position: "absolute", top, right: box.stillRight, width: box.stillWidth, height: Math.round(box.height + box.stillBelow - top), overflow: "hidden",
});
const paperStyle = (paper: string): ViewStyle => ({ flex: 1, backgroundColor: paper, opacity: 0.55 });
// A backdrop is a 16:9 frame, and people's heads sit in its upper part. On a TV and touch the
// box keeps at least 16:9 of its width (taller only when the hero is), never stretched, and
// anchored to the top: what does not fit is cut at the bottom, where the fade hides it anyway.
// A desktop's box is no wider than shows most of the frame (`heroBox`): the still covers it,
// cut a little more at the bottom than at the top, and ends 2 pt above the box: its last row of
// pixels, drawn at a fraction of a pixel as the page scrolls, showed as a line under the fade's
// solid bottom.
const stillStyle = (heroFollowsWindow
  ? { ...cover(), bottom: 2, objectFit: "cover", objectPosition: "center 30%" }
  : { width: "100%", minHeight: "100%", aspectRatio: 16 / 9, objectFit: "cover", objectPosition: "center top" }) as ImageStyle;
const fadeStyle = (): ViewStyle => ({ ...cover(), backgroundImage: heroFade() });
const leftFadeStyle = (): ViewStyle => ({
  position: "absolute", top: 0, left: 0, bottom: 0, width: "40%",
  backgroundImage: `linear-gradient(90deg, ${colors.ink()} 0%, ${alpha(colors.ink(), 0)} 100%)`,
});
/** In a window wider than its content column, the still fades out on its right across the room
 * past the column (`HeroBox.stillFadeRight` points). */
const rightFadeStyle = (width: number): ViewStyle => ({
  position: "absolute", top: 0, right: 0, bottom: 0, width,
  backgroundImage: `linear-gradient(270deg, ${RIGHT_FADE.map(([at, a]) => `${alpha(colors.ink(), a)} ${at}%`).join(", ")})`,
});
/** The right fade's stops from the still's end, [% of its width, ink's alpha]: a smoothstep, so the
 * frame dims slowly at the column's edge and fastest midway, with no band where it starts. */
const RIGHT_FADE: [number, number][] = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map((at) => {
  const x = 1 - at / 100;
  return [at, Math.round(x * x * (3 - 2 * x) * 1000) / 1000];
});
/** A desktop's shade behind the hero's text, from the window's left edge past the text's column:
 * where the still runs under the text (an ordinary window), its grey meta stays readable on a bright
 * frame. Dense where the text is, gone well before the still's middle; as tall as the still
 * (it runs on under the hero), or its bottom edge shows as a line across it. */
const textShadeStyle = (height: number): ViewStyle => ({
  position: "absolute", top: 0, left: 0, height, width: Math.min(insetMaxWidth(1500) + u(400), windowSize().width),
  backgroundImage: `linear-gradient(90deg, ${alpha(colors.ink(), 0.82)} 0%, ${alpha(colors.ink(), 0.68)} 35%, ${alpha(colors.ink(), 0.35)} 62%, ${alpha(colors.ink(), 0.1)} 82%, ${alpha(colors.ink(), 0)} 100%)`,
});
/** Touch's shade behind the hero's text only (not over the whole still): the still runs right
 * under the text there, and its bright parts washed out the grey meta. It starts a little above
 * the title, fading in, and stays under the lines to the hero's end, where the still fades out. */
const touchShadeStyle = (top: number): ViewStyle => ({
  position: "absolute", left: 0, right: 0, bottom: 0, top: Math.max(0, top - u(60)),
  backgroundImage: `linear-gradient(180deg, ${alpha(colors.ink(), 0)} 0%, ${alpha(colors.ink(), 0.45)} 25%, ${alpha(colors.ink(), 0.55)} 100%)`,
});
/** The text's column: at the inset, as wide as in an ordinary window (a wide desktop window's
 * larger inset moves it, `insetMaxWidth`, instead of narrowing it). */
const textBlockStyle = (top: number, bottom = 0): ViewStyle => ({
  paddingHorizontal: safe().x, paddingTop: top, paddingBottom: bottom, gap: u(14), maxWidth: insetMaxWidth(heroFollowsWindow ? 1500 : 1300),
});
/** Steady: the text stands on the hero's bottom, so the actions keep their place whatever
 * the title's lines (it grows upwards into the room `top` leaves). The room under the actions
 * is the design's (`design`, TV pixels), however tall the hero (`height`, points) grows. */
const steadyBlockStyle = (top: number, design: number, height: number): ViewStyle => ({
  ...textBlockStyle(0),
  justifyContent: "flex-end",
  paddingBottom: u(design - HERO_TEXT_ROOM) - top,
  // A desktop's hero grows down when its text needs more than its height (a long title): never up
  // under the window bar, never cut. A TV's keeps its height, so the page stays put as the focus
  // moves from title to title.
  ...(heroFollowsWindow ? { minHeight: height, paddingTop: top } : { height }),
});
/** The hero's own height (points): at least the backdrop's, or (`fit`) only what its text needs. */
const heroStyle = (height: number, fit: boolean): ViewStyle => (fit ? {} : { minHeight: height });
/** The about's lines: three, two on a TV, whose larger text (`ts`) would otherwise push the
 * title up under the nav and the first row past the title-safe area (the core keeps a TV's short
 * about to what two lines hold). */
const aboutLines = () => (density() === "ten-foot" ? 2 : 3);
/** A steady about's room past its three lines, in lines: exactly three lines' height lets the
 * system's rounding (a Mac's, at some window widths) drop the third, so it jumped between two and
 * three as the window resized. The limit stays three lines. */
const ABOUT_SLACK = 0.25;
/** A steady hero's text block, from `top` to its actions' bottom (TV pixels): a one-line
 * title, the meta, genres, three lines of about and the actions. */
const HERO_TEXT_ROOM = 444;
/** `steady`: always the height of its three lines, so what is under it stays put as the text changes.
 * `whole`: every line (a desktop's title page), else three. */
const aboutStyle = (steady: boolean, whole: boolean): TextStyle => {
  const body = bodyText(colors.soft());
  return { ...(whole ? {} : { numberOfLines: aboutLines() }), ...body, maxWidth: u(980), ...(steady ? { height: (body.lineHeight as number) * (aboutLines() + ABOUT_SLACK) } : {}) };
};
/** The title: two lines on a TV and touch; a desktop's whole, however many lines (its hero grows
 * with its text, Home's too). */
const logotypeStyle = (size: number, whole: boolean, title: string): TextStyle => ({
  ...(!heroFollowsWindow || !whole ? { numberOfLines: 2 } : {}),
  ...type.logotype(size, title.length),
  color: colors.snow(),
  marginBottom: u(10),
});

/** The least a title's logotype shrinks to, of its size, so its longest word fits the column. */
const TITLE_MIN = 0.5;
/** Whether the laid-out lines break inside a word (a word wider than the column), not at a space
 * or after a hyphen. */
export function breaksInWord(lines: readonly { text: string }[]): boolean {
  for (let i = 0; i + 1 < lines.length; i++) {
    if (/[\p{L}\p{N}]$/u.test(lines[i].text) && /^[\p{L}\p{N}]/u.test(lines[i + 1].text)) return true;
  }
  return false;
}

/** The title's logotype: it keeps its words whole, shrinking (down to `TITLE_MIN`) while a word
 * does not fit the column's width; a new title or a resized window starts over at its size. */
function Logotype(props: { title: () => string; size: number; whole: boolean }) {
  const scale = signal(1);
  effect(() => {
    props.title();
    windowSize().width;
    scale.set(1);
  });
  const fit = (lines: TextLayoutLine[]) => {
    const now = untracked(scale);
    if (now > TITLE_MIN && breaksInWord(lines)) scale.set(Math.max(TITLE_MIN, now * 0.9));
  };
  return (
    <Text style={logotypeStyle(props.size * scale(), props.whole, props.title())} onTextLayout={(e) => fit(e.lines)}>
      {props.title()}
    </Text>
  );
}

/** The still (or the title's paper colour) fading into the background; where it starts
 * after the window's left edge, it also fades in from there. */
function Backdrop(props: { item: () => Summary; box: () => HeroBox }) {
  const s = props.item;
  // Where a fixed bar lies over the page (a phone's Home tabs), the still starts under it: the bar
  // never cuts it. Taken once, as the page opens: it stays put under a page pushed over it.
  const top = untracked(stillTop);
  return (
    <View style={backdropStyle(props.box(), top)}>
      <If when={s().still} else={<View style={paperStyle(s().paper)} />}>
        <Image src={s().still!} style={stillStyle} />
      </If>
      <View style={fadeStyle()} />
      <If when={props.box().stillLeft > 0.5}>
        <View style={leftFadeStyle()} />
      </If>
      <If when={props.box().stillFadeRight > 0.5}>
        <View style={rightFadeStyle(props.box().stillFadeRight)} />
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
  /** The whole about, not three lines (a desktop's title page: nothing under it repeats it). */
  wholeAbout?: boolean;
  /** The whole title, however many lines (a desktop's title page: the hero grows with its text). */
  wholeTitle?: boolean;
  /** A tap on the about shows it whole, another folds it back to three lines (a title's page on
   * touch, where nothing under the hero repeats it). */
  expandAbout?: boolean;
  children: JSX.Element;
}) {
  const s = props.item;
  const whole = signal(false);
  const about = () => (
    <Text style={aboutStyle(!!props.steadyAbout, !!props.wholeAbout || whole())}>
      {props.wholeAbout || whole() ? aboutText(s()) : shortAboutText(s())}
    </Text>
  );
  const box = computed(() => heroBoxNow(props.height, props.backdropLeft ?? 0));
  return (
    <View style={heroStyle(box().height, !!props.fit)}>
      <Backdrop item={s} box={box} />
      <If when={heroFollowsWindow} else={<If when={caps.touch}><View style={touchShadeStyle(props.top)} /></If>}>
        <View style={textShadeStyle(box().height + box().stillBelow)} />
      </If>
      {/* Not fit to its text: room under the actions before what follows. */}
      <View style={props.steadyAbout ? steadyBlockStyle(props.top, props.height, box().height) : textBlockStyle(props.top, u(props.room ?? (props.fit ? 0 : 56)))}>
        <If when={props.onOpen} else={<Logotype title={() => titleText(s())} size={props.titleSize} whole={!!props.wholeTitle} />}>
          {(open) => (
            <Pressable role="link" accessibilityLabel={titleText(s())} onPress={open()} style={{ alignSelf: "flex-start", maxWidth: "100%" }}>
              <Logotype title={() => titleText(s())} size={props.titleSize} whole={!!props.wholeTitle} />
            </Pressable>
          )}
        </If>
        <MetaLine item={s} />
        <Text style={{ ...metaText(heroMeta()), fontSize: ts(24) }}>{genresText(s())}</Text>
        <If when={props.expandAbout} else={about()}>
          <Pressable
            role="button"
            accessibilityLabel={t(whole() ? "title.about_less" : "title.about_more")}
            accessibilityState={{ expanded: whole() }}
            onPress={() => whole.set(!whole())}
          >
            {about()}
          </Pressable>
        </If>
        {props.children}
      </View>
    </View>
  );
}
