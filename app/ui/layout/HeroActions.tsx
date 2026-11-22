// A hero's actions: the red Play (on a title's page split, the release it plays inside it),
// the grey list toggle, Save and Trailer.
import { Text, View, type TextStyle, type ViewStyle } from "nsh";
import { t } from "nsh/i18n";
import { Button } from "../kit/Button";
import { rounded, row } from "../kit/shape";
import { cs, font, radius, targetSlop, ts, u } from "../theme";
import playIcon from "../icons/play.svg";
import plusIcon from "../icons/plus.svg";
import checkIcon from "../icons/check.svg";
import chevronIcon from "../icons/chevron.svg";
import trailerIcon from "../icons/trailer.svg";
import savedIcon from "../icons/saved.svg";
import type { SaveState } from "../library";
import { Fmt } from "../native";
import type { releaseLine } from "../catalog";
import { ShortRelease } from "./HeroMeta";
import { Icon } from "../kit/Icon";
import { alpha, colors, focusRing, showFocus } from "../theme";
import { labelText, oneLine } from "../kit/text";
import { Pressable } from "../kit/Pressable";

/** The row they sit in; `wrap`: with the release line beside them. */
export const actionsRow = (wrap: boolean): ViewStyle =>
  wrap ? { ...row(u(16)), flexWrap: "wrap", marginTop: u(12) } : { flexDirection: "row", gap: u(16), marginTop: u(12) };

export function PlayButton(props: { label: () => string; focused: () => boolean; onPress: () => void; disabled?: () => boolean; height?: number; grow?: boolean }) {
  return <Button kind="play" icon={() => playIcon} label={props.label} focused={props.focused} onPress={props.onPress} disabled={props.disabled} height={props.height} grow={props.grow} />;
}

/** "My list" / "Add to list" (`addKey`), "In my list" with a check once added. */
export function ListButton(props: { inList: () => boolean; addKey: string; focused: () => boolean; onPress: () => void }) {
  return (
    <Button
      kind="secondary"
      icon={() => (props.inList() ? checkIcon : plusIcon)}
      label={() => (props.inList() ? t("title.in_list") : t(props.addKey))}
      focused={props.focused}
      onPress={props.onPress}
    />
  );
}

/** "Trailer": opens the title's trailer outside the app. */
export function TrailerButton(props: { focused: () => boolean; onPress: () => void; height?: number; grow?: boolean }) {
  return <Button kind="secondary" icon={() => trailerIcon} label={() => t("title.trailer")} focused={props.focused} onPress={props.onPress} height={props.height} grow={props.grow} />;
}

/** The split Play's height: two lines in the red part (TV pixels); the buttons beside it and
 * Play without a release keep it. */
export const SPLIT_HEIGHT = 84;
const SPLIT = SPLIT_HEIGHT;
const playEdge = (side: "left" | "right"): ViewStyle =>
  side === "left"
    ? { borderTopLeftRadius: radius(), borderBottomLeftRadius: radius(), borderCurve: "continuous" }
    : { borderTopRightRadius: radius(), borderBottomRightRadius: radius(), borderCurve: "continuous" };
/** The split as one control: the focus's ring and lift go around both parts (a ring around one
 * part ran into the other), and the part the focus is on stays red (`lit`). */
const splitStyle = (stretch: boolean, focused: boolean): ViewStyle => ({
  flexDirection: "row",
  alignItems: "stretch",
  height: cs(SPLIT),
  ...(stretch ? { flexGrow: 1 } : {}),
  ...rounded(),
  ...focusRing(focused),
});
/** A part's fill: red, or grey while the focus is on the other part. What is written on it is
 * white either way. */
const partFill = (lit: boolean) => (lit ? colors.play() : colors.raise());
const playPartStyle = (lit: boolean, stretch: boolean): ViewStyle => ({
  ...row(u(16)),
  flexGrow: stretch ? 1 : 0,
  flexShrink: 1,
  minWidth: stretch ? 0 : cs(480),
  maxWidth: stretch ? undefined : cs(760),
  paddingHorizontal: cs(26),
  backgroundColor: partFill(lit),
  ...playEdge("left"),
});
const morePartStyle = (lit: boolean): ViewStyle => ({
  width: cs(76),
  alignItems: "center",
  justifyContent: "center",
  backgroundColor: partFill(lit),
  ...playEdge("right"),
});
/** The seam between the two parts: a thin dark line, inset top and bottom, on red; a gap while
 * one part is grey. */
const seamStyle = (bothLit: boolean): ViewStyle => ({ width: 1, backgroundColor: bothLit ? colors.play() : "transparent", paddingVertical: cs(16) });
const seamLine = (): ViewStyle => ({ flexGrow: 1, backgroundColor: alpha(colors.ink(), 0.3) });
const playLabelStyle = (): TextStyle => ({ ...labelText(colors.snow()), fontSize: ts(26), fontWeight: 600 });
/** At least 13 pt, white: on the red part 4.9:1 (white at 0.8 was 3.6:1). Under the label by
 * its size and weight. */
