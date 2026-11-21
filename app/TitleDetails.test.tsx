// A title screen below the hero: About with the crew, the cast, the details,
// More like this; the scores with their sources and the age rating; the
// remote walking through them.
import { expect, test } from "nsh/test";
import { ENGINE, NATIVE, SHOW, openApp } from "./testEngine";

type Native = Record<string, {} | null | ((...args: any[]) => unknown)>;
const app_ = (native: Native = NATIVE) => openApp({ modules: { "app/native": native } });

/** Home opens on Continue watching, Inception first. */
async function inception(native: Native = NATIVE) {
  const app = await app_(native);
  await app.keyboard.press("enter");
  expect(app.shows("label:1080p BluRay · 8 GB · 412 people sharing")).toBe(true); // the release, inside Play
  return app;
}

test("a film shows its scores, age rating, crew, cast, details and More like this", async () => {
  const app = await inception();
  const texts = app.texts();
  for (const s of ["TMDB", "8.4", "38K votes", "PG-13"]) expect(texts).toContain(s);
  for (const s of ["About", "Director", "Christopher Nolan", "Music", "Hans Zimmer"]) expect(texts).toContain(s);
  expect(texts).toContain("A thief who steals secrets through dreams is offered a way home.");
  for (const s of ["Cast", "Leonardo DiCaprio", "Cobb", "JG", "Arthur"]) expect(texts).toContain(s);
  for (const s of ["Details", "Tagline", "Your mind is the scene of the crime.", "Release date", "Jul 15, 2010"])
    expect(texts).toContain(s);
  for (const s of ["Country", "United Kingdom, United States", "Studio", "Legendary Pictures, Syncopy"])
    expect(texts).toContain(s);
  expect(texts).not.toContain("Runtime"); // the hero's line says it
  expect(texts).toContain("More like this");
  expect(texts).toContain("Dune");
  // In that order, under the hero.
  const at = (s: string) => texts.indexOf(s);
  expect(at("About")).toBeLessThan(at("Cast"));
  expect(at("Cast")).toBeLessThan(at("Details"));
  expect(at("Details")).toBeLessThan(at("More like this"));
});

test("a series keeps its episodes right under the hero and names its creator, status and every score", async () => {
  const app = await app_({ ...ENGINE, ...SHOW });
  await app.keyboard.press("right"); // Attack on Titan
  await app.keyboard.press("enter");
  const texts = app.texts();
  for (const s of ["AniList", "84%", "MAL", "8.54", "2.4M votes", "TV-MA"]) expect(texts).toContain(s);
  for (const s of ["Created by", "Hajime Isayama", "Status", "Ended", "First aired", "Apr 7, 2013", "Network and studios"])
    expect(texts).toContain(s);
  const at = (s: string) => texts.indexOf(s);
  expect(at("22 episodes · Season 3")).toBeLessThan(at("About"));
  expect(at("Old Story")).toBeLessThan(at("Cast"));
  expect(at("Cast")).toBeLessThan(at("More like this"));
  expect(texts).toContain("Frieren: Beyond Journey's End");
});

test("⌄ in Play opens the releases in a panel; OK picks one and closes it; Back closes it first", async () => {
  const chosen: number[] = [];
  const app = await inception({
    ...NATIVE,
    "Catalog.chooseRelease": (_id: string, index: number) => {
      chosen.push(index);
      return true;
    },
  });
  expect(app.texts()).not.toContain("Releases");
  await app.keyboard.press("right"); // ⌄, the other releases: the stop after Play
  await app.keyboard.press("enter");
  for (const s of ["Releases", "3 found, the best of each quality first"]) expect(app.texts()).toContain(s);
  expect(app.texts()).toContain("English, Russian MVO · H.264 · 8 GB"); // on a TV the details under the source
  for (const s of ["Starts fast", "Needs 58 Mbit/s internet"]) expect(app.texts()).not.toContain(s); // no note column
  await app.keyboard.press("escape"); // closes the panel, stays on the film
  expect(app.texts()).not.toContain("3 found, the best of each quality first");
  expect(app.texts()).toContain("More like this");
  await app.keyboard.press("enter"); // the focus is back on ⌄: opens it again, on the one Play uses (1080p)
  await app.keyboard.press("down"); // 720p
  await app.keyboard.press("enter");
  expect(chosen).toEqual([1]);
  expect(app.texts()).not.toContain("3 found, the best of each quality first");
});

