import { expect, test } from "nsh/test";
import { BROWSE_ALL, BROWSE_TRENDING, browseCards, browseFilters, NATIVE, SEVERANCE, openApp } from "./testEngine";

/** Grid cards per row on the tests' 1920-wide TV. */
const COLUMNS = 5;

/** A browse page with `picked` filter options selected (the grid as the core
 * answers it for them: only Severance once anything is picked); the choices
 * the UI sends go to `calls`. A stand-in function answers with a promise, so
 * the page itself stays as given. */
function page(picked: string[] = []) {
  const calls: string[][] = [];
  const all = picked.length ? [SEVERANCE] : BROWSE_ALL;
  const native = {
    ...NATIVE,
    "Catalog.browse": JSON.stringify({
      trending: BROWSE_TRENDING, all, filters: browseFilters(picked), allState: "done", facet: "year",
      filtered: picked.some((id) => !["popular", "top_rated", "newest"].includes(id)),
    }),
    "Catalog.chooseFilter": (p: string, group: string, id: string) => {
      calls.push([p, group, id]);
      return true;
    },
  };
  return { native, calls };
}

async function movies(native: Record<string, {} | null>, options: Record<string, unknown> = {}) {
  const app = await openApp({ ...options, modules: { "app/native": native } });
  await app.keyboard.press("up"); // hero
  await app.keyboard.press("up"); // nav, on Home
  await app.keyboard.press("right"); // Movies
  await app.keyboard.press("enter");
  expect(app.texts()).toContain("All movies");
  // A destination chosen in the nav keeps the focus there: into the page, on Trending.
  if (!options.platform) await app.keyboard.press("down");
  return app;
}

test("remote: Down reaches the pills, OK opens Genres, OK toggles and it stays open, Back closes", async () => {
  const { native, calls } = page();
  const app = await movies(native);
  expect(app.texts()).toContain("Genres");
  expect(app.texts()).toContain("Years");
  await app.keyboard.press("down"); // the pills, on Genres
  await app.keyboard.press("enter");
  expect(app.shows("id:filter-panel")).toBe(true);
  expect(app.texts()).toContain("Science Fiction");
  await app.keyboard.press("down"); // Drama
  // The Clear row is on top of the choices (the focused row draws last, over its neighbours).
  const texts = app.texts();
  expect(texts.lastIndexOf("Any")).toBe(texts.lastIndexOf("Crime") - 1);
  await app.keyboard.press("enter");
  await app.keyboard.press("down"); // Crime
  await app.keyboard.press("enter");
  expect(calls).toEqual([["movies", "genres", "18"], ["movies", "genres", "80"]]);
  expect(app.shows("id:filter-panel")).toBe(true);
  await app.keyboard.press("escape");
  expect(app.shows("id:filter-panel")).toBe(false);
  expect(app.texts()).toContain("All movies");
  // Back again takes the focus to the nav, then leaves the page.
  await app.keyboard.press("escape");
  expect(app.texts()).toContain("All movies");
  await app.keyboard.press("escape");
  expect(app.texts()).toContain("Continue watching");
});

test("the pills say what is picked; the panel marks it and focuses it first", async () => {
  const { native, calls } = page(["18", "80", "2010", "FR", "top_rated"]);
  const app = await movies(native);
  expect(app.texts()).toContain("Genres: Drama, Crime");
  expect(app.texts()).toContain("2010s");
  expect(app.texts()).toContain("France");
  expect(app.texts().join(" ")).toContain("Top rated");
  // The grid is the core's answer for the filters.
  expect(app.count("label:Severance")).toBe(1);
  expect(app.count("label:Arrival")).toBe(1); // the trending poster only
  await app.keyboard.press("down"); // Genres
  await app.keyboard.press("enter");
  expect(app.count("label:Drama")).toBe(1);
  // The focus starts on the first picked row (Drama): OK takes it off.
  await app.keyboard.press("enter");
  expect(calls).toEqual([["movies", "genres", "18"]]);
  await app.keyboard.press("up"); // Clear
  await app.keyboard.press("enter");
  expect(calls[1]).toEqual(["movies", "genres", ""]);
});

test("a filter on: ✕ Clear comes first; the remote reaches it left of Genres, OK clears them all", async () => {
  expect((await movies(page().native)).texts()).not.toContain("✕ Clear");
  const { native, calls } = page(["18", "top_rated"]);
  const app = await movies(native);
  expect(app.texts()).toContain("✕ Clear");
  await app.keyboard.press("down"); // Genres
  await app.keyboard.press("left"); // Clear
  await app.keyboard.press("enter");
  expect(calls).toEqual([["movies", "all", ""]]);
  expect(app.shows("id:filter-panel")).toBe(false);
});

