// Movies, Shows and Anime: page title, a trending row of posters, the filter
// pills and a grid of 16:9 cards through the filters. Remote: the focus
// starts on the first poster; Up from the row goes to the nav; Down goes to
// the pills (left/right along them), Down again to the grid, which moves by
// rows and columns (Up from its first row: the pills). OK on a pill opens its
// panel on the right (Up/Down, OK picks, Back closes); OK on a card opens the
// title. Back closes the panel, then takes the focus to the nav, then Home. A new grid puts the grid's focus on its first card.
// The grid has no end: within two rows of its last (or when the page scrolls near it) the
// core is asked for its next page, which lands under the rows shown; the focus stays.
import { computed, effect, Text, untracked, View } from "nsh";
import { t } from "nsh/i18n";
import { browse, browseMore, chooseFilter, clearFilters, type Summary } from "../../catalog";
import { caps } from "../../platform";
import { clamp } from "../../focus/memory";
import { useRootBack } from "../../focus/rootBack";
import { useZones } from "../../focus/zones";
import { metaText } from "../../kit/text";
import { cellWidth, Grid, GRID_GAP, GRID_ROW_GAP, gridColumnsNow, gridRows } from "../../layout/Grid";
import { NAV } from "../../layout/navItems";
import { PageFrame } from "../../layout/PageFrame";
import { scroller } from "../../layout/Scroller";
import { showNav } from "../../layout/navState";
import { go, goFromNav, openTitle } from "../../nav";
import { safe, u } from "../../theme";
import { BrowseHeader } from "./BrowseHeader";
import { FilterBar } from "./FilterBar";
import { FilterPanel, panelRows } from "./FilterPanel";
import { focusOf, type Page } from "./focus";
import { GridCard } from "./GridCard";
import { GridTail } from "./GridTail";
import { Trending } from "./Trending";

/** The next page is asked for when the focus is this many rows from the grid's last. */
const NEAR_ROWS = 2;

