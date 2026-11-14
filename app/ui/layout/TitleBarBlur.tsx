// The Mac's title bar over a scrolled page: what passes under the traffic
// lights is blurred and darkened, as the system's own bars do.
import { ShaderEffect, View, type ViewStyle } from "nsh";
import { titleBar } from "nsh/desktop";
import { colors } from "../theme";
import { pageScrolled } from "./scrollCtl";

/** A wide Gaussian along x, a narrower one along y (the bar is low), then a tint. */
const BLUR = /* wgsl */ `
struct Uniforms { tint: vec4f, shown: f32 }
fn shade(uv: vec2f) -> vec4f {
  let px = 1.0 / nsh.size;
  var sum = vec4f(0.0);
  var total = 0.0;
  for (var i = -6; i <= 6; i++) {
    for (var j = -3; j <= 3; j++) {
      let k = exp(-(f32(i * i) / 18.0 + f32(j * j) / 6.0));
      sum += sample_backdrop(uv + vec2f(f32(i) * 4.0, f32(j) * 3.0) * px) * k;
      total += k;
    }
  }
  let blurred = sum / total;
  let rgb = mix(blurred.rgb, uniforms.tint.rgb, 0.45);
  return vec4f(rgb, uniforms.shown);
}
`;

const barStyle = (): ViewStyle => ({ position: "absolute", top: 0, left: 0, right: 0, height: titleBar().height, zIndex: 9 });

export function TitleBarBlur() {
  return (
    <ShaderEffect
      source={BLUR}
      maxSampleOffset={24}
      uniforms={{ tint: colors.ink(), shown: pageScrolled() ? 1 : 0 }}
      style={{ ...barStyle(), pointerEvents: "none" }}
    >
      <View style={{ flex: 1 }} />
    </ShaderEffect>
  );
}
