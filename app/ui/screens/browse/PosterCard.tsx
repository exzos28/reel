import { Text, type TextStyle, type ViewRef, windowSize } from "nsh";
import { facetText, titleText, type Facet, type Summary } from "../../catalog";
import { Card, cardBox } from "../../kit/Card";
import { Picture } from "../../kit/Picture";
import { CardLine } from "../../kit/Rating";
import { cardRadius, rounded } from "../../kit/shape";
import { fontText, oneLine } from "../../kit/text";
import { colors, density, safe, type, u } from "../../theme";

const titleStyle = (): TextStyle => ({ ...oneLine, ...fontText(21, colors.snow(), 600), marginTop: u(12) });
const subStyle = (): TextStyle => ({ ...oneLine, ...type.small(), color: colors.ash() });

/** A 2:3 poster with the title and a line under it (`sub`, else the list's `facet` and the
 * rating). */

/** A poster's width: 196 TV pixels, but on a phone about three to the screen's width
 * (0.45 of 196 made 88 pt, four and more small ones in a row). */
export const posterWidth = () =>
  density === "compact" ? Math.round((windowSize().width - 2 * safe().x - 2 * u(20)) / 3.15) : u(196);

export function PosterCard(props: {
  item: () => Summary;
  sub: () => string | null;
  facet: () => Facet;
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
      style={cardBox(posterWidth(), 3)}
      viewRef={props.follow(props.focused)}
      picture={<Picture item={s} src={() => s().poster} titleSize={22} style={{ height: u(290), ...rounded(cardRadius()) }} />}
    >
      <Text style={titleStyle()}>{titleText(s())}</Text>
      <If when={props.sub()} else={<CardLine text={() => facetText(s(), props.facet())} rating={() => s().rating} size={20} />}>
        <Text style={subStyle()}>{props.sub()}</Text>
      </If>
    </Card>
  );
}
