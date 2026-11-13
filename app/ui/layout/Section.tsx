import { Text, View, type TextStyle } from "nsh";
import { row } from "../kit/shape";
import { metaText, sectionTitle } from "../kit/text";
import { safe, u } from "../theme";

const insetTitle = (): TextStyle => ({ ...sectionTitle(), paddingHorizontal: safe().x });

/** A section's title, inside the safe area when `inset`. */
export function SectionTitle(props: { text: () => string; inset?: boolean }) {
  return <Text style={props.inset ? insetTitle() : sectionTitle()}>{props.text()}</Text>;
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
