// A saved film or show as a 16:9 card (a tablet's Ready to watch, design/offline-downloads.md):
// its still, its name and what it takes ("2.2 GB", "4 episodes · 6.6 GB"). A press plays the film
// or opens the show (its saved episodes are marked there); a finger held on it (a secondary
// click, the keyboard's menu key) opens a menu with Remove, which asks first.
import { Image, Text, View, type TextStyle, type ViewRef, type ViewStyle } from "nsh";
import { ContextMenu, MenuItem } from "nsh/base";
import { t } from "nsh/i18n";
import type { SavedGroup } from "../../library";
import { Pressable } from "../../kit/Pressable";
import { cardRadius, cover, rounded } from "../../kit/shape";
import { fontText, labelText, metaText, oneLine } from "../../kit/text";
import { Fmt } from "../../native";
import { alpha, colors, focusRing, u } from "../../theme";

const cardStyle = (width: number, focused: boolean): ViewStyle => ({ width, gap: u(10), ...rounded(cardRadius()), ...focusRing(focused, "card") });
const pictureStyle = (width: number): ViewStyle => ({ width, height: width * 0.5625, ...rounded(cardRadius()), overflow: "hidden", backgroundColor: colors.raise() });
const imageStyle = () => ({ ...cover(), objectFit: "cover" }) as ViewStyle;
const menuStyle = (): ViewStyle => ({ minWidth: 220, padding: 6, ...rounded(14), backgroundColor: colors.card(), borderWidth: 1, borderColor: alpha(colors.snow(), 0.08) });
const itemStyle = (): ViewStyle => ({ minHeight: 44, paddingHorizontal: 14, justifyContent: "center", ...rounded(10) });
const itemText = (): TextStyle => ({ ...fontText(24, colors.snow(), 500) });

/** "2.2 GB" for a film, "4 episodes · 6.6 GB" for a show. */
export const cardLine = (g: SavedGroup) =>
  g.show ? t(g.count === 1 ? "saved.group_line_one" : "saved.group_line", { count: g.count, size: Fmt.size(g.size) }) : Fmt.size(g.size);

export function SavedCard(props: {
  group: () => SavedGroup;
  width: () => number;
  focused: () => boolean;
  viewRef: (r: ViewRef) => void;
  onPress: () => void;
  onRemove: () => void;
}) {
  const g = props.group;
  return (
    <ContextMenu
      popupStyle={menuStyle()}
      backdropStyle={{ backgroundColor: alpha(colors.ink(), 0.5) }}
      trigger={
        <Pressable
          ref={props.viewRef}
          role="button"
          accessibilityLabel={`${g().title}, ${cardLine(g())}`}
          onPress={props.onPress}
          style={cardStyle(props.width(), props.focused())}
        >
          <View style={pictureStyle(props.width())}>
            <If when={g().image}>
              <Image src={g().image} style={imageStyle()} />
            </If>
          </View>
          <View style={{ gap: u(4) }}>
            <Text style={{ ...labelText(), ...oneLine }}>{g().title}</Text>
            <Text style={{ ...metaText(), ...oneLine }}>{cardLine(g())}</Text>
          </View>
        </Pressable>
      }
    >
      <MenuItem style={itemStyle()} hoverStyle={{ backgroundColor: colors.raise() }} onSelect={props.onRemove}>
        <Text style={itemText()}>{t(g().show ? "saved.remove_all" : "saved.remove")}</Text>
      </MenuItem>
    </ContextMenu>
  );
}
