// Phone and tablet (design/navigation.md, "Tablet" and "Phone"): the tabs,
// each tab keeping its own stack, a phone's Home with its categories at the
// top, Settings pushed on the current tab (tablet), Back from a pushed page.
import { expect, test } from "nsh/test";
import { NATIVE, openApp } from "./testEngine";

const phone = () => openApp({ platform: "ios", width: 393, height: 852, safeArea: { top: 54, bottom: 34, left: 0, right: 0 }, modules: { "app/native": NATIVE } });

test("phone: Home, Search and Settings at the bottom; the categories at the top of Home, each from its top", async () => {
  const app = await phone();
  expect(app.shows("tab-bar")).toBe(true);
  for (const tab of ["Home", "Search", "Settings"]) expect(app.shows(`label:${tab}`)).toBe(true);
  for (const category of ["All", "Movies", "Series", "Cartoons", "Anime"]) expect(app.shows(`label:${category}`)).toBe(true);
  expect(app.shows("label:More")).toBe(false);
  await app.press("label:Movies");
  expect(app.texts()).toContain("All movies");
  await app.press("label:Dune >> nth=0");
  expect(app.shows("label:1080p BluRay · 8 GB · 412 people sharing")).toBe(true);
  expect(app.shows("tab-bar")).toBe(true); // on a pushed page too
  await app.press("label:Search");
  await app.press("label:Home"); // the Home tab: the category open last, where it was left
  expect(app.shows("label:1080p BluRay · 8 GB · 412 people sharing")).toBe(true);
  await app.press("label:Home"); // chosen again: its root
  expect(app.texts()).toContain("All movies");
  await app.press("label:Dune >> nth=0");
  await app.press("label:Back to Movies");
  await app.press("label:Series"); // a category from the top: from its top
  expect(app.texts()).toContain("All series");
  await app.press("label:Anime");
  expect(app.texts()).toContain("All anime");
});

test("phone: Settings is a tab of its own, without Back; Back from it goes to the Home tab", async () => {
  const app = await phone();
  await app.press("label:Movies");
  await app.press("label:Settings");
  expect(app.texts()).toContain("Playback buffer");
  expect(app.shows("back-head")).toBe(false);
  expect(app.shows("label:Anime")).toBe(false); // no categories over Settings
  await app.keyboard.press("escape");
  expect(app.texts()).toContain("All movies");
});

test("phone held sideways: the tabs are a rail at the left", async () => {
  const app = await openApp({ platform: "ios", width: 852, height: 393, safeArea: { top: 0, bottom: 21, left: 62, right: 62 }, modules: { "app/native": NATIVE } });
  expect(app.shows("nav-rail")).toBe(true);
  expect(app.shows("tab-bar")).toBe(false);
  await app.press("label:Movies");
  expect(app.texts()).toContain("All movies");
});

test("phone: the back disc over a title's hero goes back; the Watchlist is the disc across from it", async () => {
  const app = await phone();
  await app.press("label:Movies");
  await app.press("label:Dune >> nth=0");
  expect(app.shows("title-discs")).toBe(true);
  expect(app.shows("label:Add to list")).toBe(true);
  await app.press("label:Back to Movies");
  expect(app.texts()).toContain("All movies");
});

test("phone: a title scrolled past its hero keeps a bar with Back, its name and the Watchlist; the status bar's scrim is solid", async () => {
  const app = await phone();
  await app.press("label:Movies");
  await app.press("label:Dune >> nth=0");
  expect(app.shows("status-scrim")).toBe(true); // a fade over the hero
  await app.scroll("label:1080p BluRay · 8 GB · 412 people sharing", 600);
  await app.wait(300); // the bar fades in
  expect(app.shows("title-bar")).toBe(true);
  expect(app.shows("status-scrim-solid")).toBe(true);
  expect(app.shows("label:Add to list")).toBe(true);
  // A title opened from it starts over its hero; back on this one, its bar is still up. (The
  // test engine answers every title with Inception's details.)
  await app.press("label:Arrival >> nth=0");
  await app.wait(300);
  expect(app.shows("title-discs")).toBe(true);
  expect(app.shows("title-bar")).toBe(false);
  await app.press("label:Back to Inception");
  await app.wait(300);
  expect(app.shows("title-bar")).toBe(true);
  await app.press("label:Back to Movies");
  expect(app.texts()).toContain("All movies");
});

test("phone: the player's ✕ closes it", async () => {
  const app = await openApp({
    platform: "ios", width: 852, height: 393, safeArea: { top: 0, bottom: 21, left: 62, right: 62 },
    modules: { "app/native": { ...NATIVE, "Engine.status": '{"phase":"resolving","stage":"finding"}' } },
  });
  await app.press("Resume 41:12");
  expect(app.shows("tab-bar")).toBe(false); // not over the player
  await app.press("label:Close");
  expect(app.texts()).toContain("Continue watching");
});

