import { Text, type TextStyle, type ViewRef } from "nsh";
import { cardMeta, titleText, type Summary } from "../../catalog";
import { Card, cardBox } from "../../kit/Card";
import { Picture } from "../../kit/Picture";
import { CardMeta } from "../../kit/Rating";
import { rounded } from "../../kit/shape";
import { fontText, oneLine } from "../../kit/text";
import { colors, type, u } from "../../theme";

const titleStyle = (): TextStyle => ({ ...oneLine, ...fontText(21, colors.snow(), 600), marginTop: u(12) });
const subStyle = (): TextStyle => ({ ...oneLine, ...type.small(), color: colors.ash() });

/** A 2:3 poster with the title and a line under it (`sub`, else its
 * rating, year and kind). */
export function PosterCard(props: {
  item: () => Summary;
  sub: () => string | null;
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
      style={cardBox(u(196), 3)}
      viewRef={props.follow(props.focused)}
      picture={<Picture item={s} src={() => s().poster} titleSize={22} style={{ height: u(290), ...rounded() }} />}
    >
      <Text style={titleStyle()}>{titleText(s())}</Text>
      <If when={props.sub()} else={<CardMeta text={() => cardMeta(s())} size={20} />}>
        <Text style={subStyle()}>{props.sub()}</Text>
      </If>
    </Card>
  );
}