const TRAILER = "https://www.youtube.com/watch?v=YoHD9XEInc0";
const withTrailer = { ...NATIVE, "Catalog.title": JSON.stringify({ ...JSON.parse(NATIVE["Catalog.title"] as string), trailer: TRAILER }) };

test("Trailer shows only when the title has one", async () => {
  expect((await inception()).texts()).not.toContain("Trailer");
  const app = await inception(withTrailer);
  await app.keyboard.press("down"); // off the row: the focused control draws last, over its neighbours
  const texts = app.texts();
  expect(texts.indexOf("Resume 41:12")).toBeLessThan(texts.indexOf("Trailer")); // in the row after Play
  // Add to list is the page's header action, not one of the hero's.
  expect(texts).toContain("Add to list");
});

test("Left and Right walk one line: Play, ⌄, Trailer; Down from any of them goes on to the cast", async () => {
  const app = await inception(withTrailer);
  await app.keyboard.press("right"); // ⌄
  await app.keyboard.press("right"); // Trailer
  await app.keyboard.press("right"); // stays on it: the row ends there
  await app.keyboard.press("enter");
  expect(app.openedUrls()).toEqual([TRAILER]);
  expect(app.texts()).not.toContain("Releases");
  await app.keyboard.press("left"); // ⌄
  await app.keyboard.press("enter");
  expect(app.texts()).toContain("3 found, the best of each quality first");
  await app.keyboard.press("escape"); // closes the panel, back on ⌄
  expect(app.texts()).not.toContain("3 found, the best of each quality first");
  await app.keyboard.press("right"); // Trailer, beside it
  await app.keyboard.press("enter");
  expect(app.openedUrls()).toEqual([TRAILER, TRAILER]);
  await app.keyboard.press("down"); // no release row under the actions any more: the cast
  await app.keyboard.press("enter"); // nothing opens on a person
  expect(app.texts()).not.toContain("3 found, the best of each quality first");
  expect(app.openedUrls()).toEqual([TRAILER, TRAILER]);
});

test("Up from the actions reaches the Watchlist in the header; OK toggles it; Down returns to the action left", async () => {
  const toggled: string[] = [];
  const app = await inception({ ...withTrailer, "Catalog.toggleList": (id: string) => void toggled.push(id) });
  await app.keyboard.press("right"); // ⌄
  await app.keyboard.press("right"); // Trailer
  await app.keyboard.press("up"); // the Watchlist
  await app.keyboard.press("left"); // stays: nothing beside it
  await app.keyboard.press("enter");
  expect(toggled.length).toBe(1);
  await app.keyboard.press("down"); // Trailer again
  await app.keyboard.press("enter");
  expect(app.openedUrls()).toEqual([TRAILER]);
});

test("a click on Trailer opens it", async () => {
  const app = await openApp({ platform: "macos", width: 1440, height: 900, modules: { "app/native": withTrailer } });
  await app.press("label:Inception >> nth=0");
  await app.press("text:Trailer");
  expect(app.openedUrls()).toEqual([TRAILER]);
});

test("the remote goes from the actions to the cast, then More like this, which opens a title; Back finds the focus", async () => {
  const chosen: number[] = [];
  const app = await inception({
    ...NATIVE,
    "Catalog.chooseRelease": (_id: string, index: number) => {
      chosen.push(index);
      return true;
    },
  });
  await app.keyboard.press("down"); // the cast
  await app.keyboard.press("right");
  await app.keyboard.press("enter"); // the person's page
  expect(app.texts()).toContain("Films and series");
  await app.keyboard.press("escape"); // back on the cast, on that person
  expect(app.texts()).toContain("More like this");
  expect(chosen).toEqual([]);
  await app.keyboard.press("down"); // More like this, on Dune
  await app.keyboard.press("enter"); // opens it (the stand-in answers every title with Inception)
  await app.keyboard.press("escape");
  expect(app.texts()).toContain("More like this"); // back on Inception, not Home
  await app.keyboard.press("up"); // the cast
  await app.keyboard.press("up"); // the actions, on Play
  expect(chosen).toEqual([]);
  await app.keyboard.press("escape");
  expect(app.texts()).toContain("Continue watching");
});

