// Phone and tablet (design/navigation.md, "Tablet" and "Phone"): the tabs,
// each tab keeping its own stack, a phone's Home with its categories at the
// top, Settings and Saved as sections of their own (tablet), a narrow tablet as a phone, Back.
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

test("phone: the categories change the same with less motion, and the bar stays", async () => {
  const app = await openApp({ platform: "ios", width: 393, height: 852, safeArea: { top: 54, bottom: 34, left: 0, right: 0 }, reducedMotion: true, modules: { "app/native": NATIVE } });
  for (const [category, heading] of [["Anime", "All anime"], ["Series", "All series"], ["Movies", "All movies"]]) {
    await app.press(`label:${category}`);
    expect(app.shows("category-bar")).toBe(true);
    expect(app.texts()).toContain(heading);
  }
  expect(app.texts().filter((x) => x === "Anime").length).toBe(1);
});

test("phone: Home's tabs are the category page's own: a film opened over it covers them, Back and the swipe back bring them back", async () => {
  const app = await phone();
  expect(app.shows("category-bar")).toBe(true);
  await app.press("label:Movies");
  await app.press("label:Dune >> nth=0");
  expect(app.shows("category-bar")).toBe(false); // on the page under the film, not over it
  expect(app.shows("label:Anime")).toBe(false);
  await app.press("label:Back to Movies");
  expect(app.shows("category-bar")).toBe(true);
  expect(app.texts()).toContain("All movies");
  await app.press("label:Dune >> nth=0");
  await app.back(); // the native stack's own back (the edge swipe)
  expect(app.shows("category-bar")).toBe(true);
  await app.press("label:Series"); // a new page, its tabs moving on from the last ones
  await app.wait(300);
  expect(app.shows("category-bar")).toBe(true);
  expect(app.texts()).toContain("All series");
  expect(app.texts().filter((x) => x === "Series").length).toBe(1);
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

test("a person opened on a category's tab shows their name and photo, on a phone and in a narrow iPad window", async () => {
  for (const pad of [false, true]) {
    const app = await openApp({
      platform: "ios", width: 390, height: 844, safeArea: { top: 24, bottom: 20, left: 0, right: 0 },
      modules: { ...(pad ? { nsh: { "platform.idiom": "pad" } } : {}), "app/native": NATIVE },
    });
    await app.press("label:Movies");
    expect(app.texts()).not.toContain("Discover the latest and greatest films"); // the category's root: its tabs say it
    await app.press("label:Dune >> nth=0");
    await app.press("label:Leonardo DiCaprio >> nth=0");
    expect(app.texts()).toContain("Films and series");
    expect(app.texts()).toContain("Leonardo DiCaprio"); // the page's title, over the films
  }
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

test("tablet: each tab keeps its own pages, Settings and Saved are in none of them, the tab shown is the one selected", async () => {
  const app = await tablet();
  expect(app.shows("top-row")).toBe(true);
  // Home → a film → Settings, About: Settings' own pages, the film left on Home.
  await app.press("label:Inception >> nth=0");
  await app.press("settings-button");
  expect(app.texts()).toContain("Loading animation");
  await app.press("label:About reel");
  expect(app.texts()).toContain("Data sources");
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

test("tablet: the selected tab chosen again over a page of it goes back to its root, one or two pages deep, after other tabs too", async () => {
  const app = await tablet();
  await app.press("label:Series");
  await app.press("label:Severance >> nth=0");
  expect(app.shows("label:Back to Series")).toBe(true);
  await app.press("label:Series"); // the selected tab: its root, the show gone
  expect(app.shows("label:Back to Series")).toBe(false);
  expect(app.texts()).toContain("All series");
  await app.press("label:Home");
  await app.press("label:Inception >> nth=0");
  await app.press("label:Leonardo DiCaprio >> nth=0"); // a person, two pages over Home
  expect(app.texts()).toContain("Films and series");
  await app.press("label:Home");
  expect(app.texts()).toContain("Continue watching");
  expect(app.texts()).not.toContain("Films and series");
  expect(app.shows("label:Back to Home")).toBe(false);
});

test("tablet: a page swiped back from just before another tab is chosen stays gone on return", async () => {
  const app = await tablet();
  await app.press("label:Inception >> nth=0");
  await app.press("label:Leonardo DiCaprio >> nth=0");
  expect(app.texts()).toContain("Films and series");
  await app.back(); // the system's back (iOS's swipe): the native stack pops
  await app.press("label:Series");
  await app.press("label:Home");
  expect(app.texts()).not.toContain("Films and series");
  expect(app.shows("label:Back to Home")).toBe(true); // the film, where it was
});

test("phone: the selected tab chosen again over a page of it goes back to its root", async () => {
  const app = await phone();
  await app.press("label:Movies");
  // Shown again after another tab (its native stack made anew), then a page pushed on it.
  await app.press("label:Search");
  await app.press("label:Home");
  expect(app.texts()).toContain("All movies");
  await app.press("label:Dune >> nth=0");
  expect(app.shows("title-discs")).toBe(true);
  await app.press("label:Home"); // the Home tab, selected: its root
  expect(app.texts()).toContain("All movies");
  expect(app.shows("title-discs")).toBe(false);
});

test("tablet: Settings is a section of its own: selected while open, kept where it was left, chosen again its root", async () => {
  const app = await tablet();
  await app.press("label:Inception >> nth=0");
  await app.press("settings-button");
  expect(app.shows("settings-button-on")).toBe(true);
  expect(TABLET_TABS.some((tab) => app.shows(`top-tab-on-${tab}`))).toBe(false);
  expect(app.texts()).toContain("Playback buffer");
  expect(app.shows("label:Back to Home")).toBe(true); // its root: Back to where it was opened
  await app.press("label:About reel");
  expect(app.texts()).toContain("Data sources");
  expect(app.shows("label:Back to Settings")).toBe(true);
  // Home: the film, where it was; never About.
  await app.press("label:Home");
  expect(app.shows("top-tab-on-home")).toBe(true);
  expect(app.shows("settings-button")).toBe(true);
  expect(app.shows("label:Back to Home")).toBe(true);
  expect(app.texts()).not.toContain("Data sources");
  await app.press("settings-button"); // where Settings was left
  expect(app.texts()).toContain("Data sources");
  await app.press("settings-button-on"); // chosen again: its root
  expect(app.texts()).toContain("Playback buffer");
  expect(app.shows("label:Back to Settings")).toBe(false);
});

test("tablet: Back from Settings' and Saved's roots goes back to where they were opened from", async () => {
  const app = await tablet();
  await app.press("label:Movies");
  await app.press("label:Dune >> nth=0");
  await app.press("settings-button");
  await app.press("label:About reel");
  await app.keyboard.press("escape"); // About, then Settings' root
  expect(app.texts()).toContain("Playback buffer");
  await app.keyboard.press("escape");
  expect(app.shows("top-tab-on-movies")).toBe(true);
  expect(app.shows("label:Back to Movies")).toBe(true);
  // Movies → Saved → Settings: Back to Saved, then to Movies, never back and forth.
  await app.press("label:Saved");
  await app.press("settings-button");
  await app.keyboard.press("escape");
  expect(app.shows("settings-button")).toBe(true);
  expect(TABLET_TABS.some((tab) => app.shows(`top-tab-on-${tab}`))).toBe(false); // Saved
  await app.keyboard.press("escape");
  expect(app.shows("top-tab-on-movies")).toBe(true);
});

test("tablet: Saved's and Settings' roots show Back to where they were opened from; it and the left edge's swipe go there", async () => {
  const app = await tabletAt();
  await app.press("label:Movies");
  expect(app.shows("edge-back")).toBe(false); // a tab's root: nothing to go back to
  await app.press("label:Saved");
  expect(app.shows("label:Back to Movies")).toBe(true);
  await app.drag("edge-back", { x: 120 });
  expect(app.shows("top-tab-on-movies")).toBe(true);
  expect(app.shows("label:Back to Movies")).toBe(false);
  await app.press("settings-button");
  await app.press("label:Back to Movies");
  expect(app.shows("top-tab-on-movies")).toBe(true);
  // Opened again, it goes back once; then Back goes Home.
  await app.press("label:Saved");
  await app.press("settings-button");
  expect(app.shows("label:Back to Saved")).toBe(true);
  await app.press("label:Back to Saved");
  expect(app.shows("label:Back to Movies")).toBe(true);
});

test("tablet: the search source's drawer opens over Settings, and Back closes it before Settings", async () => {
  const app = await tablet();
  await app.press("settings-button");
  await app.press("label:Search source");
  expect(app.shows("source-close")).toBe(true);
  await app.keyboard.press("escape");
  await app.wait(600); // the drawer slides away
  expect(app.shows("source-close")).toBe(false);
  expect(app.shows("settings-button-on")).toBe(true);
  expect(app.texts()).toContain("Playback buffer");
});

test("tablet: a film whose search source did not answer opens Settings, and Back returns to the film", async () => {
  const app = await tablet({ "Catalog.title": JSON.stringify({ ...INCEPTION_NO_SOURCE, releasesState: "failed" }) });
  await app.press("label:Inception >> nth=0");
  await app.press("label:Open Settings");
  expect(app.shows("settings-button-on")).toBe(true);
  expect(app.texts()).toContain("Playback buffer");
  await app.keyboard.press("escape");
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

test("tablet in a narrow window: a phone's layout, Settings a tab of its own, and the top row again once it is wide", async () => {
  const app = await tabletAt(390, 844);
  expect(app.shows("tab-bar")).toBe(true);
  expect(app.shows("top-row")).toBe(false);
  for (const tab of ["Home", "Search", "Saved", "Settings"]) expect(app.shows(`label:${tab}`)).toBe(true);
  await app.press("label:Movies");
  expect(app.texts()).toContain("All movies");
  // Settings, a tab: no Back over it; Back goes to the category open last, as on a phone.
  await app.press("label:Settings");
  expect(app.texts()).toContain("Playback buffer");
  expect(app.shows("back-head")).toBe(false);
  await app.keyboard.press("escape");
  expect(app.texts()).toContain("All movies");
  await app.press("label:Search");
  await app.keyboard.press("escape");
  expect(app.texts()).toContain("All movies");
  // Widened on Settings: the top row, Settings selected; Back to Movies.
  await app.press("label:Settings");
  await app.setViewport(1180, 820);
  expect(app.shows("top-row")).toBe(true);
  expect(app.shows("tab-bar")).toBe(false);
  expect(app.shows("settings-button-on")).toBe(true);
  expect(app.texts()).toContain("Playback buffer");
  await app.keyboard.press("escape");
  expect(app.texts()).toContain("All movies");
  await app.setViewport(390, 844);
  expect(app.shows("tab-bar")).toBe(true);
});

test("tablet: Settings opened on a tab in a narrow window becomes its own section once the window is wide", async () => {
  const app = await tabletAt(390, 844, { "Catalog.title": JSON.stringify({ ...INCEPTION_NO_SOURCE, releasesState: "failed" }) });
  await app.press("label:Inception >> nth=0");
  await app.press("label:Open Settings"); // as on a phone: on top of the film
  expect(app.texts()).toContain("Playback buffer");
  await app.setViewport(1180, 820);
  expect(app.shows("settings-button-on")).toBe(true);
  expect(app.shows("label:Back to Inception")).toBe(false);
  await app.press("label:Home"); // Home holds the film only
  expect(app.shows("top-tab-on-home")).toBe(true);
  expect(app.texts()).not.toContain("Playback buffer");
  await app.press("settings-button");
  await app.keyboard.press("escape"); // Back: to where Settings was opened
  expect(app.shows("label:Back to Home")).toBe(true);
});

test("a narrow iPad's window and a phone show the same nav: the tabs, Home's categories, Settings and Saved as tabs, Back", async () => {
  const native = {
    ...NATIVE, "Library.supported": true, "Library.revision": 1,
    "Library.list": JSON.stringify(NOTHING_SAVED), "Library.overall": JSON.stringify(IDLE), "Library.opening": "home",
  };
  const at = (pad: boolean) =>
    openApp({
      platform: "ios", width: 390, height: 844, safeArea: { top: 24, bottom: 20, left: 0, right: 0 },
      modules: { ...(pad ? { nsh: { "platform.idiom": "pad" } } : {}), "app/native": native },
    });
  const PARTS = ["tab-bar", "nav-rail", "category-bar", "top-row", "back-head", "title-discs"];
  const LABELS = ["Home", "Search", "Saved", "Settings", "All", "Movies", "Series", "Cartoons", "Anime", "All movies", "Playback buffer", "Save a film to watch it offline"];
  const walk = async (app: Awaited<ReturnType<typeof openApp>>) => {
    const seen: string[] = [];
    const look = () => seen.push([...PARTS.filter((p) => app.shows(p)), ...LABELS.filter((l) => app.shows(`label:${l}`) || app.texts().includes(l))].join(","));
    look();
    await app.press("label:Movies");
    look();
    await app.press("label:Dune >> nth=0");
    look();
    await app.press("label:Settings");
    look();
    await app.keyboard.press("escape");
    look();
    await app.press("label:Saved");
    look();
    await app.keyboard.press("escape");
    look();
    await app.press("label:Search");
    await app.keyboard.press("escape");
    look();
    return seen;
  };
  const pad = await walk(await at(true));
  const phone = await walk(await at(false));
  expect(pad).toEqual(phone);
  expect(pad[3]).toContain("Playback buffer");
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

test("tablet: the releases' sheet open in a narrow window closes once the window widens, and Back leaves the film", async () => {
  const app = await tabletAt(390, 844);
  await app.press("label:Movies");
  await app.press("label:Dune >> nth=0");
  await app.press("label:Other releases");
  expect(app.shows("releases-close")).toBe(true);
  await app.setViewport(1180, 820);
  await app.wait(600);
  expect(app.shows("releases-close")).toBe(false);
  expect(app.shows("label:Back to Movies")).toBe(true);
  // Narrow again: it stays closed; Back is the page's.
  await app.setViewport(390, 844);
  await app.wait(600);
  expect(app.shows("releases-close")).toBe(false);
  await app.keyboard.press("escape");
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
