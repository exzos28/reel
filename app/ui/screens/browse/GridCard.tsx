import { Text, type TextStyle } from "nsh";
import { t } from "nsh/i18n";
import { facetText, titleText, type Facet, type Summary } from "../../catalog";
import { Tag } from "../../kit/Badge";
import { Card, cardBox } from "../../kit/Card";
import { Picture } from "../../kit/Picture";
import { CardLine } from "../../kit/Rating";
import { cardRadius, rounded } from "../../kit/shape";
import { fontText, oneLine } from "../../kit/text";
import type { ScrollCtl } from "../../layout/Scroller";
import { colors, u } from "../../theme";

const titleStyle = (): TextStyle => ({ ...oneLine, ...fontText(23, colors.snow(), 600), marginTop: u(14) });

/** A 16:9 card, its title and the line under it (as on the shelves), an optional red tag. */
/** `facet`: what the card shows under its name, "kind" unless its list says. */
export function GridCard(props: {
  item: () => Summary;
  facet?: () => Facet;
  width: () => number;
  focused: () => boolean;
  onPress: () => void;
  /** The page's scroll: a wheel over the preview moves it. */
  page: ScrollCtl;
}) {
  const s = props.item;
  return (
    <Card
      label={() => titleText(s())}
      focused={props.focused}
      testID={props.focused() ? "grid-focused" : undefined}
      onPress={props.onPress}
      preview={s}
      page={props.page}
      style={cardBox(props.width(), 3, false)}
      picture={[
        <Picture item={s} src={() => s().card ?? s().still} titleSize={20} style={{ height: props.width() * 0.56, ...rounded(cardRadius()) }} />,
        <If when={s().tag}>
          <Tag text={() => t(`tag.${s().tag}`)} />
        </If>,
      ]}
    >
      <Text style={titleStyle()}>{titleText(s())}</Text>
      <CardLine text={() => facetText(s(), props.facet?.() ?? "kind")} rating={() => s().rating} size={20} />
    </Card>
  );
}
