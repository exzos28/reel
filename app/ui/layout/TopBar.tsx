// The top of a screen without the nav: the back button in the safe area's
// top-left corner, alone over a hero or beside the page's title.
import { Text, View, type ViewStyle } from "nsh";
import { row } from "../kit/shape";
import { pageTitle } from "../kit/text";
import { safe, u } from "../theme";
import { BackButton } from "./BackButton";

const cornerStyle = (): ViewStyle => ({ position: "absolute", top: safe().y, left: safe().x, zIndex: 3 });

/** The back button floating over a hero. */
export function FloatingBack(props: { focused: () => boolean; onPress: () => void }) {
  return (
    <View style={cornerStyle()}>
      <BackButton focused={props.focused} onPress={props.onPress} />
    </View>
  );
}

/** The back button, then the page's title, aligned to the top. */
export function PageHeader(props: { title: () => string; focused: () => boolean; onBack: () => void }) {
  return (
    <View style={row(u(24), "flex-start")}>
      <BackButton focused={props.focused} onPress={props.onBack} />
      <Text style={pageTitle()}>{props.title()}</Text>
    </View>
  );
}