const subStyle = (): TextStyle => ({ fontFamily: font, fontSize: Math.max(13, ts(20)), color: colors.snow() });
/** The watched part along the red part's bottom: white on a darker track. */
const trackStyle = (): ViewStyle => ({ position: "absolute", left: 0, right: 0, bottom: 0, height: Math.max(2, cs(4)), backgroundColor: alpha(colors.ink(), 0.3), borderBottomLeftRadius: radius() });
const watchedStyle = (part: number): ViewStyle => ({ width: `${Math.round(Math.min(1, part) * 100)}%`, height: "100%", borderBottomLeftRadius: radius(), backgroundColor: colors.snow() });
/** The release line while it is coming: pulsing, as the release list's skeleton does. */
const pendingStyle = (): TextStyle => ({
  ...subStyle(),
  animationName: "pulse",
  animationDuration: 1400,
  animationIterationCount: "infinite",
  animationFrameRate: 30,
});

/** Play with the release it plays inside it (concept B): the red part says "Resume 14:30" and
 * under it "1080p BluRay · 25 GB · 22 people sharing" (`release`; while it is coming,
 * `pending`'s words, pulsing), the watched part along its bottom (`progress`); past a seam, ⌄
 * opens the other releases. Each part is its own focus stop. `stretch`: as wide as its row. */
export function SplitPlay(props: {
  label: () => string;
  release: () => ReturnType<typeof releaseLine> | null;
  pending: () => string | null;
  progress: () => number;
  playFocused: () => boolean;
  moreFocused: () => boolean;
  onPlay: () => void;
  onMore: () => void;
  stretch: boolean;
}) {
  /** Each part is red but while the focus shows on the other. */
  const playLit = () => !(props.moreFocused() && showFocus());
  const moreLit = () => !(props.playFocused() && showFocus());
  return (
    <View testID="split-play" style={splitStyle(props.stretch, props.playFocused() || props.moreFocused())}>
      <Pressable role="button" accessibilityLabel={props.label()} hitSlop={targetSlop(cs(SPLIT))} onPress={props.onPlay} hoverStyle={{ opacity: 0.9 }} style={playPartStyle(playLit(), props.stretch)}>
        <Icon src={() => playIcon} size={26} color={colors.snow} />
        <View style={{ flexShrink: 1, minWidth: 0, gap: u(2) }}>
          <Text style={{ ...playLabelStyle(), ...oneLine }}>{props.label()}</Text>
          <If when={props.release()} else={<Text testID="release-row-skeleton" style={{ ...pendingStyle(), ...oneLine }}>{props.pending() ?? ""}</Text>}>
            <ShortRelease line={() => props.release()!} style={subStyle} />
          </If>
        </View>
        <If when={props.progress() > 0 && props.progress() < 1}>
          <View style={trackStyle()}>
            <View style={watchedStyle(props.progress())} />
          </View>
        </If>
      </Pressable>
      <View style={seamStyle(playLit() && moreLit())}>
        <If when={playLit() && moreLit()}>
          <View style={seamLine()} />
        </If>
      </View>
      <Pressable testID="split-play-more" role="button" accessibilityLabel={t("title.other_releases")} hitSlop={targetSlop(cs(76))} onPress={props.onMore} hoverStyle={{ opacity: 0.9 }} style={morePartStyle(moreLit())}>
        <Icon src={() => chevronIcon} size={26} color={colors.snow} />
      </Pressable>
    </View>
  );
}

const SAVING = new Set(["saving", "searching", "resolving", "waiting"]);

/** Save (design/offline-downloads.md): "Save" (a film's with what it takes: "Save · 700 MB"),
 * then what is saved of the title: "Saving 34%", a show's "Saving 2 of 5", "Paused", "Saved"
 * with a check. */
export function SaveButton(props: { state: () => SaveState; show: () => boolean; size?: () => number | null; focused: () => boolean; onPress: () => void; disabled?: () => boolean; height?: number; grow?: boolean }) {
  const s = props.state;
  const label = () => {
    switch (s().state) {
      case "saving":
      case "searching":
      case "resolving":
      case "waiting":
        return props.show()
          ? t("title.saving_some", { count: s().saving ?? 0, total: (s().saving ?? 0) + (s().saved ?? 0) })
          : t("title.saving", { percent: Math.floor(s().progress * 100) });
      case "paused":
        return t("title.save_paused");
      case "saved":
        return t("title.saved");
      case "some":
        return t(s().saved === 1 ? "title.saved_one" : "title.saved_some", { count: s().saved ?? 0 });
      default: {
        const size = props.size?.();
        return size != null ? t("title.save_size", { size: Fmt.size(size) }) : t("title.save");
      }
    }
  };
  /** A film's part saved, while it saves (a show's count says how it goes). */
  const fill = () => (!props.show() && SAVING.has(s().state) ? s().progress : null);
  return (
    <Button
      kind="secondary"
      icon={() => (s().state === "saved" ? checkIcon : savedIcon)}
      label={label}
      focused={props.focused}
      onPress={props.onPress}
      disabled={props.disabled}
      height={props.height}
      grow={props.grow}
      fill={fill}
    />
  );
}