test("phone: a pick closes the sheet at once, genres too; Clear is a tap", async () => {
  const { native, calls } = page(["18"]);
  const app = await openApp({ platform: "ios", width: 393, height: 852, safeArea: { top: 54, bottom: 34, left: 0, right: 0 }, modules: { "app/native": native } });
  await app.press("label:Movies");
  await app.press("id:filter-genres");
  expect(app.shows("id:filter-panel")).toBe(true);
  await app.press("label:Crime");
  expect(calls).toEqual([["movies", "genres", "80"]]);
  await app.wait(600); // the sheet slides away
  expect(app.shows("id:filter-panel")).toBe(false);
  await app.press("id:filter-clear");
  expect(calls[1]).toEqual(["movies", "all", ""]);
});

test("a single choice closes its panel; Up from the grid comes back to the pills", async () => {
  const { native, calls } = page();
  const app = await movies(native);
  expect(app.count("label:Arrival")).toBe(2); // a trending poster and a grid card
  await app.keyboard.press("down"); // Genres
  await app.keyboard.press("right"); // Years
  await app.keyboard.press("enter");
  expect(app.texts()).toContain("Before 1960");
  await app.keyboard.press("down"); // 2020s
  await app.keyboard.press("down"); // 2010s
  await app.keyboard.press("enter");
  expect(calls).toEqual([["movies", "years", "2010"]]);
  expect(app.shows("id:filter-panel")).toBe(false);
  await app.keyboard.press("down"); // the grid
  await app.keyboard.press("up"); // the pills, on Years
  await app.keyboard.press("right"); // Countries
  await app.keyboard.press("enter");
  expect(app.texts()).toContain("France");
  await app.keyboard.press("down");
  await app.keyboard.press("down"); // France
  await app.keyboard.press("enter");
  expect(calls[1]).toEqual(["movies", "countries", "FR"]);
});

test("Sort by is a pill with the same panel, without Clear", async () => {
  const { native, calls } = page();
  const app = await movies(native);
  expect(app.texts().join(" ")).toContain("Most popular");
  await app.keyboard.press("down");
  for (let i = 0; i < 3; i++) await app.keyboard.press("right"); // Years, Countries, Sort
  await app.keyboard.press("right"); // stays on the last
  await app.keyboard.press("enter");
  expect(app.shows("id:filter-panel")).toBe(true);
  expect(app.texts()).not.toContain("Any");
  expect(app.texts()).toContain("Newest");
  await app.keyboard.press("down"); // Top rated
  await app.keyboard.press("enter");
  expect(calls).toEqual([["movies", "sort", "top_rated"]]);
  expect(app.shows("id:filter-panel")).toBe(false);
});

test("mouse: a pill opens its drawer, a row picks, ✕ closes it", async () => {
  const { native, calls } = page();
  const app = await movies(native, { platform: "macos", width: 1440, height: 900 });
  await app.press("id:filter-countries");
  await app.press("France");
  expect(calls).toEqual([["movies", "countries", "FR"]]);
  expect(app.shows("id:filter-panel")).toBe(false);
  await app.press("id:filter-genres");
  expect(app.shows("id:filter-panel")).toBe(true);
  await app.press("label:Close");
  await app.wait(600); // the sheet slides away
  expect(app.shows("id:filter-panel")).toBe(false);
});

test("nothing matching says so", async () => {
  const { native } = page();
  const app = await movies({
    ...native,
    "Catalog.browse": JSON.stringify({ trending: BROWSE_TRENDING, all: [], filters: browseFilters(["FR"]), allState: "empty" }),
  });
  expect(app.texts()).toContain("Nothing matches these filters.");
  // Down from the pills stays there: no grid.
  await app.keyboard.press("down");
  await app.keyboard.press("down");
  await app.keyboard.press("enter");
  expect(app.shows("id:filter-panel")).toBe(true);
});

/** A long grid the core has more of (`moreState` as given): the pages the UI
 * asks for go to `asked`. */
function longGrid(moreState = "idle", more = true) {
  const asked: string[] = [];
  const native = {
    ...NATIVE,
    "Catalog.browse": JSON.stringify({
      trending: BROWSE_TRENDING, all: browseCards(40), filters: browseFilters(), allState: "done", more, moreState,
    }),
    "Catalog.browseMore": (p: string) => {
      asked.push(p);
      return true;
    },
  };
  return { native, asked };
}

