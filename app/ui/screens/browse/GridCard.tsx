import { Text, View, type TextStyle, type ViewStyle } from "nsh";
import { t } from "nsh/i18n";
import { cardMeta, titleText, type Summary } from "../../catalog";
import { Tag } from "../../kit/Badge";
import { Card, cardBox } from "../../kit/Card";
import { Picture } from "../../kit/Picture";
import { CardMeta } from "../../kit/Rating";
import { cover, rounded } from "../../kit/shape";
import { fontText, oneLine } from "../../kit/text";
import { alpha, colors, type, u } from "../../theme";

const veilStyle = (): ViewStyle => ({
  ...cover(),
  ...rounded(),
  backgroundImage: `linear-gradient(0deg, ${alpha(colors.ink(), 0.85)} 0%, ${alpha(colors.ink(), 0)} 55%)`,
});
const overTitleStyle = (): TextStyle => ({
  numberOfLines: 2,
  ...type.logotype(20),
  fontWeight: 300,
  color: colors.snow(),
  position: "absolute",
  left: u(16),
  right: u(16),
  bottom: u(14),
});
const titleStyle = (): TextStyle => ({ ...oneLine, ...fontText(22, colors.snow(), 600), marginTop: u(12) });

/** A 16:9 card with the title over the still and an optional red tag. */
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
        <If when={s().still}>
          <View style={veilStyle()} />
          <Text style={overTitleStyle()}>{titleText(s())}</Text>
        </If>,
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
