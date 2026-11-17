// The player's volume on a computer: the speaker (mutes and unmutes, M too) and a bar beside it
// (a press sets the level where it lands, the wheel over it moves it). A TV's remote and a phone's
// buttons have their own, so neither shows it. The level lasts while the app runs.
import { signal, View, type ViewStyle } from "nsh";
import { t } from "nsh/i18n";
import volumeIcon from "./icons/volume.svg";
import volumeOffIcon from "./icons/volume-off.svg";
import { Icon } from "./kit/Icon";
import { row } from "./kit/shape";
import { chrome } from "./layout/chrome";
import { alpha, colors, iconPt, targetSlop, u } from "./theme";

/** Volume shows on the desktops only. */
export const volumeShown = chrome === "mac" || chrome === "windows" || chrome === "linux";

/** 0..1, and whether it is muted (the level is kept for unmuting). */
export const volume = signal(1);
export const muted = signal(false);
/** What the video plays at. */
export const playVolume = () => (muted() ? 0 : volume());
export const toggleMute = () => muted.set(!muted());

/** One wheel notch moves the level this much. */
const WHEEL_STEP = 0.05;

const discStyle = (): ViewStyle => ({ width: u(64), height: u(64), borderRadius: u(32), alignItems: "center", justifyContent: "center" });
const barStyle = (): ViewStyle => ({ width: u(180), height: u(40), justifyContent: "center" });
const trackStyle = (): ViewStyle => ({ height: u(6), borderRadius: u(3), backgroundColor: alpha(colors.snow(), 0.2), overflow: "hidden" });

export function PlayerVolume(props: { onUse: () => void }) {
  const width = signal(0);
  /** A press on the bar starts a drag: the level follows the pointer until it is let go. */
  const dragging = signal(false);
  const follow = (x: number) => width() > 0 && set(x / width());
  const set = (v: number) => {
    volume.set(Math.min(1, Math.max(0, v)));
    if (volume() > 0) muted.set(false);
    props.onUse();
  };
  return (
    <View style={row(u(6))}>
      <View
        role="button"
        accessibilityLabel={t(muted() ? "player.unmute" : "player.mute")}
        hitSlop={targetSlop(u(64))}
        onPress={() => (toggleMute(), props.onUse())}
        hoverStyle={{ backgroundColor: alpha(colors.snow(), 0.12) }}
        style={discStyle()}
      >
        <Icon src={() => (muted() || volume() === 0 ? volumeOffIcon : volumeIcon)} size={iconPt(18)} />
      </View>
      <View
        role="adjustable"
        accessibilityLabel={t("player.volume")}
        accessibilityValue={{ min: 0, max: 100, now: Math.round(playVolume() * 100) }}
        onLayout={(e) => width.set(e.bounds.size.width)}
        onPressDown={(e) => (dragging.set(true), follow(e.position.x))}
        onMouseMove={(e) => dragging() && follow(e.position.x)}
        onPressUp={() => dragging.set(false)}
        onMouseUp={() => dragging.set(false)}
        onPress={(e) => follow(e.position.x)}
        onWheel={(e) => set(volume() - Math.sign(e.delta.y || -e.delta.x) * WHEEL_STEP)}
        style={barStyle()}
      >
        <View style={trackStyle()}>
          <View style={{ height: "100%", width: `${playVolume() * 100}%`, backgroundColor: colors.snow() }} />
        </View>
      </View>
    </View>
  );
}
