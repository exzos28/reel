// The player's volume on a computer: the speaker (mutes and unmutes, M too) and a slider beside
// it (a press sets the level where it lands, a drag moves it, the wheel over it too). A TV's remote and a phone's
// buttons have their own, so neither shows it. The level lasts while the app runs.
import { signal, View, type ViewStyle } from "nsh";
import { t } from "nsh/i18n";
import volumeIcon from "./icons/volume.svg";
import volumeOffIcon from "./icons/volume-off.svg";
import { Icon } from "./kit/Icon";
import { row } from "./kit/shape";
import { family } from "./platform";
import { alpha, colors, iconPt, targetSlop, u } from "./theme";
import { Pressable } from "./kit/Pressable";
import { TrackSlider } from "./kit/TrackSlider";

/** Volume shows on the desktops only. */
export const volumeShown = family === "mac" || family === "windows" || family === "linux";

/** 0..1, and whether it is muted (the level is kept for unmuting). */
export const volume = signal(1);
export const muted = signal(false);
/** What the video plays at. */
export const playVolume = () => (muted() ? 0 : volume());
export const toggleMute = () => muted.set(!muted());

const setLevel = (v: number) => {
  volume.set(Math.min(1, Math.max(0, v)));
  if (volume() > 0) muted.set(false);
};

/** One wheel notch, or a screen reader's step, moves the level this much. */
const STEP = 0.05;

const discStyle = (): ViewStyle => ({ width: u(64), height: u(64), borderRadius: u(32), alignItems: "center", justifyContent: "center" });

export function PlayerVolume(props: { onUse: () => void; onHold: (held: boolean) => void }) {
  const set = (v: number) => {
    setLevel(v);
    props.onUse();
  };
  /** The level and mute when a drag began: a drag that ends with no change puts them back. */
  let before = { level: 1, muted: false };
  return (
    <View style={row(u(6))}>
      <Pressable
        role="button"
        accessibilityLabel={t(muted() ? "player.unmute" : "player.mute")}
        hitSlop={targetSlop(u(64))}
        onPress={() => (toggleMute(), props.onUse())}
        hoverStyle={{ backgroundColor: alpha(colors.snow(), 0.12) }}
        style={discStyle()}
      >
        <Icon src={() => (muted() || volume() === 0 ? volumeOffIcon : volumeIcon)} size={iconPt(18)} />
      </Pressable>
      <TrackSlider
        testID="volume"
        accessibilityLabel={t("player.volume")}
        valueText={() => `${Math.round(playVolume() * 100)}%`}
        value={playVolume}
        // The level follows the drag: it is heard while it moves.
        onScrub={(v) => (v != null ? set(v) : (volume.set(before.level), muted.set(before.muted)))}
        onCommit={set}
        onHold={(held) => {
          if (held) before = { level: volume(), muted: muted() };
          props.onHold(held);
        }}
        onStep={(dir) => set(volume() + dir * STEP)}
        onWheel={(e) => set(volume() - Math.sign(e.delta.y || -e.delta.x) * STEP)}
        track={u(6)}
        thumb={u(22)}
        // Taller than the bar it draws: a drag starts anywhere near it.
        height={u(72)}
        style={{ width: u(180) }}
      />
    </View>
  );
}
