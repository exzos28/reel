import { Text, type TextStyle } from "nsh";
import { t } from "nsh/i18n";
import { cardMeta, titleText, type Summary } from "../../catalog";
import { Tag } from "../../kit/Badge";
import { Card, cardBox } from "../../kit/Card";
import { Picture } from "../../kit/Picture";
import { CardMeta } from "../../kit/Rating";
import { rounded } from "../../kit/shape";
import { fontText, oneLine } from "../../kit/text";
import { colors, u } from "../../theme";

const titleStyle = (): TextStyle => ({ ...oneLine, ...fontText(22, colors.snow(), 600), marginTop: u(12) });

/** A 16:9 card, its title and meta under it (as on the shelves), an optional red tag. */
export function GridCard(props: { item: () => Summary; width: () => number; focused: () => boolean; onPress: () => void }) {
  const s = props.item;
  return (
    <Card
      label={() => titleText(s())}
      focused={props.focused}
      onPress={props.onPress}
      style={cardBox(props.width(), 3, false)}
      picture={[
        <Picture item={s} src={() => s().still} titleSize={20} style={{ height: props.width() * 0.56, ...rounded() }} />,
        <If when={s().tag}>
          <Tag text={() => t(`tag.${s().tag}`)} />
        </If>,
      ]}
    >
      <Text style={titleStyle()}>{titleText(s())}</Text>
      <CardMeta text={() => cardMeta(s())} size={20} />
    </Card>
  );
}
