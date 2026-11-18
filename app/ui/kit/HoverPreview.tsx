// A title's card on a desktop grows into a mini card in its place: the pointer rests on it for
// 0.6 s and it widens a little (its top stays, the still gets taller and wider) to show the
// still, name, scores, genres, a few lines of about and two buttons (open it, add it to the list).
// Placed and kept open by NSH's `HoverCard`, whose offset pulls it back over the card; it is only
// for a pointer (a TV and touch have no resting).
import { Text, View, type TextStyle, type ViewStyle } from "nsh";
import { t } from "nsh/i18n";
import { aboutText, genresText, lengthText, titleText, toggleList, yearsText, type Summary } from "../catalog";
import checkIcon from "../icons/check.svg";
import playIcon from "../icons/play.svg";
import plusIcon from "../icons/plus.svg";
import { caps } from "../platform";
import { alpha, colors, ts, u } from "../theme";
import { Badge } from "./Badge";
import { Button } from "./Button";
import { Picture } from "./Picture";
import { Rating } from "./Rating";
import { cardRadius, cover, rounded, row } from "./shape";
import { bodyText, fontText, metaText } from "./text";

/** A preview opens after the pointer rested this long on the card, ms. */
export const PREVIEW_DELAY = 600;
/** Only where there is a pointer to rest. */
export const previewOn = caps.windowBar;

/** How much wider than its card the preview is, and its least width, points (a poster is narrow). */
const GROW = 1.3;
const LEAST = 330;
/** How far above its card's top the preview starts, points: it grows up a little too. */
export const PREVIEW_LIFT = 10;

/** The preview's width for a card `card` points wide. */
export const previewWidth = (card: number) => Math.max(card * GROW, LEAST);

/** The `HoverCard`'s popup: dark, softly rounded, the white ring of the focus, a deep shadow. */
export const previewPopup = (width: number): ViewStyle => ({
  width,
  backgroundColor: colors.card(),
  ...rounded(cardRadius() + u(6)),
  outlineStyle: "solid",
  outlineWidth: Math.max(2, u(3)),
  outlineOffset: 0,
  outlineColor: colors.snow(),
  boxShadow: `0 ${u(30)}px ${u(80)}px ${alpha(colors.ink(), 0.85)}`,
  transformOrigin: "50% 0%",
  transitionProperty: "opacity",
  transitionDuration: 180,
  transitionTimingFunction: "ease-out",
});
/** Where it grows from: the card's own width, and not there yet. */
export const previewStarting = (width: number, card: number): ViewStyle => ({
  opacity: 0,
  transform: `scale(${Math.min(1, card / width)})`,
});

const shadeStyle = (): ViewStyle => ({
  ...cover(),
  backgroundImage: `linear-gradient(180deg, ${alpha(colors.card(), 0)} 45%, ${colors.card()} 100%)`,
});
const bodyStyle = (): ViewStyle => ({ paddingHorizontal: u(24), paddingBottom: u(24), marginTop: -u(36), gap: u(12) });
const titleStyle = (): TextStyle => ({ numberOfLines: 2, ...fontText(30, colors.snow(), 600) });
const aboutStyle = (): TextStyle => ({ numberOfLines: 3, ...bodyText(colors.soft()), fontSize: ts(21), lineHeight: ts(30) });
const metaRow = (): ViewStyle => ({ ...row(u(16)), flexWrap: "wrap" });
const actionsStyle = (): ViewStyle => ({ ...row(u(12)), marginTop: u(6) });

/** What a preview says about `item`, `width` points wide; `onOpen` opens the title's page (the
 * still and the title open it too, not only the button). */
export function PreviewBody(props: { item: () => Summary; width: number; onOpen: () => void }) {
  const s = props.item;
  const still = (props.width * 9) / 16;
  return (
    <View style={{ width: props.width, overflow: "hidden", ...rounded(cardRadius() + u(6)) }}>
      <View onPress={props.onOpen} style={{ height: still }}>
        <Picture item={s} src={() => s().still ?? s().card} titleSize={30} style={{ height: still }} />
        <View style={shadeStyle()} />
      </View>
      <View style={bodyStyle()}>
        <View role="link" accessibilityLabel={titleText(s())} onPress={props.onOpen}>
          <Text style={titleStyle()}>{titleText(s())}</Text>
        </View>
        <View style={metaRow()}>
          <If when={s().rating}>
            <Rating rating={s().rating} size={22} />
          </If>
          <Text style={metaText(colors.soft())}>{yearsText(s())}</Text>
          <Text style={metaText(colors.soft())}>{lengthText(s())}</Text>
          <If when={s().certification}>
            <Badge text={s().certification!} size={17} />
          </If>
        </View>
        <If when={s().genres.length > 0}>
          <Text style={metaText()}>{genresText(s())}</Text>
        </If>
        <If when={aboutText(s())}>
          <Text style={aboutStyle()}>{aboutText(s())}</Text>
        </If>
        <View style={actionsStyle()}>
          <Button kind="primary" height={52} icon={() => playIcon} label={() => t("card.open")} focused={() => false} onPress={props.onOpen} />
          <Button
            kind="secondary"
            height={52}
            icon={() => (s().inList ? checkIcon : plusIcon)}
            label={() => (s().inList ? t("title.in_list") : t("title.add_to_list"))}
            focused={() => false}
            onPress={() => toggleList(s().id)}
          />
        </View>
      </View>
    </View>
  );
}
