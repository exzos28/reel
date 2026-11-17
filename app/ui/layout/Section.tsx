import { Text, View, type TextStyle } from "nsh";
import { row } from "../kit/shape";
import { metaText, sectionTitle } from "../kit/text";
import { safe, u } from "../theme";
import { railArrows, RailArrows } from "./RailArrows";
import type { ScrollCtl } from "./Scroller";

const insetTitle = (): TextStyle => ({ ...sectionTitle(), paddingHorizontal: safe().x });

/** A section's title, inside the safe area when `inset`; with `rail`, the arrows of the row
 * under it on its right (computers). */
export function SectionTitle(props: { text: () => string; inset?: boolean; rail?: ScrollCtl }) {
  return (
    <If when={props.rail && railArrows} else={<Text style={props.inset ? insetTitle() : sectionTitle()}>{props.text()}</Text>}>
      <View style={{ ...row(u(16)), justifyContent: "space-between", paddingHorizontal: props.inset ? safe().x : 0 }}>
        <Text style={sectionTitle()}>{props.text()}</Text>
        <RailArrows ctl={props.rail!} />
      </View>
    </If>
  );
}

/** A section's title with a grey note on its baseline: "Releases  3 found". */
export function SectionHeader(props: { title: () => string; note: () => string }) {
  return (
    <View style={row(u(18), "baseline")}>
      <Text style={sectionTitle()}>{props.title()}</Text>
      <Text style={metaText()}>{props.note()}</Text>
    </View>
  );
}