test("a film without releases goes from Play straight to the cast", async () => {
  const app = await inception({ ...NATIVE, "Catalog.title": JSON.stringify({ ...JSON.parse(NATIVE["Catalog.title"] as string), releases: [] }) });
  await app.keyboard.press("down"); // the cast
  await app.keyboard.press("down"); // More like this
  await app.keyboard.press("enter");
  await app.keyboard.press("escape");
  await app.keyboard.press("escape");
  expect(app.texts()).toContain("Continue watching");
});

test("a person without a photo shows their initials; a click on a similar title opens it", async () => {
  const app = await openApp({ platform: "macos", width: 1440, height: 900, modules: { "app/native": NATIVE } });
  await app.press("label:Inception >> nth=0");
  expect(app.texts()).toContain("JG");
  await app.press("label:Dune >> nth=0");
  await app.keyboard.press("escape");
  expect(app.texts()).toContain("More like this");
});

const titleWith = (over: object) => ({ ...NATIVE, "Catalog.title": JSON.stringify({ ...JSON.parse(NATIVE["Catalog.title"] as string), ...over }) });

test("while the release is not known, Play says it is searched under its label; Down goes on to the cast", async () => {
  const app = await app_(titleWith({ release: null, releases: [], releasesState: "searching" }));
  await app.keyboard.press("enter"); // Inception
  expect(app.shows("release-row-skeleton")).toBe(true);
  await app.keyboard.press("down"); // the cast
  await app.keyboard.press("enter"); // the person's page, not the releases
  expect(app.texts()).not.toContain("Releases");
  expect(app.texts()).toContain("Films and series");
});

test("OK on a person of the cast opens their titles; OK opens one; Back comes back to the cast", async () => {
  const app = await inception();
  await app.keyboard.press("down"); // the cast: Leonardo DiCaprio
  await app.keyboard.press("enter");
  for (const s of ["Leonardo DiCaprio", "Films and series", "Inception", "Shutter Island", "Dune"]) expect(app.texts()).toContain(s);
  expect(app.texts()).not.toContain("More like this");
  await app.keyboard.press("right"); // Shutter Island
  await app.keyboard.press("enter");
  expect(app.texts()).toContain("More like this"); // a title's page (the stand-in answers Inception's)
  expect(app.texts()).not.toContain("Films and series");
  await app.keyboard.press("escape");
  expect(app.texts()).toContain("Films and series");
  await app.keyboard.press("escape");
  expect(app.texts()).toContain("More like this");
  expect(app.texts()).not.toContain("Films and series");
});

test("a person reel has no page for is shown, not pressable", async () => {
  const app = await app_({ ...ENGINE, ...SHOW });
  await app.keyboard.press("right"); // Attack on Titan
  await app.keyboard.press("enter");
  expect(app.texts()).toContain("Yuki Kaji");
  for (const _ of ["tabs", "S3:E2", "S3:E3", "S3:E4", "the cast"]) await app.keyboard.press("down");
  await app.keyboard.press("enter"); // on Yuki Kaji: nothing opens
  expect(app.texts()).not.toContain("Films and series");
  expect(app.texts()).toContain("Yuki Kaji");
});

test("phone: a tap on a person opens their page; a tap on the description shows it whole, another folds it", async () => {
  const about = "One. Two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen.";
  const native = titleWith({ about, aboutShort: "One." });
  const app = await openApp({ platform: "ios", width: 393, height: 852, safeArea: { top: 54, bottom: 34, left: 0, right: 0 }, modules: { "app/native": native } });
  await app.press("label:Movies");
  await app.press("label:Dune >> nth=0");
  expect(app.texts()).toContain("One.");
  expect(app.texts()).not.toContain(about);
  await app.press("label:Show the whole description");
  expect(app.texts()).toContain(about);
  await app.press("label:Show less");
  expect(app.texts()).not.toContain(about);
  await app.press("label:Leonardo DiCaprio");
  expect(app.texts()).toContain("Films and series");
  expect(app.texts()).toContain("Shutter Island");
});

