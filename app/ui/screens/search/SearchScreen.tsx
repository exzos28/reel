// Search: the query field at the top, then the results as rows of 16:9
// cards (Movies, Shows, Anime), or the recent searches while nothing is
// typed. The core searches once the query rests and answers through the
// catalog's revision. Remote: the screen opens on the field with its
// keyboard up; OK on the field brings the keyboard back (a TV's on-screen
// one), Down goes into the recent searches or the results, Up comes back,
// OK on a card opens its title, Back leaves.
import { computed, keymap, Text, View, type InputRef, type ViewStyle } from "nsh";
import { t } from "nsh/i18n";
import { rememberSearch, search, type SearchAnswer } from "../../catalog";
import { byKeys } from "../../focus/keys";
import { clamp } from "../../focus/memory";
import { metaText } from "../../kit/text";
import { row as inRow } from "../../kit/shape";
import { BackButton } from "../../layout/BackButton";
import { Screen } from "../../layout/Screen";
import { scroller } from "../../layout/Scroller";
import { backInTitleBar } from "../../layout/TopBar";
import { back, openTitle } from "../../nav";
import { density, safe, u } from "../../theme";
import { HomeShelf } from "../home/HomeShelf";
import { cols, query, recentAt, row, zone } from "./focus";
import { RecentSearches } from "./RecentSearches";
import { SearchField } from "./SearchField";

const topStyle = (): ViewStyle => ({ paddingHorizontal: safe().x, paddingTop: safe().y, gap: u(28) });

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
  const type = () => input?.focus();
  const toField = (typing: boolean) => {
    zone.set("field");
    if (typing) type();
  };
  const leaveField = (to: "recent" | "results") => {
    input?.blur();
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

  const keys = {
    field: { down: below, enter: type },
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
  // Back leaves from the field too (an input keeps Escape otherwise).
  keymap.bind({ escape: back }, { when: "always" });

  /** The page puts the focused row in its upper third. */
  const page = scroller({ anchor: (viewport) => viewport / 3, memory: "search" });

  return (
    <Screen ctl={page}>
      <View ref={page.follow(() => zone() !== "results", "start")} style={topStyle()}>
        <View style={inRow(u(24))}>
          <If when={!backInTitleBar}>
            <BackButton focused={() => false} onPress={back} />
          </If>
          <SearchField
            value={query}
            focused={() => zone() === "field"}
            onChange={(text) => query.set(text)}
            onSubmit={submit}
            onFocus={() => zone.set("field")}
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
