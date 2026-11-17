// reel's loader: its own little dinosaur (the website's, site/runner.js) running on the spot, its
// legs taking turns. With reduced motion it stands still.
import { cleanup, Image, reduceMotion, signal, View, type ViewStyle } from "nsh";
import bodyIcon from "../icons/dino-body.svg";
import legsA from "../icons/dino-legs-a.svg";
import legsB from "../icons/dino-legs-b.svg";
import { alpha, colors, u } from "../theme";

/** One step, ms (the website's dinosaur steps every 90 ms at full speed; on the spot, calmer). */
const STEP_MS = 140;

const frameStyle = (size: number): ViewStyle => ({ width: u(size), height: u(size * (52 / 64)) });
const layer: ViewStyle = { position: "absolute", top: 0, left: 0, width: "100%", height: "100%" };

/** `size`: its width, TV pixels. */
export function DinoLoader(props: { size?: number; label?: string }) {
  const size = props.size ?? 96;
  const step = signal(0);
  if (!reduceMotion()) {
    const timer = setInterval(() => step.set(step() + 1), STEP_MS);
    cleanup(() => clearInterval(timer));
  }
  return (
    <View accessibilityLabel={props.label} style={{ alignItems: "center" }}>
      <View style={frameStyle(size)}>
        <Image src={bodyIcon} style={layer} />
        <Image src={step() % 2 === 0 ? legsA : legsB} style={layer} />
      </View>
      {/* The ground it runs on. */}
      <View style={{ width: u(size * 1.4), height: Math.max(1, u(2)), backgroundColor: alpha(colors.snow(), 0.18), marginTop: u(2) }} />
    </View>
  );
}