export function BrowseScreen(props: { page: Page }) {
  const data = computed(() => browse(props.page));
  const { zone, nav, trend, pill, row, cell, gridIds } = focusOf[props.page];
  /** Cards per grid row: as many as fit at about 330 TV pixels each. */
  const columns = computed(() => gridColumnsNow());
  const rows = computed(() => gridRows<Summary>(data().all, columns()));
  const count = () => data().all.length;
  const groups = () => data().filters;
  const panelGroup = () => groups()[pill()];
  const panelOpen = () => zone() === "panel" && panelGroup() != null;
  const panelCount = () => {
    const g = panelGroup();
    return g ? panelRows(g).length : 0;
  };

  /** Another grid (the filters changed): its first card is the one to focus. More of the
   * same grid (its next page) keeps the focus where it is. */
  const ids = computed(() => data().all.map((s) => s.id).join(","));
  effect(() => {
    const now = ids();
    untracked(() => {
      const before = gridIds();
      if (before !== now) {
        if (before !== "" && !now.startsWith(`${before},`)) cell.set(0);
        gridIds.set(now);
      }
      if (zone() === "grid" && count() === 0) zone.set("filters");
    });
  });

  const openPanel = (i: number) => {
    pill.set(i);
    const g = groups()[i];
    const at = g ? panelRows(g).findIndex((o) => o.selected) : -1;
    row.set(Math.max(at, 0));
    zone.set("panel");
  };
  const closePanel = () => zone.set("filters");
  const pick = (at: number) => {
    const g = panelGroup();
    if (!g) return;
    row.set(at);
    const o = panelRows(g)[at];
    if (!o) return;
    chooseFilter(props.page, g.id, o.id);
    // A choice is made: the sheet closes at once. A remote's panel keeps genres open to toggle
    // several (each is a walk back to the pill there).
    if (!g.multi || !caps.remote) closePanel();
  };
  /** The bar's Clear (the focus on it: -1); the focus goes on to the first pill, as Clear goes. */
  const clearAll = () => {
    clearFilters(props.page);
    pill.set(0);
  };
  // Clear goes once nothing is filtered: the focus stays on the bar.
  effect(() => {
    if (!data().filtered && untracked(pill) < 0) pill.set(0);
  });
  /** The core's next page, unless one is on its way or there is none. */
  const askMore = () =>
    untracked(() => {
      const d = data();
      if (d.more && d.moreState !== "loading") browseMore(props.page);
    });
  // The remote: the focus near the grid's last rows (again when a page landed and it still is).
  effect(() => {
    if (zone() !== "grid") return;
    if (Math.floor(cell() / columns()) >= rows().length - 1 - NEAR_ROWS) askMore();
  });

  const toGrid = () => {
    if (count() === 0) return;
    zone.set("grid");
    cell.set(clamp(cell() % columns(), count() - 1));
  };

  /** The page puts the focused grid row in its upper third. */
  const page = scroller({ anchor: (viewport) => viewport / 3, memory: `browse:${props.page}` });

  showNav(() => (zone() === "nav" ? nav() : null));
  useRootBack({
    ctl: page,
    onNav: () => zone() === "nav",
    toNav: () => {
      zone.set("nav");
      nav.set(NAV.findIndex((n) => n.id === props.page));
    },
  });
  useZones(
    zone,
    {
      nav: {
        left: () => nav.set(clamp(nav() - 1, NAV.length - 1)),
        right: () => nav.set(clamp(nav() + 1, NAV.length - 1)),
        down: () => zone.set("trending"),
        enter: () => goFromNav(NAV[nav()].id),
      },
      trending: {
        left: () => trend.set(clamp(trend() - 1, data().trending.length - 1)),
        right: () => trend.set(clamp(trend() + 1, data().trending.length - 1)),
        up: () => zone.set("nav"),
        down: () => (groups().length > 0 ? zone.set("filters") : toGrid()),
        enter: () => openTitle(data().trending[trend()].id),
      },
      filters: {
        // Left of the first pill: Clear, while a filter is on.
        left: () => pill.set(Math.max(pill() - 1, data().filtered ? -1 : 0)),
        right: () => pill.set(clamp(pill() + 1, groups().length - 1)),
        up: () => zone.set("trending"),
        down: toGrid,
        enter: () => (pill() < 0 ? clearAll() : openPanel(clamp(pill(), groups().length - 1))),
      },
      panel: {
        up: () => row.set(clamp(row() - 1, panelCount() - 1)),
        down: () => row.set(clamp(row() + 1, panelCount() - 1)),
        enter: () => pick(row()),
      },
      grid: {
        left: () => {
          if (cell() % columns() > 0) cell.set(cell() - 1);
        },
        right: () => {
          if (cell() % columns() < columns() - 1 && cell() + 1 < count()) cell.set(cell() + 1);
        },
        up: () => {
          if (cell() >= columns()) cell.set(cell() - columns());
          else zone.set(groups().length > 0 ? "filters" : "trending");
        },
        down: () => {
          if (cell() + columns() < count()) cell.set(cell() + columns());
        },
        enter: () => openTitle(data().all[cell()].id),
      },
    },
    // Back closes a filter's panel first.
    () => zone() === "panel" && (closePanel(), true),
  );

  const openTrending = (i: number) => {
    zone.set("trending");
    trend.set(i);
    openTitle(data().trending[i].id);
  };
  const openCell = (at: number) => {
    zone.set("grid");
    cell.set(at);
    openTitle(data().all[at].id);
  };
  /** A line instead of (or while waiting for) the grid. */
  const stateText = () => {
    const s = data().allState;
    if (s === "empty" || s === "offline") return t(`browse.state.${s}`);
    return s === "loading" && count() === 0 && groups().length > 0 ? t("browse.state.loading") : "";
  };

  return (
    <View style={{ flex: 1 }}>
      <PageFrame ctl={page} kind="root" title={() => t(`browse.${props.page}.title`)} topRef={page.follow(() => zone() === "nav", "start")}>
        <BrowseHeader page={props.page} />
        <Trending
          title={() => t(`browse.${props.page}.trending`)}
          items={() => data().trending}
          facet={() => data().facet}
          airs={props.page !== "movies"}
          focusedAt={() => (zone() === "trending" ? trend() : null)}
          blockRef={page.follow(() => zone() === "trending", "nearest")}
          onOpen={openTrending}
          page={page}
        />
        <FilterBar
          title={() => t(`browse.${props.page}.all`)}
          groups={groups}
          filtered={() => data().filtered}
          onClear={clearAll}
          focusedAt={() => (zone() === "filters" ? pill() : null)}
          openAt={() => (panelOpen() ? pill() : null)}
          blockRef={page.follow(() => zone() === "filters" || zone() === "panel", "nearest")}
          onOpen={openPanel}
          page={page}
        />
        <If when={stateText()}>
          <Text style={{ ...metaText(), paddingHorizontal: safe().x, marginTop: u(24) }}>{stateText()}</Text>
        </If>
        <Grid
          rows={rows}
          key={(s) => s.id}
          top={20}
          rowGap={GRID_ROW_GAP}
          gap={GRID_GAP}
          rowRef={(r) => page.follow(() => zone() === "grid" && cell() >= r().at && cell() < r().at + r().items.length)}
          page={page}
          focusRow={() => (zone() === "grid" ? Math.floor(cell() / columns()) : null)}
          cell={(item, at) => (
            <GridCard
              item={item}
              facet={() => data().facet}
              width={() => cellWidth(columns(), GRID_GAP)}
              focused={() => zone() === "grid" && cell() === at()}
              page={page}
              onPress={() => openCell(at())}
            />
          )}
        />
        <GridTail
          page={page}
          state={() => (data().more ? data().moreState : "idle")}
          columns={columns}
          width={() => cellWidth(columns(), GRID_GAP)}
          gap={GRID_GAP}
          grid={data}
          onNear={askMore}
        />
      </PageFrame>
      <If when={panelOpen()}>
        <FilterPanel group={() => panelGroup()!} focusedAt={row} onPress={pick} onClose={closePanel} />
      </If>
    </View>
  );
}
