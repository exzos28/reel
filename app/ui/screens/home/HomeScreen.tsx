// Home: the nav, a hero for the focused title, then shelves of 16:9 cards.
// Remote: the focus starts on the first card; Up goes to the hero's
// buttons, then to the nav. OK on a card opens its title; on Play, plays.
import { cleanup, computed, effect, signal, View } from "nsh";
import { home, toggleList, type Summary } from "../../catalog";
import { useRootBack } from "../../focus/rootBack";
import { useZones } from "../../focus/zones";
import { NAV } from "../../layout/navItems";
import { Screen } from "../../layout/Screen";
import { scroller } from "../../layout/Scroller";
import { showNav } from "../../layout/navState";
import { go, goFromNav, openTitle } from "../../nav";
import { play } from "../../playback";
import { u } from "../../theme";
import { cols, heroAt, navAt, row, zone } from "./focus";
import { HomeHero } from "./HomeHero";
import { HomeShelf } from "./HomeShelf";

/** How long the focus rests before the hero shows it. */
const HERO_SETTLE_MS = 150;

export function HomeScreen() {
  const shelves = computed(() => home());
  const col = (r: number) => cols.at(r);
  const setCol = (r: number, c: number) => cols.set(r, c, shelves()[r].items.length - 1);
  const focused = computed<Summary>(() => {
    const s = shelves()[row()];
    return s.items[Math.min(col(row()), s.items.length - 1)];
  });
  /** The hero follows the focus once it rests (~150 ms): moving along a shelf
   * only moves the ring; the hero's still and text change when you stop. */
  const hero = signal<Summary>(focused());
  let settle: ReturnType<typeof setTimeout> | undefined;
  effect(() => {
    const f = focused();
    clearTimeout(settle);
    if (zone() !== "shelves" || f.id === hero().id) return hero.set(f);
    settle = setTimeout(() => hero.set(f), HERO_SETTLE_MS);
  });
  cleanup(() => clearTimeout(settle));
  const playFocused = () => play({ ...focused().play, title: focused() });
  const heroActions = [playFocused, () => toggleList(focused().id)];

  /** The page puts the focused shelf in its upper third. */
  const page = scroller({ anchor: (viewport) => viewport / 3, memory: "home" });

  showNav(() => (zone() === "nav" ? navAt() : null));
  useRootBack({
    ctl: page,
    onNav: () => zone() === "nav",
    toNav: () => {
      zone.set("nav");
      navAt.set(0);
    },
  });
  useZones(zone, {
    nav: {
      left: () => navAt.set(Math.max(navAt() - 1, 0)),
      right: () => navAt.set(Math.min(navAt() + 1, NAV.length - 1)),
      down: () => zone.set("hero"),
      enter: () => goFromNav(NAV[navAt()].id),
    },
    hero: {
      left: () => heroAt.set(Math.max(heroAt() - 1, 0)),
      right: () => heroAt.set(Math.min(heroAt() + 1, heroActions.length - 1)),
      up: () => zone.set("nav"),
      down: () => zone.set("shelves"),
      enter: () => heroActions[heroAt()](),
    },
    shelves: {
      left: () => setCol(row(), col(row()) - 1),
      right: () => setCol(row(), col(row()) + 1),
      up: () => (row() === 0 ? zone.set("hero") : row.set(row() - 1)),
      down: () => row.set(Math.min(row() + 1, shelves().length - 1)),
      enter: () => openTitle(focused().id),
    },
  });

  const open = (r: number, c: number, id: string) => {
    zone.set("shelves");
    row.set(r);
    setCol(r, c);
    openTitle(id);
  };

  return (
    <Screen ctl={page} nav hero={780}>
      <View ref={page.follow(() => zone() !== "shelves", "start")}>
        <HomeHero
          item={hero}
          focusedAt={() => (zone() === "hero" ? heroAt() : null)}
          onPlay={playFocused}
          onToggle={heroActions[1]}
        />
      </View>
      <View style={{ gap: u(40), marginTop: u(40) }}>
        <Each of={shelves()} key={(s) => s.id}>
          {(shelf, r) => (
            <HomeShelf
              shelf={shelf}
              focusedAt={() => (zone() === "shelves" && row() === r() ? col(r()) : null)}
              blockRef={page.follow(() => zone() === "shelves" && row() === r(), r() === 0 ? "nearest" : "anchor")}
              onOpen={(c) => open(r(), c, shelf().items[c].id)}
              page={page}
              eager={r() < 2}
            />
          )}
        </Each>
      </View>
    </Screen>
  );
}
