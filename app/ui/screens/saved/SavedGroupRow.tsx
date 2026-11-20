// A show on the Saved screen: one row for its saved episodes ("The Mentalist · 4 episodes ·
// 6.6 GB"), a chevron that opens and closes them under it, and Remove for them all.
import { Image, Text, View, type ViewRef, type ViewStyle } from "nsh";
import { t } from "nsh/i18n";
import { Icon } from "../../kit/Icon";
import { IconButton } from "../../kit/IconButton";
import { rowStyle } from "../../kit/Row";
import { cover, rounded, row } from "../../kit/shape";
import { labelText, metaText, oneLine } from "../../kit/text";
import { Fmt } from "../../native";
import type { SavedGroup } from "../../library";
import { alpha, colors, cs, targetSlop, u } from "../../theme";
import chevronIcon from "../../icons/chevron.svg";
import { SpeedLine } from "../../kit/SpeedLine";
import { actionsBlock, compact, stateColumn } from "./SavedRow";
import pauseIcon from "../../icons/pause.svg";
import playIcon from "../../icons/play.svg";
import trashIcon from "../../icons/trash.svg";
import { Pressable } from "../../kit/Pressable";

const groupStyle = (focused: boolean): ViewStyle => ({
  ...rowStyle(false, focused, u(24)),
  ...(compact ? { minHeight: cs(108), paddingVertical: cs(12) } : { height: cs(108) }),
  paddingLeft: cs(10),
  paddingRight: cs(22),
});
const thumbStyle = (): ViewStyle => ({ width: cs(compact ? 96 : 160), height: cs(compact ? 54 : 90), ...rounded(u(8)), overflow: "hidden", backgroundColor: colors.raise() });
const imageStyle = () => ({ ...cover(), objectFit: "cover" }) as ViewStyle;
const progressTrack = (): ViewStyle => ({ height: cs(4), ...rounded(999), backgroundColor: colors.raise(), overflow: "hidden", marginTop: u(8), width: compact ? "100%" : cs(300) });
const progressFill = (p: number): ViewStyle => ({ height: "100%", width: `${Math.round(p * 100)}%`, backgroundColor: alpha(colors.snow(), 0.45) });

export function SavedGroupRow(props: {
  group: () => SavedGroup;
  open: () => boolean;
  /** Whether its episodes are still saving (a progress bar for them all). */
  saving: boolean;
  /** 0 the row, 1 pause or resume, 2 remove; null: none. */
  focusedPart: () => number | null;
  viewRef: (r: ViewRef) => void;
  onToggle: () => void;
  /** Pauses its episodes that save, or (all paused) goes on with them; none: nothing to pause. */
  onPause?: () => void;
  /** Its episodes are all paused. */
  paused: () => boolean;
  onRemove: () => void;
}) {
  const g = props.group;
  const state = () => (
    <If when={props.saving}>
      <View>
        <Text style={metaText()}>
          {g().checking ? t("saved.state.checking") : t("saved.state.saving", { percent: Math.floor(g().progress * 100), have: Fmt.size(g().have), size: Fmt.size(g().size) })}
        </Text>
        <If when={!g().checking}>
          <View style={progressTrack()}>
            <View style={progressFill(g().progress)} />
          </View>
        </If>
        <If when={g().speed != null}>
          <SpeedLine speed={() => g().speed!} peers={() => g().peers} />
        </If>
      </View>
    </If>
  );
  const line = () => t(g().count === 1 ? "saved.group_line_one" : "saved.group_line", { count: g().count, size: Fmt.size(g().size) });
  return (
    <Pressable feedback="row"
      ref={props.viewRef}
      role="button"
      accessibilityLabel={g().title}
      accessibilityState={{ expanded: props.open() }}
      hitSlop={targetSlop(cs(108))}
      onPress={props.onToggle}
      hoverStyle={{ backgroundColor: colors.raise() }}
      style={groupStyle(props.focusedPart() === 0)}
    >
      <View style={thumbStyle()}>
        <If when={g().image}>
          <Image src={g().image} style={imageStyle()} />
        </If>
      </View>
      <View style={{ flex: 1, gap: u(4) }}>
        <Text style={{ ...labelText(), ...oneLine }}>{g().title}</Text>
        <Text style={{ ...metaText(), ...oneLine }}>{line()}</Text>
        <If when={compact}>{state()}</If>
      </View>
      <If when={!compact}>
        <View style={stateColumn()}>{state()}</View>
      </If>
      <View style={actionsBlock()}>
        <If when={props.onPause}>
          <IconButton
            size={44}
            icon={() => (props.paused() ? playIcon : pauseIcon)}
            label={() => t(props.paused() ? "saved.resume_all" : "saved.pause_all")}
            focused={() => props.focusedPart() === 1}
            background={() => colors.raise()}
            onPress={props.onPause!}
          />
        </If>
        <View style={{ transform: [{ rotate: props.open() ? "180deg" : "0deg" }] }}>
          <Icon src={() => chevronIcon} size={22} color={() => colors.snow()} />
        </View>
        <IconButton size={44} icon={() => trashIcon} label={() => t("saved.remove_all")} focused={() => props.focusedPart() === 2} background={() => colors.raise()} onPress={props.onRemove} />
      </View>
    </Pressable>
  );
}
