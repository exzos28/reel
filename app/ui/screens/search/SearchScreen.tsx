// Search, a nav destination: the nav, the page's title and the query field,
// then the results as rows of 16:9 cards (Movies, Shows, Anime), or the
// recent searches while nothing is typed. The core searches once the query
// rests and answers through the catalog's revision. Remote: the screen opens
// on the field (with its keyboard up where one types at once); OK on the
// field brings the keyboard (a TV's on-screen one), Up goes to the nav, Down
// into the recent searches or the results; OK on a card opens its title.
// Back closes the keyboard, then takes the focus to the nav, then Home.
import { computed, keymap, signal, Text, View, type InputRef, type ViewStyle } from "nsh";
import { t } from "nsh/i18n";
import { rememberSearch, search, type SearchAnswer } from "../../catalog";
import { byKeys } from "../../focus/keys";
import { clamp } from "../../focus/memory";
import { metaText, pageTitle } from "../../kit/text";
import { row as inRow } from "../../kit/shape";
import { useRootBack } from "../../focus/rootBack";
import { navRoom } from "../../layout/NavBar";
import { NAV } from "../../layout/navItems";
import { showNav } from "../../layout/navState";
import { Screen } from "../../layout/Screen";
import { scroller } from "../../layout/Scroller";
import { go, goFromNav, handleBack, onBack, openTitle } from "../../nav";
import { density, safe, u } from "../../theme";
import { HomeShelf } from "../home/HomeShelf";
import { cols, navAt, query, recentAt, row, zone } from "./focus";
import { RecentSearches } from "./RecentSearches";
import { SearchField } from "./SearchField";

/** The title where a destination's page starts (170 on a TV), the field under it. */
const topStyle = (): ViewStyle => ({ paddingHorizontal: safe().x, paddingTop: navRoom() + u(58), gap: u(28) });

/** The line under the field: what is going on, or nothing. */
function statusText(a: SearchAnswer): string {
  const notes: string[] = [];
  if (a.state === "recent" && !a.recent.length) notes.push(t("search.hint"));
  if (a.state === "searching") notes.push(t("search.searching"));
  if (a.state === "done" && !a.sections.length) notes.push(t("search.none", { query: a.query }));
  if (a.state === "failed") notes.push(t("search.failed"));
  if (!a.tmdb) notes.push(t("search.no_tmdb"));
  return notes.join(" ");
}

/** Where a keyboard can type at once (not a TV remote): coming back up to
 * the field gives it the input's focus too. */
const typesAtOnce = density !== "ten-foot";

