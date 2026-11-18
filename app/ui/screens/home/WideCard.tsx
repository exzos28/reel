import { Text, View, type ViewRef } from "nsh";
import { cardMeta, leftText, titleText, type Summary } from "../../catalog";
import { Card, cardBox } from "../../kit/Card";
import { Picture, WatchedBar, watchedClip } from "../../kit/Picture";
import { CardMeta } from "../../kit/Rating";
import { cardRadius, rounded } from "../../kit/shape";
import { labelText, metaText, oneLine } from "../../kit/text";
import { u } from "../../theme";

const titleStyle = () => ({ ...oneLine, ...labelText(), fontWeight: 600, marginTop: u(10) });

/** A 16:9 card: the still with a watched bar, the title, what is left (or
 * its rating, year and kind). */
export function WideCard(props: {
  item: () => Summary;
  continuing: boolean;
  focused: () => boolean;
  follow: (when: () => boolean) => (r: ViewRef) => void;
  onPress: () => void;
}) {
  const s = props.item;
  return (
    <Card
      label={() => titleText(s())}
      focused={props.focused}
      onPress={props.onPress}
      preview={s}
      style={cardBox(u(352), 4)}
      viewRef={props.follow(props.focused)}
      picture={[
        <Picture item={s} src={() => s().card} titleSize={26} style={{ height: u(198), ...rounded(cardRadius()) }} />,
        <If when={props.continuing && s().progress > 0}>
          <View style={watchedClip()}>
            <WatchedBar progress={() => s().progress} />
          </View>
        </If>,
      ]}
    >
      <Text style={titleStyle()}>{titleText(s())}</Text>
      <If when={props.continuing} else={<CardMeta text={() => cardMeta(s())} rated={() => !!s().rating} />}>
        <Text style={{ ...oneLine, ...metaText() }}>{leftText(s())}</Text>
      </If>
    </Card>
  );
}
