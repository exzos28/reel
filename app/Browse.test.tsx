import { expect, test } from "nsh/test";
import { BROWSE_ALL, BROWSE_TRENDING, browseFilters, NATIVE, SEVERANCE, openApp } from "./testEngine";

/** A browse page with `picked` filter options selected (the grid as the core
 * answers it for them: only Severance once anything is picked); the choices
 * the UI sends go to `calls`. A stand-in function answers with a promise, so
 * the page itself stays as given. */
function page(picked: string[] = []) {
  const calls: string[][] = [];
  const all = picked.length ? [SEVERANCE] : BROWSE_ALL;
  const native = {
    ...NATIVE,
    "Catalog.browse": JSON.stringify({ trending: BROWSE_TRENDING, all, filters: browseFilters(picked), allState: "done" }),
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
