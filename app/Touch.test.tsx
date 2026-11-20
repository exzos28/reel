// Phone and tablet (design/navigation.md, "Tablet" and "Phone"): the tabs,
// each tab keeping its own stack, a phone's Home with its categories at the
// top, Settings as a sheet over the page (tablet), Back from a pushed page.
import { expect, test } from "nsh/test";
import { INCEPTION_NO_SOURCE, NATIVE, SEARCH_DUNE, openApp } from "./testEngine";

const phone = () => openApp({ platform: "ios", width: 393, height: 852, safeArea: { top: 54, bottom: 34, left: 0, right: 0 }, modules: { "app/native": NATIVE } });

test("phone: Home, Search and Settings at the bottom; the categories at the top of Home, each from its top", async () => {
  const app = await phone();
  expect(app.shows("tab-bar")).toBe(true);
  for (const tab of ["Home", "Search", "Settings"]) expect(app.shows(`label:${tab}`)).toBe(true);
  for (const category of ["All", "Movies", "Series", "Cartoons", "Anime"]) expect(app.shows(`label:${category}`)).toBe(true);
  expect(app.shows("label:More")).toBe(false);
  await app.press("label:Movies");
  expect(app.texts()).toContain("All movies");
  // The tab says where you are: no page title or lead over the row.
  expect(app.texts()).not.toContain("Discover the latest and greatest films");
  expect(app.texts().filter((x) => x === "Movies").length).toBe(1);
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

/** An iPad held sideways: a headless run reports the phone idiom unless NSH's `platform` says
 * otherwise. Films save here: Inception and Dune say "Saving 5%", and Saving opens Saved. */
const tablet = (native: Record<string, unknown> = {}) =>
  openApp({
    platform: "ios",
    width: 1210,
    height: 834,
    safeArea: { top: 24, bottom: 20, left: 0, right: 0 },
    modules: {
      nsh: { "platform.idiom": "pad" },
      "app/native": {
        ...NATIVE,
        "Catalog.search": JSON.stringify(SEARCH_DUNE),
        "Catalog.rememberSearch": null,
        "Library.supported": true,
        "Library.revision": 1,
        "Library.title": JSON.stringify({ state: "saving", progress: 0.05 }),
        "Library.list": JSON.stringify({ saving: [], ready: [], failed: [], space: { saved: 0, free: 10 * 1024 ** 3, folder: null } }),
        "Library.overall": JSON.stringify({ saving: true, progress: 0.05 }),
        ...native,
      },
    },
  });

const TABLET_TABS = ["home", "movies", "shows", "cartoons", "anime", "search"];

test("tablet: each tab keeps its own pages, Settings is in none of them, the tab shown is the one selected", async () => {
  const app = await tablet();
  expect(app.shows("top-row")).toBe(true);
  // Home → a film → Settings, Interface, back, About: all in the sheet over the film.
  await app.press("label:Inception >> nth=0");
  await app.press("label:Settings");
  await app.press("label:Interface");
  expect(app.texts()).toContain("Loading animation");
  await app.press("label:Back to Settings");
  await app.press("label:About reel");
  expect(app.texts()).toContain("Data sources");
  await app.press("label:Close");
  expect(app.shows("settings-sheet")).toBe(false);
  // Search → a film, played and closed → Saving: Saved replaces what is shown.
  await app.press("label:Search");
  await app.press("label:Dune >> nth=0");
  await app.press("Resume 41:12");
  await app.press("label:Close");
  await app.press("label:Saving 5%");
  expect(TABLET_TABS.some((tab) => app.shows(`top-tab-on-${tab}`))).toBe(false); // Saved is no tab
  // Series → a show → Home: Home's own page, the film left there, Home selected.
  await app.press("label:Series");
  await app.press("label:Severance >> nth=0");
  await app.press("label:Home");
  expect(app.shows("label:Back to Home")).toBe(true);
  expect(app.texts()).not.toContain("Data sources");
  expect(app.texts()).toContain("Saving 5%");
  expect(app.shows("top-tab-on-home")).toBe(true);
  // Home again: its root, still selected.
  await app.press("label:Home");
  expect(app.texts()).toContain("Continue watching");
  expect(app.shows("label:Back to Home")).toBe(false);
  expect(app.shows("top-tab-on-home")).toBe(true);
  // Search kept its film; Series its show.
  await app.press("label:Search");
  expect(app.shows("label:Back to Search")).toBe(true);
  expect(app.shows("top-tab-on-search")).toBe(true);
});

test("tablet: Settings opens as a sheet over the page and closes back to it", async () => {
  const app = await tablet();
  await app.press("label:Movies");
  await app.press("label:Dune >> nth=0");
  await app.press("label:Settings");
  expect(app.shows("settings-sheet")).toBe(true);
  expect(app.texts()).toContain("Playback buffer");
  expect(app.shows("label:Back to Settings")).toBe(false); // Settings is the sheet's first page
  // The page under it stays the film, behind the sheet.
  expect(app.shows("label:Back to Movies")).toBe(true);
  await app.press("label:About reel");
  expect(app.texts()).toContain("Data sources");
  await app.keyboard.press("escape"); // Back: About, then Settings
  expect(app.texts()).toContain("Playback buffer");
  await app.keyboard.press("escape");
  expect(app.shows("settings-sheet")).toBe(false);
  expect(app.texts()).toContain("Saving 5%"); // the film, where it was
  await app.press("label:Settings");
  await app.press("settings-sheet-backdrop"); // a press outside
  expect(app.shows("settings-sheet")).toBe(false);
  await app.keyboard.press("escape"); // then Back leaves the film
  expect(app.texts()).toContain("All movies");
});

test("tablet: the search source's drawer opens over the sheet, and Back closes it before the sheet", async () => {
  const app = await tablet();
  await app.press("label:Settings");
  await app.press("label:Search source");
  expect(app.shows("source-close")).toBe(true);
  await app.keyboard.press("escape");
  expect(app.shows("source-close")).toBe(false);
  expect(app.shows("settings-sheet")).toBe(true);
});

test("tablet: a film whose search source did not answer opens Settings as the sheet over it", async () => {
  const app = await tablet({ "Catalog.title": JSON.stringify({ ...INCEPTION_NO_SOURCE, releasesState: "failed" }) });
  await app.press("label:Inception >> nth=0");
  await app.press("label:Open Settings");
  expect(app.shows("settings-sheet")).toBe(true);
  await app.press("settings-sheet-close");
  expect(app.shows("label:Back to Home")).toBe(true);
});

// A tablet at a given window size (the top row, Saved, the narrow window).
const SAVING_ONE = { saving: true, progress: 0.4 };
const IDLE = { saving: false, progress: 0 };
const NOTHING_SAVED = { saving: [], ready: [], failed: [], space: { saved: 0, free: 1e10, folder: null } };
const tabletAt = (width = 1180, height = 820, native: Record<string, unknown> = {}) =>
  openApp({
    platform: "ios", width, height, safeArea: { top: 24, bottom: 20, left: 0, right: 0 },
    modules: {
      nsh: { "platform.idiom": "pad" },
      "app/native": {
        ...NATIVE, "Library.supported": true, "Library.revision": 1,
        "Library.list": JSON.stringify(NOTHING_SAVED), "Library.overall": JSON.stringify(IDLE), "Library.opening": "home",
        ...native,
      },
    },
  });

test("tablet: the top row with the tabs' labels where they fit, Saved and Settings at the right", async () => {
  const app = await tabletAt(1180, 820, { "Library.overall": JSON.stringify(SAVING_ONE) });
  expect(app.shows("top-row")).toBe(true);
  expect(app.shows("tab-bar")).toBe(false);
  expect(app.shows("top-tabs-labelled")).toBe(true);
  for (const tab of ["Home", "Movies", "Series", "Cartoons", "Anime", "Search", "Saved", "Settings"]) expect(app.shows(`label:${tab}`)).toBe(true);
  // Saving: a ring of the overall progress around Saved.
  expect(app.shows("saved-progress")).toBe(true);
  // Upright, the labels no longer fit between the logo and the buttons: icons only.
  await app.setViewport(744, 1133);
  expect(app.shows("top-tabs-icons")).toBe(true);
  expect(app.shows("top-row")).toBe(true);
});

test("tablet: Saved is a destination of its own, kept where it was left like a tab", async () => {
  const app = await tabletAt();
  await app.press("label:Movies");
  await app.press("label:Saved");
  expect(app.texts()).toContain("Save a film to watch it offline");
  await app.press("label:Browse films"); // Home, its own stack
  await app.press("label:Saved"); // back on Saved, where it was
  expect(app.texts()).toContain("Save a film to watch it offline");
  await app.press("label:Movies");
  expect(app.texts()).toContain("All movies");
});

test("tablet: the top row turns solid once the page is under it", async () => {
  const app = await tabletAt();
  await app.press("label:Movies");
  expect(app.shows("top-row")).toBe(true);
  await app.scroll("label:Genres", 800);
  await app.wait(300);
  expect(app.shows("top-row-solid")).toBe(true);
  await app.press("label:Dune >> nth=0");
  await app.wait(300);
  expect(app.shows("top-row")).toBe(true); // a title opens over its hero
  expect(app.shows("label:Back to Movies")).toBe(true);
  await app.press("label:Back to Movies");
  await app.wait(300);
  expect(app.shows("top-row-solid")).toBe(true); // where Movies was left
});

test("tablet in a narrow window: a phone's layout, and the top row again once it is wide", async () => {
  const app = await tabletAt(390, 844);
  expect(app.shows("tab-bar")).toBe(true);
  expect(app.shows("top-row")).toBe(false);
  for (const tab of ["Home", "Search", "Saved", "Settings"]) expect(app.shows(`label:${tab}`)).toBe(true);
  await app.press("label:Movies");
  expect(app.texts()).toContain("All movies");
  // Settings as the tablet's sheet, over the current tab.
  await app.press("label:Settings");
  expect(app.texts()).toContain("Playback buffer");
  await app.setViewport(1180, 820);
  expect(app.shows("top-row")).toBe(true);
  expect(app.shows("tab-bar")).toBe(false);
  expect(app.texts()).toContain("Playback buffer");
  await app.press("label:Close");
  expect(app.texts()).toContain("All movies");
  await app.setViewport(390, 844);
  expect(app.shows("tab-bar")).toBe(true);
});

test("tablet: without a network at start, the app opens on Saved", async () => {
  const app = await tabletAt(1180, 820, { "Library.opening": "saved" });
  await app.wait(200);
  expect(app.texts()).toContain("Save a film to watch it offline");
});

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