test("with no release at all, Play is plain and a line under it says why", async () => {
  const app = await app_(titleWith({ release: null, playable: false, releases: [], releasesState: "no_source" }));
  await app.keyboard.press("enter");
  expect(app.shows("release-row-skeleton")).toBe(false);
  expect(app.texts()).toContain("Add a search source in Settings to find releases.");
  expect(app.shows("label:Other releases")).toBe(false);
});

test("touch, with no search source: Play opens the drawer that adds one, not the player", async () => {
  const native = { ...titleWith({ release: null, playable: false, releases: [], releasesState: "no_source" }), "Catalog.onPlay": "no_source" };
  const app = await openApp({ platform: "ios", width: 393, height: 852, safeArea: { top: 54, bottom: 34, left: 0, right: 0 }, modules: { "app/native": native } });
  await app.press("label:Movies");
  await app.press("label:Dune >> nth=0");
  await app.press("label:Resume 41:12");
  expect(app.shows("source-panel")).toBe(true);
  expect(app.texts()).toContain("Add a search source");
  expect(app.shows("label:Check")).toBe(true);
});

test("with a source, Play answers at once: while it searches, the player opens and looks for the release, even when the core answers late", async () => {
  // A core that answers 3 s late: the player is on screen before it answers.
  let app: Awaited<ReturnType<typeof openApp>>;
  let upBeforeTheAnswer: boolean | null = null;
  const native = {
    ...titleWith({ release: null, playable: true, releases: [], releasesState: "searching" }),
    "Engine.open": () => new Promise((done) => setTimeout(() => ((upBeforeTheAnswer = app.shows("player-host")), done(1)), 3000)),
    "Engine.status": '{"phase":"resolving","stage":"searching"}',
  };
  app = await openApp({ platform: "ios", width: 393, height: 852, safeArea: { top: 54, bottom: 34, left: 0, right: 0 }, modules: { "app/native": native } });
  await app.press("label:Movies");
  await app.press("label:Dune >> nth=0");
  await app.press("label:Resume 41:12");
  expect(upBeforeTheAnswer).toBe(true);
  expect(app.shows("source-panel")).toBe(false);
  await app.waitFor("text:Looking for a release");
});

test("the source does not answer while the player waits for it: the drawer to fix it opens over the player, and the player goes with it", async () => {
  const native = { ...titleWith({ release: null, playable: true, releases: [], releasesState: "searching" }), "Engine.status": '{"phase":"source_failed"}' };
  const app = await openApp({ platform: "ios", width: 393, height: 852, safeArea: { top: 54, bottom: 34, left: 0, right: 0 }, modules: { "app/native": native } });
  await app.press("label:Movies");
  await app.press("label:Dune >> nth=0");
  await app.press("label:Resume 41:12");
  expect(app.shows("source-panel")).toBe(true);
  expect(app.texts()).toContain("Your search source did not answer");
  await app.keyboard.press("escape");
  await app.wait(600); // the drawer slides away
  expect(app.shows("source-panel")).toBe(false);
  expect(app.shows("player-host")).toBe(false);
  expect(app.texts()).toContain("Dune");
});

test("the source found nothing this device plays: the player says so", async () => {
  const native = { ...titleWith({ release: null, playable: true, releases: [], releasesState: "searching" }), "Engine.status": '{"phase":"not_found"}' };
  const app = await openApp({ platform: "ios", width: 393, height: 852, safeArea: { top: 54, bottom: 34, left: 0, right: 0 }, modules: { "app/native": native } });
  await app.press("label:Movies");
  await app.press("label:Dune >> nth=0");
  await app.press("label:Resume 41:12");
  expect(app.shows("source-panel")).toBe(false);
  expect(app.texts()).toContain("No release to play.");
  expect(app.texts()).toContain("Your search source found none that plays on this device.");
});

test("with a source that did not answer, Play opens the drawer to fix it", async () => {
  const native = { ...titleWith({ release: null, playable: true, releases: [], releasesState: "failed" }), "Catalog.onPlay": "failed" };
  const app = await openApp({ platform: "ios", width: 393, height: 852, safeArea: { top: 54, bottom: 34, left: 0, right: 0 }, modules: { "app/native": native } });
  await app.press("label:Movies");
  await app.press("label:Dune >> nth=0");
  await app.press("label:Resume 41:12");
  expect(app.shows("source-panel")).toBe(true);
  expect(app.texts()).toContain("Your search source did not answer");
});