export function SearchScreen() {
  const answer = computed(() => search(query()));
  const sections = () => answer().sections;
  const recent = () => (answer().state === "recent" ? answer().recent : []);
  const rowAt = () => clamp(row(), sections().length - 1);
  const col = (r: number) => cols.at(r);
  const setCol = (r: number, c: number) => cols.set(r, c, sections()[r].items.length - 1);

  let input: InputRef | undefined;
  /** The field has the input's focus: a keyboard is up (a TV's on-screen one) or typing goes to it. */
  const typing = signal(false);
  const type = () => input?.focus();
  const toField = (keyboard: boolean) => {
    zone.set("field");
    if (keyboard) type();
  };
  const leaveField = (to: "recent" | "results") => {
    input?.blur();
    typing.set(false);
    zone.set(to);
  };
  /** Down from the field: the recent searches, else the first row of results. */
  const below = () => {
    if (recent().length) leaveField("recent");
    else if (sections().length) {
      row.set(0);
      leaveField("results");
    }
  };
  // Results can shrink under a remembered focus (a new query): keep it on what is there.
  if (zone() === "results" && !sections().length) zone.set("field");
  if (zone() === "recent" && !recent().length) zone.set("field");

  const open = (r: number, c: number) => {
    const item = sections()[r].items[c];
    zone.set("results");
    row.set(r);
    setCol(r, c);
    rememberSearch(query());
    openTitle(item.id);
  };
  const pickRecent = (i: number) => {
    const q = recent()[i];
    rememberSearch(q);
    query.set(q);
    toField(false);
  };
  const submit = () => {
    if (!query().trim()) return;
    rememberSearch(query());
    below();
  };

  const toNav = () => {
    input?.blur();
    typing.set(false);
    navAt.set(NAV.findIndex((n) => n.id === "search"));
    zone.set("nav");
  };
  const keys = {
    nav: {
      left: () => navAt.set(clamp(navAt() - 1, NAV.length - 1)),
      right: () => navAt.set(clamp(navAt() + 1, NAV.length - 1)),
      down: () => toField(typesAtOnce),
      enter: () => goFromNav(NAV[navAt()].id),
    },
    field: { up: toNav, down: below, enter: type },
    recent: {
      left: () => recentAt.set(clamp(recentAt() - 1, recent().length - 1)),
      right: () => recentAt.set(clamp(recentAt() + 1, recent().length - 1)),
      up: () => toField(typesAtOnce),
      enter: () => pickRecent(clamp(recentAt(), recent().length - 1)),
    },
    results: {
      left: () => setCol(rowAt(), col(rowAt()) - 1),
      right: () => setCol(rowAt(), col(rowAt()) + 1),
      up: () => (rowAt() === 0 ? toField(typesAtOnce) : row.set(rowAt() - 1)),
      down: () => row.set(clamp(rowAt() + 1, sections().length - 1)),
      enter: () => open(rowAt(), col(rowAt())),
    },
  } as Record<string, { left?: () => void; right?: () => void; up?: () => void; down?: () => void; enter?: () => void }>;
  const run = (key: "left" | "right" | "up" | "down" | "enter") => () => keys[zone()][key]?.();
  // Up and Down leave the field even while it is typed in; Left and Right move its caret then.
  keymap.bind(byKeys({ up: run("up"), down: run("down") }), { repeat: true, when: "always" });
  keymap.bind(byKeys({ left: run("left"), right: run("right") }), { repeat: true });
  keymap.bind({ enter: run("enter") });
  // Back reaches the field too (an input keeps Escape otherwise): it closes
  // the keyboard first, then leaves.
  keymap.bind({ escape: handleBack }, { when: "always" });
  onBack(() => typing() && (input?.blur(), typing.set(false), true));

  /** The page puts the focused row in its upper third. */
  const page = scroller({ anchor: (viewport) => viewport / 3, memory: "search" });
  showNav(() => (zone() === "nav" ? navAt() : null));
  useRootBack({ ctl: page, onNav: () => zone() === "nav", toNav });

  return (
    <Screen ctl={page} nav>
      <View ref={page.follow(() => zone() !== "results", "start")} style={topStyle()}>
        <Text style={pageTitle()}>{t("nav.search")}</Text>
        <View style={inRow(u(24))}>
          <SearchField
            value={query}
            focused={() => zone() === "field"}
            onChange={(text) => query.set(text)}
            onSubmit={submit}
            onFocus={() => {
              zone.set("field");
              typing.set(true);
            }}
            onBlur={() => typing.set(false)}
            onRef={(r) => {
              input = r;
              if (zone() === "field") r.focus();
            }}
          />
        </View>
        <If when={statusText(answer())}>
          <Text style={metaText()}>{statusText(answer())}</Text>
        </If>
        <If when={recent().length}>
          <RecentSearches
            queries={recent}
            focusedAt={() => (zone() === "recent" ? clamp(recentAt(), recent().length - 1) : null)}
            onPick={pickRecent}
          />
        </If>
      </View>
      <View style={{ gap: u(40), marginTop: u(36) }}>
        <Each of={sections()} key={(s) => s.id}>
          {(section, r) => (
            <HomeShelf
              shelf={section}
              title={() => t(`search.section.${section().id}`)}
              focusedAt={() => (zone() === "results" && rowAt() === r() ? col(r()) : null)}
              blockRef={page.follow(() => zone() === "results" && rowAt() === r(), "anchor")}
              onOpen={(c) => open(r(), c)}
              page={page}
              eager={r() < 2}
            />
          )}
        </Each>
      </View>
    </Screen>
  );
}
