// What is saved of a film or an episode, as a small round mark (as Apple's apps show a
// download): a white disc with a check once saved, a ring that fills while it saves (dimmer
// while paused), a spinning arc while its torrent is found. No words: the row says the rest.
import { View, type ViewStyle } from "nsh";
import { Icon } from "./Icon";
import { rounded } from "./shape";
import { alpha, colors, cs } from "../theme";
import checkIcon from "../icons/check.svg";

const SIZE = 26;
const STROKE = 3;

const disc = (): ViewStyle => ({ width: cs(SIZE), height: cs(SIZE), ...rounded(999), alignItems: "center", justifyContent: "center", backgroundColor: colors.snow() });
/** A ring: the filled share as a conic gradient, the middle cut out by a disc of the row's colour. */
const ring = (share: number, color: string, spin: boolean, size = SIZE): ViewStyle => ({
  width: cs(size),
  height: cs(size),
  ...rounded(999),
  alignItems: "center",
  justifyContent: "center",
  backgroundImage: `conic-gradient(${color} 0% ${Math.round(share * 100)}%, ${alpha(colors.snow(), 0.18)} ${Math.round(share * 100)}% 100%)`,
  ...(spin ? { animationName: "spin", animationDuration: 1000, animationIterationCount: "infinite", animationFrameRate: 30 } : {}),
});
const hole = (bg: string, size = SIZE, stroke = STROKE): ViewStyle => ({ width: cs(size - 2 * stroke), height: cs(size - 2 * stroke), ...rounded(999), backgroundColor: bg });

/** A small ring of saving progress alone (the phone's Saved tab), `size` across with a `stroke`
 * thick line, its middle the colour under it. */
export function ProgressRing(props: { progress: () => number; size: number; stroke: number; background: () => string }) {
  return (
    <View style={ring(Math.max(props.progress(), 0.04), colors.snow(), false, props.size)}>
      <View style={hole(props.background(), props.size, props.stroke)} />
    </View>
  );
}

export function SaveMark(props: { state: () => string; progress: () => number; background: () => string }) {
  const s = props.state;
  return (
    <If
      when={s() === "saved"}
      else={
        <View style={ring(s() === "saving" || s() === "paused" ? Math.max(props.progress(), 0.02) : 0.25, s() === "paused" ? colors.ash() : colors.snow(), !["saving", "paused"].includes(s()))}>
          <View style={hole(props.background())} />
        </View>
      }
    >
      <View style={disc()}>
        <Icon src={() => checkIcon} size={15} color={() => colors.ink()} />
      </View>
    </If>
  );
}