test("phone: the release sits in Play as one short line (the people sharing a number); ⌄ opens the releases; the Watchlist is a heart", async () => {
  const native = titleWith({ trailer: TRAILER });
  const app = await openApp({ platform: "ios", width: 393, height: 852, safeArea: { top: 54, bottom: 34, left: 0, right: 0 }, modules: { "app/native": native } });
  await app.press("label:Movies");
  await app.press("label:Dune >> nth=0");
  expect(app.texts()).toContain("1080p BluRay · 8 GB · 412");
  expect(app.texts()).not.toContain("1080p BluRay · 8 GB · 412 people sharing");
  expect(app.shows("label:1080p BluRay · 8 GB · 412 people sharing")).toBe(true); // said whole
  expect(app.shows("label:Trailer")).toBe(true);
  await app.press("label:Other releases");
  expect(app.texts()).toContain("3 found, the best of each quality first");
  // A release row: its audio, picture, size and the people sharing (the number kept with its icon),
  // how it starts, then its own name; said whole.
  expect(app.texts()).toContain("English, Russian MVO · H.264 · 8 GB ·");
  expect(app.texts()).toContain("412");
  expect(app.texts()).toContain("Starts fast");
  expect(app.texts()).toContain("Inception.2010.1080p.BluRay.x264");
  expect(app.shows("label:1080p BluRay, English, Russian MVO, H.264, 8 GB, 412 people sharing, Starts fast")).toBe(true);
});

test("Save names the film's size; when it does not fit it asks, and saves the smaller release the core names", async () => {
  const GB = 1024 * 1024 * 1024;
  const saved: string[][] = [];
  const offer = { size: 25 * GB, free: 19 * GB, fits: false, smaller: { id: "web720", quality: "720p", source: "WEB", size: 1.4 * GB } };
  const app = await openApp({
    platform: "macos", width: 1440, height: 900,
    modules: {
      "app/native": {
        ...NATIVE,
        "Library.supported": true,
        "Library.title": '{"state":"none","progress":0}',
        "Library.item": '{"state":"none","progress":0}',
        "Library.offer": JSON.stringify(offer),
        "Library.save": (keys: string) => (saved.push(JSON.parse(keys)), true),
        "Library.saveRelease": (key: string, release: string) => (saved.push([key, release]), true),
      },
    },
  });
  await app.press("label:Inception >> nth=0");
  expect(app.shows("text:Save · 25 GB")).toBe(true);
  await app.press("text:Save · 25 GB");
  expect(app.texts()).toContain("Not enough space");
  expect(app.texts()).toContain("Needs 25 GB, 19 GB free on this device.");
  await app.press("text:Save 720p · 1.4 GB");
  expect(saved).toEqual([["tmdb:movie:27205", "web720"]]);
});

test("the Save drawer of a series shows the free space, and says so when the ticked episodes do not fit", async () => {
  const GB = 1024 * 1024 * 1024;
  const ep = (n: number) => ({ key: `tmdb:tv:1429:s3e${n}`, number: n, title: `Episode ${n}`, size: 5 * GB, state: "none", progress: 0, locked: false });
  const drawer = async (picked: { count: number; size: number; fits: boolean | null }) => {
    const plan = { episodes: [ep(1), ep(2)], saved: 0, total: 2, size: 10 * GB, free: 19 * GB, picked };
    const app = await openApp({
      platform: "macos", width: 1440, height: 900,
      modules: { "app/native": { ...ENGINE, ...SHOW, "Library.supported": true, "Library.title": '{"state":"none","saved":0,"saving":0,"progress":0}', "Library.item": '{"state":"none","progress":0}', "Library.plan": JSON.stringify(plan) } },
    });
    await app.press("label:Attack on Titan >> nth=0");
    await app.press("text:Save");
    return app;
  };
  expect((await drawer({ count: 0, size: 0, fits: true })).texts()).toContain("19 GB free");
  expect((await drawer({ count: 1, size: 5 * GB, fits: true })).texts()).toContain("5 GB · 19 GB free");
  expect((await drawer({ count: 8, size: 40 * GB, fits: false })).texts()).toContain("Not enough space: needs 40 GB, 19 GB free");
});