test("remote: moving down the grid asks for the next page two rows before its end; the focus stays", async () => {
  const { native, asked } = longGrid();
  const app = await movies(native);
  await app.keyboard.press("down"); // the pills
  await app.keyboard.press("down"); // the grid's first row
  expect(asked).toEqual([]);
  let rows = 0;
  while (asked.length === 0 && rows < 20) {
    await app.keyboard.press("down");
    rows++;
  }
  expect(asked).toEqual(["movies"]);
  // 40 cards, COLUMNS a row: the last row is row 7 (from 0), so row 5 asks.
  expect(rows).toBe(Math.ceil(40 / COLUMNS) - 3);
  // Asking does not move the focus: it is on the first card of that row.
  const focused = `Film ${rows * COLUMNS + 1}`;
  expect(app.shows(`id:grid-focused >> text:${focused}`)).toBe(true);
  await app.keyboard.press("right");
  expect(app.shows(`id:grid-focused >> text:Film ${rows * COLUMNS + 2}`)).toBe(true);
});

test("mouse: scrolling near the grid's end asks for the next page", async () => {
  const { native, asked } = longGrid();
  const app = await movies(native, { platform: "macos", width: 1440, height: 900 });
  expect(asked).toEqual([]);
  await app.scroll("Film 1", 4000);
  await app.wait(100);
  expect(asked.length).toBeGreaterThan(0);
  expect(asked[0]).toBe("movies");
});

test("grey cards end the grid while its next page comes; a line when it failed; nothing past the end", async () => {
  const loading = await movies(longGrid("loading").native);
  expect(loading.shows("id:grid-skeleton")).toBe(true);
  const failed = await movies(longGrid("failed").native);
  expect(failed.shows("id:grid-skeleton")).toBe(false);
  expect(failed.texts()).toContain("Could not load more titles. Move down to try again.");
  const { native, asked } = longGrid("idle", false);
  const end = await movies(native);
  for (let i = 0; i < 12; i++) await end.keyboard.press("down");
  expect(asked).toEqual([]);
  expect(end.shows("id:grid-skeleton")).toBe(false);
});

test("desktop: resting the pointer on a card for 0.6 s opens a preview with the details", async () => {
  const { native } = page();
  const all = [{ ...BROWSE_ALL[2], about: "A thief who steals secrets through dreams." }, ...BROWSE_ALL.slice(0, 2)];
  // A manual clock: 0.3 s is 0.3 s of the app's time however busy the machine is.
  const app = await movies({ ...native, "Catalog.browse": JSON.stringify({ trending: BROWSE_TRENDING, all, filters: browseFilters(), allState: "done" }) }, { platform: "macos", width: 1440, height: 900, clock: {} });
  await app.hover("label:Inception >> nth=1"); // the grid's first card
  await app.wait(300);
  expect(app.shows("id:preview")).toBe(false);
  await app.waitFor("id:preview");
  expect(app.texts()).toContain("A thief who steals secrets through dreams.");
  expect(app.shows("label:Open")).toBe(true);
});

/** A grid page whose first card has an about, and the preview of it open. */
async function previewOpen() {
  const { native } = page();
  // Inception first, then enough films for the page to scroll.
  const all = [{ ...BROWSE_ALL[2], about: "A thief who steals secrets through dreams." }, ...browseCards(40)];
  const app = await movies({ ...native, "Catalog.browse": JSON.stringify({ trending: BROWSE_TRENDING, all, filters: browseFilters(), allState: "done" }) }, { platform: "macos", width: 1440, height: 900 });
  await app.hover("label:Inception >> nth=1"); // the grid's first card
  await app.waitFor("id:preview");
  expect(app.shows("label:Open")).toBe(true);
  return app;
}

test("desktop: the preview's title opens the title, not only its Open button", async () => {
  const app = await previewOpen();
  await app.press("label:Inception >> nth=2"); // the title in the preview (the card's own are the first two)
  expect(app.shows("label:1080p BluRay · 8 GB · 412 people sharing")).toBe(true); // Inception's page
});

test("desktop: scrolling the page closes the preview (the pointer stays still and never leaves)", async () => {
  const app = await previewOpen();
  await app.scroll("Film 10", 300);
  await app.waitFor("id:preview", { state: "gone" });
});
