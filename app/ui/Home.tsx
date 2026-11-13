// Home: the nav, a hero for the focused title, then shelves of 16:9 cards.
// Remote: the focus starts on the first card; Up goes to the hero's
// buttons, then to the nav. OK on a card opens its title; on Play, plays.
import { computed, keymap, Scroll, signal, Text, View } from "nsh";
import { t } from "nsh/i18n";
import { cardMeta as cardMetaOf, home, leftText, playLabel, titleText, toggleList, type Summary } from "./catalog";
import { Button, CardMeta, Hero, NAV, NavBar, Picture, ReleaseText, revealWhen, WatchedBar } from "./components";
import { go, openTitle } from "./nav";
import { play } from "./playback";
import { colors, focusRing, radius, safe, type, u } from "./theme";
import playIcon from "./icons/play.svg";
import plusIcon from "./icons/plus.svg";
import checkIcon from "./icons/check.svg";

type Zone = "nav" | "hero" | "shelves";

// Kept while other screens show, so coming back finds the focus where it was.
const zone = signal<Zone>("shelves");
const navAt = signal(0);
const heroAt = signal(0);
const row = signal(0);
/** Each shelf remembers the card it was left on. */
const cols = signal<number[]>([]);

export function Home() {
  const shelves = computed(() => home());
  const col = (r: number) => cols()[r] ?? 0;
  const focused = computed<Summary>(() => {
    const s = shelves()[row()];
    return s.items[Math.min(col(row()), s.items.length - 1)];
  });

  const setCol = (r: number, c: number) => {
    const next = [...cols()];
    next[r] = Math.min(Math.max(c, 0), shelves()[r].items.length - 1);
    cols.set(next);
  };
  const playFocused = () => play({ ...focused().play, title: focused() });
  const heroActions = [playFocused, () => toggleList(focused().id)];

  keymap.bind(
    {
      left: () => {
        if (zone() === "nav") navAt.set(Math.max(navAt() - 1, 0));
        else if (zone() === "hero") heroAt.set(Math.max(heroAt() - 1, 0));
        else setCol(row(), col(row()) - 1);
      },
      right: () => {
        if (zone() === "nav") navAt.set(Math.min(navAt() + 1, NAV.length - 1));
        else if (zone() === "hero") heroAt.set(Math.min(heroAt() + 1, heroActions.length - 1));
        else setCol(row(), col(row()) + 1);
      },
      up: () => {
        if (zone() === "hero") zone.set("nav");
        else if (zone() === "shelves") row() === 0 ? zone.set("hero") : row.set(row() - 1);
      },
      down: () => {
        if (zone() === "nav") zone.set("hero");
        else if (zone() === "hero") zone.set("shelves");
        else row.set(Math.min(row() + 1, shelves().length - 1));
      },
    },
    { repeat: true },
  );
  keymap.bind({
    enter: () => {
      if (zone() === "nav") go(NAV[navAt()].id);
      else if (zone() === "hero") heroActions[heroAt()]();
      else openTitle(focused().id);
    },
  });

  return (
    <Scroll style={{ flex: 1, backgroundColor: colors.ink() }}>
      <View style={{ paddingBottom: safe().y }}>
        <View style={{ position: "absolute", top: 0, left: 0, right: 0, zIndex: 3 }}>
          <NavBar
            current="home"
            focused={() => (zone() === "nav" ? navAt() : null)}
            onPick={(i) => go(NAV[i].id)}
          />
        </View>
        <Hero item={focused} height={780} titleSize={96} top={236}>
          <ReleaseText item={focused} />
          <View style={{ flexDirection: "row", gap: u(16), marginTop: u(12) }}>
            <Button
              kind="primary"
              icon={() => playIcon}
              label={() => playLabel(focused())}
              focused={() => zone() === "hero" && heroAt() === 0}
              onPress={playFocused}
            />
            <Button
              kind="secondary"
              icon={() => (focused().inList ? checkIcon : plusIcon)}
              label={() => (focused().inList ? t("title.in_list") : t("title.my_list"))}
              focused={() => zone() === "hero" && heroAt() === 1}
              onPress={() => toggleList(focused().id)}
            />
          </View>
        </Hero>
        <View style={{ gap: u(40), marginTop: u(40) }}>
          <Each of={shelves()} key={(s) => s.id}>
            {(shelf, r) => (
              <View style={{ gap: u(22) }}>
                <Text style={{ ...type.section(), color: colors.snow(), paddingHorizontal: safe().x }}>{t(`shelf.${shelf().id}`)}</Text>
                <Scroll horizontal>
                  <View style={{ flexDirection: "row", gap: u(24), paddingHorizontal: safe().x, paddingTop: u(12), paddingBottom: u(24) }}>
                    <Each of={shelf().items} key={(f) => f.id}>
                      {(item, c) => (
                        <WideCard
                          item={item}
                          continuing={shelf().id === "continue"}
                          focused={() => zone() === "shelves" && row() === r() && col(r()) === c()}
                          onPress={() => {
                            zone.set("shelves");
                            row.set(r());
                            setCol(r(), c());
                            openTitle(item().id);
                          }}
                        />
                      )}
                    </Each>
                  </View>
                </Scroll>
              </View>
            )}
          </Each>
        </View>
      </View>
    </Scroll>
  );
}

/** A 16:9 card: the still with a watched bar, the title, what is left (or
 * its rating, year and kind). */
function WideCard(props: { item: () => Summary; continuing: boolean; focused: () => boolean; onPress: () => void }) {
  const s = props.item;
  return (
    <View
      ref={revealWhen(props.focused)}
      role="button"
      accessibilityLabel={titleText(s())}
      onPress={props.onPress}
      hoverStyle={{ opacity: 0.92 }}
      style={{ width: u(352), flexShrink: 0, gap: u(4) }}
    >
      <View style={{ borderRadius: radius(), ...focusRing(props.focused(), "card") }}>
        <Picture item={s} src={() => s().card} titleSize={26} style={{ height: u(198), borderRadius: radius() }} />
        <If when={props.continuing && s().progress > 0}>
          <View style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: u(5), overflow: "hidden", borderBottomLeftRadius: radius(), borderBottomRightRadius: radius() }}>
            <WatchedBar progress={() => s().progress} />
          </View>
        </If>
      </View>
      <Text style={{ numberOfLines: 1, ...type.label(), fontWeight: 600, color: colors.snow(), marginTop: u(10) }}>{titleText(s())}</Text>
      <If when={props.continuing} else={<CardMeta text={() => cardMetaOf(s())} />}>
        <Text style={{ numberOfLines: 1, ...type.meta(), color: colors.ash() }}>{leftText(s())}</Text>
      </If>
    </View>
  );
}
