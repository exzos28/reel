// What shows while something loads, as Settings says (`preferences.loader`): nothing (the
// default: the screen's own lines say it), or the running dinosaur. Screens use this, never a
// loader of their own, so the setting reaches every one at once. With reduced motion the
// dinosaur stands still.
import { View, type ViewStyle } from "nsh";
import { loader } from "../preferences";
import { DinoLoader } from "./DinoLoader";

/** `size`: its width, TV pixels (96 by default); `label`: what a screen reader says; `style`:
 * its place among the screen's lines (none takes no room). */
export function Loader(props: { size?: number; label?: string; style?: ViewStyle }) {
  return (
    <If when={loader() === "dinosaur"}>
      <View style={props.style}>
        <DinoLoader size={props.size ?? 96} label={props.label} />
      </View>
    </If>
  );
}