// The tablet's top row (layout/TouchNav.tsx) is not covered here: a headless
// run reports the phone idiom at any size, and `open` cannot set the idiom.

test("phone: ⌄ in Play opens the releases in a bottom sheet; ✕ closes it", async () => {
  const app = await phone();
  await app.press("label:Movies");
  await app.press("label:Dune >> nth=0");
  await app.press("label:Other releases"); // ⌄ in Play
  expect(app.texts()).toContain("3 found, the best of each quality first");
  await app.press("label:Close");
  await app.wait(600); // the sheet slides away
  expect(app.texts()).not.toContain("3 found, the best of each quality first");
  await app.press("label:Back to Movies");
  expect(app.texts()).toContain("All movies");
});

test("phone, with a source: Home's Play waits for the source's answer, then opens the drawer when it did not answer", async () => {
  const home = JSON.parse(NATIVE["Catalog.home"] as string);
  home.hero.release = null;
  for (const shelf of home.shelves) for (const card of shelf.items ?? []) card.release = null;
  const film = { ...JSON.parse(NATIVE["Catalog.title"] as string), release: null, releases: [], releasesState: "failed" };
  const app = await openApp({
    platform: "ios", width: 393, height: 852, safeArea: { top: 54, bottom: 34, left: 0, right: 0 },
    modules: { "app/native": { ...NATIVE, "Catalog.home": JSON.stringify(home), "Catalog.title": JSON.stringify(film) } },
  });
  // Home says nothing under Play: the press finds out.
  expect(app.texts()).not.toContain("Your search source did not answer. Check it in Settings.");
  await app.press("label:Resume 41:12");
  expect(app.shows("source-panel")).toBe(true);
});

test("first run: the setup takes the screen, Next walks the steps, Skip ends it and asks the core", async () => {
  let finished = 0;
  const settings = {
    language: "en", contentLanguage: "en-US", setupDone: false, bufferMB: 256, streamDetails: false,
    contentLanguages: [{ tag: "en-US", name: "English" }, { tag: "pl-PL", name: "Polski" }],
    source: { url: "", hasKey: false },
    bufferChoices: [{ mb: 256, default: true }, { mb: 512, default: false }],
  };
  const app = await openApp({
    platform: "ios", width: 393, height: 852, safeArea: { top: 54, bottom: 34, left: 0, right: 0 },
    modules: { "app/native": { ...NATIVE, "Settings.load": JSON.stringify(settings), "Settings.finishSetup": () => (finished++, null) } },
  });
  expect(app.texts()).toContain("Which language should titles be in?");
  expect(app.shows("tab-bar")).toBe(false);
  await app.press("label:Next");
  expect(app.texts()).toContain("Playback buffer");
  await app.press("label:Next");
  expect(app.texts()).toContain("Where should reel find films?");
  expect(app.shows("status-scrim-solid")).toBe(true); // nothing of the page shows under the clock
  expect(app.shows("page-foot")).toBe(true); // Skip and Check pinned above the home indicator
  await app.press("label:Skip");
  expect(finished).toBe(1);
  expect(app.shows("tab-bar")).toBe(true);
});

test("first run on a phone: Back (the disc, or the system's swipe) goes to the previous step, what was chosen and typed kept", async () => {
  const chosen: number[] = [];
  const settings = {
    language: "en", contentLanguage: "en-US", setupDone: false, bufferMB: 256, streamDetails: false,
    contentLanguages: [{ tag: "en-US", name: "English" }, { tag: "pl-PL", name: "Polski" }],
    source: { url: "", hasKey: false },
    bufferChoices: [{ mb: 256, default: true }, { mb: 512, default: false }],
  };
  const app = await openApp({
    platform: "ios", width: 393, height: 852, safeArea: { top: 54, bottom: 34, left: 0, right: 0 },
    modules: { "app/native": { ...NATIVE, "Settings.load": JSON.stringify(settings), "Settings.setBufferMb": (mb: number) => (chosen.push(mb), mb) } },
  });
  expect(app.shows("label:Back")).toBe(false); // the first step has none
  await app.press("label:Next");
  expect(app.texts()).toContain("Playback buffer");
  const bigger = app.texts().find((x) => x.startsWith("512"))!;
  await app.press(`label:${bigger}`);
  await app.press("label:Back");
  expect(app.texts()).toContain("Which language should titles be in?");
  await app.press("label:Next");
  await app.press("label:Next");
  expect(app.texts()).toContain("Where should reel find films?");
  await app.type("source-url", "https://source.example/api");
  await app.back(); // iOS's swipe back
  expect(app.texts()).toContain("Playback buffer");
  await app.back();
  expect(app.texts()).toContain("Which language should titles be in?");
  await app.press("label:Next");
  expect(chosen).toEqual([512]); // the buffer chosen once, still the one in effect
  await app.press("label:Next");
  expect(app.value("source-url")).toBe("https://source.example/api"); // what was typed is kept
});
