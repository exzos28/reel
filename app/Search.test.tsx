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
  for (let i = 0; i < 5; i++) await app.keyboard.press("right"); // Movies, Series, Cartoons, Anime, Search
  await app.keyboard.press("enter");
  await app.keyboard.press("down"); // chosen in the nav, the focus stays there: down to the field
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

test("Clear history forgets the recent searches: by a click, and by the remote after the last pill", async () => {
  let cleared = 0;
  const app = await searchScreen(SEARCH_RECENT, { "Catalog.forgetSearches": () => void cleared++ });
  expect(app.texts()).toContain("Clear history");
  await app.keyboard.press("down"); // the first pill
  await app.keyboard.press("right"); // the second
  await app.keyboard.press("right"); // Clear history
  await app.keyboard.press("enter");
  expect(cleared).toBe(1);
  await app.press("id:search-clear");
  expect(cleared).toBe(2);
});

test("typing shows the results in rows; Down, OK opens a title; Back comes back, then leaves", async () => {
  const app = await searchScreen(SEARCH_DUNE);
  await app.type("search-field", "dune");
  expect(app.texts()).toContain("Movies");
  expect(app.texts()).toContain("Series");
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
  await app.keyboard.press("escape"); // the focus to Search in the nav
  expect(app.texts()).toContain("Arrival");
  await app.keyboard.press("escape");
  expect(app.texts()).toContain("Continue watching");
});

test("Up from the first row goes back to the field; Back from the field goes to the nav, then Home", async () => {
  const app = await searchScreen(SEARCH_DUNE);
  await app.keyboard.press("down");
  await app.keyboard.press("up");
  await app.keyboard.press("escape");
  expect(app.shows("search-field")).toBe(true);
  await app.keyboard.press("escape");
  expect(app.texts()).toContain("Continue watching");
});

test("OK on the field brings the keyboard up; Back closes it first, then leaves", async () => {
  const app = await searchScreen(SEARCH_DUNE);
  await app.keyboard.press("down");
  await app.keyboard.press("up");
  await app.keyboard.press("enter"); // the TV's keyboard
  await app.keyboard.press("escape"); // closes it
  await app.keyboard.press("escape"); // the nav
  expect(app.shows("search-field")).toBe(true);
  await app.keyboard.press("escape");
  expect(app.texts()).toContain("Continue watching");
});

test("searching, nothing found, failed and without a TMDB key say so", async () => {
  let app = await searchScreen({ ...SEARCH_DUNE, state: "searching", sections: [] });
  expect(app.texts()).toContain("Searching…");
  app = await searchScreen({ ...SEARCH_DUNE, query: "zzz", sections: [] });
  expect(app.texts()).toContain("Nothing found for “zzz”. Try the original title or fewer words.");
  app = await searchScreen({ ...SEARCH_DUNE, tmdb: false, sections: [SEARCH_DUNE.sections[2]] });
  expect(app.texts()).toContain("This build has no TMDB key, so only anime is searched.");
  expect(app.texts()).toContain("Frieren: Beyond Journey's End");
  app = await searchScreen({ ...SEARCH_DUNE, state: "failed", sections: [] });
  expect(app.texts()).toContain("TMDB and AniList did not answer. Check the connection and try again.");
});

test("a row whose source did not answer says so; OK on it, or a click, tries again", async () => {
  const asked: string[] = [];
  const answer = { ...SEARCH_DUNE, sections: [{ id: "movies", state: "failed", items: [] }, SEARCH_DUNE.sections[1]] };
  const app = await searchScreen(answer, { "Catalog.retrySearch": (q: string) => void asked.push(q) });
  await app.type("search-field", "dune");
  expect(app.texts()).toContain("Movies");
  expect(app.texts()).toContain("Could not load films.");
  expect(app.texts()).toContain("Severance");
  expect(app.texts()).not.toContain("TMDB and AniList did not answer. Check the connection and try again.");
  await app.keyboard.press("down"); // Movies: its Try again
  await app.keyboard.press("right"); // nothing to the side
  await app.keyboard.press("enter");
  expect(asked).toEqual(["dune"]);
  await app.keyboard.press("down"); // Series still opens
  await app.keyboard.press("enter");
  expect(app.texts()).toContain("Your mind is the scene of the crime.");
  await app.keyboard.press("escape");
  await app.press("label:Try again");
  expect(asked).toEqual(["dune", "dune"]);
});

test("nothing searched yet: what is trending now, to start from; OK opens a title", async () => {
  const trending = { ...SEARCH_DUNE.sections[0], id: "trending", facet: "kind" };
  const app = await searchScreen({ ...SEARCH_RECENT, recent: [], sections: [trending] });
  expect(app.texts()).toContain("Trending now");
  expect(app.texts()).not.toContain("Recent searches");
  await app.keyboard.press("down"); // the row
  await app.keyboard.press("enter");
  expect(app.texts()).toContain("Your mind is the scene of the crime.");
});

test("phone: the field's ✕ empties it (a TV's keyboard deletes instead)", async () => {
  const app = await openApp({
    platform: "ios", width: 393, height: 852, safeArea: { top: 54, bottom: 34, left: 0, right: 0 },
    modules: { "app/native": { ...NATIVE, "Catalog.search": JSON.stringify(SEARCH_DUNE), "Catalog.rememberSearch": null } },
  });
  await app.press("label:Search");
  expect(app.shows("search-field-clear")).toBe(false);
  await app.type("search-field", "dune");
  expect(app.shows("search-field-clear")).toBe(true);
  await app.press("id:search-field-clear");
  expect(app.shows("search-field-clear")).toBe(false);
});
