// A show's season tabs ("Season 1  1936" …, the chosen one in a lighter
// pill) with "12 episodes · <season title>" under them.
import { Text, View, type TextStyle, type ViewStyle } from "nsh";
import { t } from "nsh/i18n";
import { pillStyle } from "../../kit/Pill";
import { labelText, metaText } from "../../kit/text";
import { Rail, railLead } from "../../layout/Rail";
import { scroller, type Follow, type ScrollCtl } from "../../layout/Scroller";
import { colors, safe, selectedFill, type, u } from "../../theme";
import { Pressable } from "../../kit/Pressable";

/** `year` is null when neither the season nor its episodes say it. */
type Season = { number: number; year: number | null; episodes: number };

const tabLabel = (selected: boolean): TextStyle => ({ ...labelText(selected ? colors.snow() : colors.ash()), fontWeight: 600 });
const subStyle = (): TextStyle => ({ ...metaText(), marginHorizontal: safe().x, marginTop: u(4) });

export function SeasonTabs(props: {
  seasons: () => Season[];
  season: () => number;
  focused: () => boolean;
  follow: Follow;
  onPick: (n: number) => void;
  sub: () => string;
  /** The page's scroll: the wheel up and down over the tabs moves it. */
  page: ScrollCtl;
}) {
  /** The tabs put the focused season at the inset. */
  const tabs = scroller({ horizontal: true, anchor: railLead });
  const chosen = (s: Season) => props.season() === s.number;
  return (
    <View ref={props.follow(props.focused)}>
      <Rail ctl={tabs} page={props.page} gap={6} top={36}>
          <Each of={props.seasons()} key={(s) => s.number}>
            {(s) => (
              <Pressable haptic={!chosen(s())}
                ref={tabs.follow(() => props.focused() && chosen(s()))}
                role="tab"
                accessibilityLabel={t("series.season", { number: s().number })}
                accessibilityState={{ selected: chosen(s()) }}
                onPress={() => props.onPick(s().number)}
                hoverStyle={{ backgroundColor: colors.card() }}
                style={pillStyle(selectedFill(chosen(s())), props.focused() && chosen(s()), 22)}
              >
                <Text style={tabLabel(chosen(s()))}>{t("series.season", { number: s().number })}</Text>
                <If when={s().year != null}>
                  <Text style={{ ...type.small(), color: colors.ash() }}>{String(s().year)}</Text>
                </If>
              </Pressable>
            )}
          </Each>
      </Rail>
      <Text style={subStyle()}>{props.sub()}</Text>
    </View>
  );
}
