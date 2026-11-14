// Movies, Shows and Anime: page title, a trending row of posters, the filter
// pills (static for now) and a grid of 16:9 cards. Remote: the focus starts
// on the first poster; Up from the row goes to the nav; the grid moves by
// rows and columns. OK opens the title. Back goes Home.
import { computed, View } from "nsh";
import { t } from "nsh/i18n";
import { browse, type Summary } from "../../catalog";
import { clamp } from "../../focus/memory";
import { useZones } from "../../focus/zones";
import { cellWidth, Grid, gridColumns, gridRows } from "../../layout/Grid";
import { NAV_BOTTOM } from "../../layout/NavBar";
import { NAV } from "../../layout/navItems";
import { Screen } from "../../layout/Screen";
import { scroller } from "../../layout/Scroller";
import { showNav } from "../../layout/navState";
import { back, go, openTitle } from "../../nav";
import { u } from "../../theme";
import { BrowseHeader } from "./BrowseHeader";
import { FilterBar } from "./FilterBar";
import { focusOf, type Page } from "./focus";
import { GridCard } from "./GridCard";
import { Trending } from "./Trending";

export function BrowseScreen(props: { page: Page }) {
  const data = computed(() => browse(props.page));
  const { zone, nav, trend, cell } = focusOf[props.page];
  /** Cards per grid row: as many as fit at about 330 TV pixels each. */
  const columns = computed(() => gridColumns(326, 24));
  const rows = computed(() => gridRows<Summary>(data().all, columns()));
  const count = () => data().all.length;

  /** The page puts the focused grid row in its upper third. */
  const page = scroller({ anchor: (viewport) => viewport / 3 });

  showNav(() => (zone() === "nav" ? nav() : null));
  useZones(
    zone,
    {
      nav: {
        left: () => nav.set(clamp(nav() - 1, NAV.length - 1)),
        right: () => nav.set(clamp(nav() + 1, NAV.length - 1)),
        down: () => zone.set("trending"),
        enter: () => go(NAV[nav()].id),
      },
      trending: {
        left: () => trend.set(clamp(trend() - 1, data().trending.length - 1)),
        right: () => trend.set(clamp(trend() + 1, data().trending.length - 1)),
        up: () => zone.set("nav"),
        down: () => {
          zone.set("grid");
          cell.set(clamp(cell() % columns(), count() - 1));
        },
        enter: () => openTitle(data().trending[trend()].id),
      },
      grid: {
        left: () => {
          if (cell() % columns() > 0) cell.set(cell() - 1);
        },
        right: () => {
          if (cell() % columns() < columns() - 1 && cell() + 1 < count()) cell.set(cell() + 1);
        },
        up: () => (cell() < columns() ? zone.set("trending") : cell.set(cell() - columns())),
        down: () => {
          if (cell() + columns() < count()) cell.set(cell() + columns());
        },
        enter: () => openTitle(data().all[cell()].id),
      },
    },
    back,
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

  return (
    <Screen ctl={page} nav>
      <View ref={page.follow(() => zone() === "nav", "start")} style={{ height: u(NAV_BOTTOM) }} />
      <BrowseHeader page={props.page} />
      <Trending
        items={() => data().trending}
        airs={props.page !== "movies"}
        focusedAt={() => (zone() === "trending" ? trend() : null)}
        blockRef={page.follow(() => zone() === "trending", "nearest")}
        onOpen={openTrending}
      />
      <FilterBar title={() => t(`browse.${props.page}.all`)} />
      <Grid
        rows={rows}
        key={(s) => s.id}
        top={20}
        rowGap={28}
        gap={24}
        rowRef={(r) => page.follow(() => zone() === "grid" && cell() >= r().at && cell() < r().at + r().items.length)}
        cell={(item, at) => (
          <GridCard
            item={item}
            width={() => cellWidth(columns(), 24)}
            focused={() => zone() === "grid" && cell() === at()}
            onPress={() => openCell(at())}
          />
        )}
      />
    </Screen>
  );
}
