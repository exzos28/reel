// The Search screen on the core's answers (`Catalog.search` stands in: it
// answers the same whatever is typed, so each test picks the answer).
import { expect, test } from "nsh/test";
import { NATIVE, SEARCH_DUNE, SEARCH_RECENT, openApp } from "./testEngine";

/** Home, then the nav's Search. */
async function searchScreen(answer: object, extra: Record<string, unknown> = {}) {
  const app = await openApp({
    modules: { "app/native": { ...NATIVE, "Catalog.search": JSON.stringify(answer), "Catalog.rememberSearch": null, ...extra } },
  });
  await app.keyboard.press("up"); // hero
  await app.keyboard.press("up"); // nav, on Home
  for (let i = 0; i < 4; i++) await app.keyboard.press("right"); // Movies, Shows, Anime, Search
  await app.keyboard.press("enter");
  return app;
}

test("nothing typed: the recent searches; Down and OK search one again", async () => {
  const kept: string[] = [];
  const app = await searchScreen(SEARCH_RECENT, { "Catalog.rememberSearch": (q: string) => void kept.push(q) });
  expect(app.shows("search-field")).toBe(true);
  expect(app.texts()).toContain("Recent searches");
  expect(app.texts()).toContain("frieren");
  await app.keyboard.press("down");
  await app.keyboard.press("right");
  await app.keyboard.press("enter");
  await app.waitUntil(() => kept.length > 0);
  expect(kept).toEqual(["frieren"]);
});

test("typing shows the results in rows; Down, OK opens a title; Back comes back, then leaves", async () => {
  const app = await searchScreen(SEARCH_DUNE);
  await app.type("search-field", "dune");
  expect(app.texts()).toContain("Movies");
  expect(app.texts()).toContain("Shows");
  expect(app.texts()).toContain("Anime");
  expect(app.texts()).toContain("Dune");
  expect(app.texts()).toContain("Severance");
  await app.keyboard.press("down"); // Movies: Dune
  await app.keyboard.press("down"); // Shows: Severance
  await app.keyboard.press("up"); // Movies
  await app.keyboard.press("right"); // Arrival
  await app.keyboard.press("enter");
  expect(app.texts()).toContain("Your mind is the scene of the crime.");
  await app.keyboard.press("escape");
  expect(app.texts()).toContain("Arrival");
  expect(app.texts()).toContain("Movies");
  await app.keyboard.press("escape");
  expect(app.texts()).toContain("Continue watching");
});

test("Up from the first row goes back to the field; Back from the field leaves", async () => {
  const app = await searchScreen(SEARCH_DUNE);
  await app.keyboard.press("down");
  await app.keyboard.press("up");
  await app.keyboard.press("escape");
  expect(app.texts()).toContain("Continue watching");
});

test("OK on the field brings the keyboard up; Back closes it first, then leaves", async () => {
  const app = await searchScreen(SEARCH_DUNE);
  await app.keyboard.press("down");
  await app.keyboard.press("up");
  await app.keyboard.press("enter"); // the TV's keyboard
  await app.keyboard.press("escape");
  expect(app.shows("search-field")).toBe(true);
  await app.keyboard.press("escape");
  expect(app.texts()).toContain("Continue watching");
});

test("searching, nothing found, failed and without a TMDB key say so", async () => {
  let app = await searchScreen({ ...SEARCH_DUNE, state: "searching", sections: [] });
  expect(app.texts()).toContain("Searching…");
  app = await searchScreen({ ...SEARCH_DUNE, query: "zzz", sections: [] });
  expect(app.texts()).toContain("Nothing found for “zzz”.");
  app = await searchScreen({ ...SEARCH_DUNE, tmdb: false, sections: [SEARCH_DUNE.sections[2]] });
  expect(app.texts()).toContain("This build has no TMDB key, so only anime is searched.");
  expect(app.texts()).toContain("Frieren: Beyond Journey's End");
  app = await searchScreen({ ...SEARCH_DUNE, state: "failed", sections: [] });
  expect(app.texts()).toContain("TMDB and AniList did not answer. Check the connection and try again.");
});
