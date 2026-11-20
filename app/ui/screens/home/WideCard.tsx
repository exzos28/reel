import { Text, View, type ViewRef } from "nsh";
import { facetText, leftText, titleText, type Facet, type Summary } from "../../catalog";
import { Card, cardBox } from "../../kit/Card";
import { Picture, WatchedBar, watchedClip } from "../../kit/Picture";
import { CardLine } from "../../kit/Rating";
import { cardRadius, rounded } from "../../kit/shape";
import { labelText, metaText, oneLine } from "../../kit/text";
import { GRID_GAP, gridCardWidth } from "../../layout/Grid";
import { density, u } from "../../theme";

/** A 16:9 card's still height for its width (198 of 352). */
export const wideCardHeight = (width: number) => (width * 198) / 352;

/** A shelf of these cards (Home, Search's rows, More like this): on a desktop the cards of the Films
 * and Series grid, as big and as far apart; a TV and touch keep 352 TV pixels, 24 apart. */
const desktop = density === "regular";
export const shelfCardWidth = () => (desktop ? gridCardWidth() : u(352));
/** Between a shelf's cards, TV pixels. */
export const SHELF_GAP = desktop ? GRID_GAP : 24;
/** From one card's start to the next one's, points (a row's arrows move by it). */
export const shelfStep = () => shelfCardWidth() + u(SHELF_GAP);

const titleStyle = () => ({ ...oneLine, ...labelText(), fontWeight: 600, marginTop: u(10) });

/** A 16:9 card: the still with a watched bar, the title, what is left (or the list's `facet` and
 * the rating). */
export function WideCard(props: {
  item: () => Summary;
  continuing: boolean;
  /** What the card shows under its name ("kind" unless the list says). */
  facet?: () => Facet;
  focused: () => boolean;
  follow: (when: () => boolean) => (r: ViewRef) => void;
  onPress: () => void;
  /** Its width, points; 352 TV pixels unless the shelf says. */
  width?: () => number;
}) {
  const s = props.item;
  const width = () => props.width?.() ?? u(352);
  return (
    <Card
      label={() => titleText(s())}
      focused={props.focused}
      onPress={props.onPress}
      preview={s}
      style={cardBox(width(), 4)}
      viewRef={props.follow(props.focused)}
      picture={[
        <Picture item={s} src={() => s().card} titleSize={26} style={{ height: wideCardHeight(width()), ...rounded(cardRadius()) }} />,
        <If when={props.continuing && s().progress > 0}>
          <View style={watchedClip()}>
            <WatchedBar progress={() => s().progress} />
          </View>
        </If>,
      ]}
    >
      <Text style={titleStyle()}>{titleText(s())}</Text>
      <If when={props.continuing && leftText(s())} else={<CardLine text={() => facetText(s(), props.facet?.() ?? "kind")} rating={() => s().rating} />}>
        <Text style={{ ...oneLine, ...metaText() }}>{leftText(s())}</Text>
      </If>
    </Card>
  );
}
