// The top of a deep page on touch: the back button in the safe area's top-left
// corner, alone over a hero or beside the page's title. A TV has no Back on
// screen (the remote's key), a desktop has it in the window bar.
import { Text, View, type ViewStyle } from "nsh";
import { row } from "../kit/shape";
import { pageTitle } from "../kit/text";
import { safe, u } from "../theme";
import { BackButton } from "./BackButton";
import { isTouch } from "./chrome";

const cornerStyle = (): ViewStyle => ({ position: "absolute", top: safe().y, left: safe().x, zIndex: 3 });

/** The back button floating over a hero (touch only). */
export function FloatingBack(props: { onPress: () => void }) {
  return (
    <If when={isTouch}>
      <View style={cornerStyle()}>
        <BackButton focused={() => false} onPress={props.onPress} />
      </View>
    </If>
  );
}

/** The back button (touch only), then the page's title, aligned to the top. */
export function PageHeader(props: { title: () => string; onBack: () => void }) {
  return (
    <View style={row(u(24), "flex-start")}>
      <If when={isTouch}>
        <BackButton focused={() => false} onPress={props.onBack} />
      </If>
      <Text style={pageTitle()}>{props.title()}</Text>
    </View>
  );
}
