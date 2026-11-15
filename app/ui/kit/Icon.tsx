import { Image, type ImageAsset, type ImageStyle } from "nsh";
import { colors, cs, u } from "../theme";

const iconStyle = (size: number, color: string): ImageStyle => ({ width: cs(size), height: cs(size), tintColor: color });

/** A tinted SVG icon, `size` TV pixels square (`snow` unless `color` says). */
export function Icon(props: { src: () => ImageAsset | string; size: number; color?: () => string }) {
  return <Image src={props.src()} style={iconStyle(props.size, props.color ? props.color() : colors.snow())} />;
}
