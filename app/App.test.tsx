import { expect, test } from "nsh/test";
import { AOT_S3, ENGINE, episode, INCEPTION_NO_SOURCE, NATIVE, release, SHOW, openApp } from "./testEngine";

type Native = Record<string, {} | null>;
const app_ = (native: Native = NATIVE, options: Record<string, unknown> = {}) =>
  openApp({ ...options, modules: { "app/native": native } });

test("home starts on Continue watching and the hero follows the focus", async () => {
  const app = await app_();
  expect(app.texts()).toContain("2 h 28 min");
  expect(app.texts()).toContain("Resume 41:12");
  expect(app.texts()).toContain("Action, Science Fiction");
  await app.keyboard.press("right");
  await app.waitFor("2013–2023"); // the hero follows once the focus rests
  expect(app.texts()).toContain("Resume S3:E2");
  await app.keyboard.press("down");
  expect(app.texts()).toContain("Trending movies");
  expect(app.texts()).toContain("2 h 35 min");
  expect(app.texts()).toContain("Play");
});

test("a title without a release says so instead of playing", async () => {
  const app = await app_({ ...NATIVE, "Engine.status": JSON.stringify({ phase: "no_source" }) });
  await app.keyboard.press("up"); // the hero's Resume
  await app.keyboard.press("enter");
  expect(app.texts()).toContain("No release to play.");
  expect(app.texts()).toContain("Add a search source in Settings, or pick another release.");
  await app.keyboard.press("escape");
  expect(app.texts()).toContain("Continue watching");
});

test("pressing Play opens the player", async () => {
  // The engine as it is while it looks for the film's metadata.
  const app = await app_({ ...NATIVE, "Engine.status": '{"phase":"resolving","stage":"finding"}' });
  await app.press("Resume 41:12");
  expect(app.texts()).toContain("Finding people sharing this film");
  expect(app.shows("label:Back")).toBe(false); // on a TV, the remote's Back key
});

test("without room for the buffer, the film does not start and says why", async () => {
  const app = await app_({
    ...NATIVE,
    "Engine.status": JSON.stringify({ phase: "no_space", needed: 306 * 1024 ** 2, free: 120 * 1024 ** 2 }),
  });
  await app.press("Resume 41:12");
  expect(app.texts()).toContain("Not enough space to play: needs 306 MB, 120 MB free.");
  expect(app.texts()).toContain("Free up space on this device or lower the buffer size in Settings.");
});

test("Settings: from the nav, choose a buffer size, back", async () => {
  const app = await app_();
  await app.keyboard.press("up"); // hero
  await app.keyboard.press("up"); // nav, on Home
  for (let i = 0; i < 5; i++) await app.keyboard.press("right"); // Movies, Shows, Anime, Search, Settings
  await app.keyboard.press("enter");
  expect(app.texts()).toContain("Playback buffer");
  expect(app.texts()).toContain("10 GB free on this device");
  await app.keyboard.press("down");
  await app.keyboard.press("enter");
  expect(app.shows("label:Selected")).toBe(true);
  await app.keyboard.press("escape"); // the focus to Settings in the nav
  expect(app.texts()).toContain("Playback buffer");
  await app.keyboard.press("escape");
  expect(app.texts()).toContain("Continue watching");
});

test("the nav opens Movies; a poster opens its film with the releases found; Back comes back", async () => {
  const app = await app_();
  await app.keyboard.press("up");
  await app.keyboard.press("up");
  await app.keyboard.press("right"); // Movies
  await app.keyboard.press("enter");
  expect(app.texts()).toContain("Discover the latest and greatest films");
  expect(app.texts()).toContain("All movies");
  await app.keyboard.press("right");
  await app.keyboard.press("enter");
  expect(app.texts()).toContain("1080p BluRay · 8 GB · 412 people sharing");
  await app.keyboard.press("down"); // the release button, under the actions
  await app.keyboard.press("enter");
  expect(app.texts()).toContain("Releases");
  expect(app.texts()).toContain("3 found, the best of each quality first");
  expect(app.texts()).toContain("Starts fast");
  expect(app.texts()).toContain("Needs 58 Mbit/s internet");
  await app.keyboard.press("escape"); // the panel
  await app.keyboard.press("escape");
  expect(app.texts()).toContain("All movies");
  await app.keyboard.press("down"); // the filter pills
  await app.keyboard.press("down"); // the grid
  await app.keyboard.press("enter");
  expect(app.texts()).toContain("2 h 28 min");
  await app.keyboard.press("escape"); // Movies, on the card
  await app.keyboard.press("escape"); // the top, the focus on Movies in the nav
  expect(app.texts()).toContain("All movies");
  await app.keyboard.press("escape");
  expect(app.texts()).toContain("Continue watching");
});

test("without a search source the film screen says where to add one", async () => {
  const app = await app_({ ...NATIVE, "Catalog.title": JSON.stringify(INCEPTION_NO_SOURCE) });
  await app.keyboard.press("enter"); // Inception
  expect(app.texts()).toContain("Add a search source in Settings to find releases.");
});

test("without a TMDB key home shows anime and says what is missing", async () => {
  const notice = {
    id: "reel:notice:no_tmdb", kind: "movie", title: "", about: "", notice: "no_tmdb", anime: false, year: null,
    yearEnd: null, minutes: 0, rating: "", votes: "", badges: [], genres: [], still: null, card: null, poster: null,
    ink: "#F5F5F5", paper: "#1A1A1A", stoppedAt: null, progress: 0, left: null, resume: null, seasons: 0, airs: null,
    tag: null, playable: false, inList: false, release: null, play: { id: "reel:notice:no_tmdb", start: 0 },
  };
  const app = await app_({ ...NATIVE, "Catalog.home": JSON.stringify([{ id: "no_tmdb", items: [notice] }]) });
  expect(app.texts()).toContain("Movies and shows need a TMDB key");
  expect(app.texts()).toContain("Movies and shows");
});

async function series(native: Native = { ...ENGINE, ...SHOW }) {
  const app = await app_(native);
  await app.keyboard.press("up");
  await app.keyboard.press("up");
  await app.keyboard.press("right");
  await app.keyboard.press("right"); // Shows
  await app.keyboard.press("enter");
  expect(app.texts()).toContain("Current & upcoming");
  await app.keyboard.press("enter"); // the first in the row
  return app;
}

test("a series opens on the season the viewer is in", async () => {
  const app = await series();
  expect(app.texts()).toContain("Resume S3:E2");
  expect(app.texts()).toContain("22 episodes · Season 3");
  expect(app.texts()).toContain("Pain");
  expect(app.texts()).toContain("Old Story");
  expect(app.texts()).toContain("24 min · Jul 30, 2018 · 14 min left");
  expect(app.texts()).toContain("Watched");
});

test("left and right on the season tabs switch the season; down lands on its first episode", async () => {
  const app = await series({
    ...NATIVE, ...SHOW, "Engine.status": '{"phase":"resolving"}', "Catalog.episode": JSON.stringify(AOT_S3[0]),
  });
  await app.keyboard.press("down"); // tabs, Season 3
  await app.keyboard.press("left"); // Season 2
  expect(app.texts()).toContain("12 episodes · Season 2");
  await app.keyboard.press("down");
  await app.keyboard.press("enter");
  expect(app.texts()).toContain("S3:E1 · Smoke Signal");
});

test("in the season the viewer is in, the focus lands on their episode", async () => {
  const app = await series({
    ...NATIVE, ...SHOW, "Engine.status": '{"phase":"resolving"}', "Catalog.episode": JSON.stringify(AOT_S3[0]),
  });
  await app.keyboard.press("down"); // tabs
  await app.keyboard.press("down"); // S3:E2
  await app.keyboard.press("up"); // S3:E1
  await app.keyboard.press("enter");
  expect(app.texts()).toContain("S3:E1 · Smoke Signal");
  await app.keyboard.press("escape");
  expect(app.texts()).toContain("22 episodes · Season 3");
});

test("a season not known yet lists no episodes", async () => {
  const app = await series({ ...ENGINE, ...SHOW, "Catalog.episodes": "[]" });
  expect(app.texts()).toContain("The episodes of this show are not listed yet.");
});

test("in a Mac window the screens lay out with all their columns", async () => {
  const app = await app_(NATIVE, { platform: "macos", width: 1440, height: 900 });
  expect(app.texts()).toContain("Home"); // nav labels show beside the icons
  await app.press("label:Movies");
  expect(app.texts()).toContain("All movies");
  await app.press("label:Dune >> nth=0");
  expect(app.texts()).toContain("1080p BluRay · 8 GB · 412 people sharing");
  await app.keyboard.press("down"); // the release button
  await app.keyboard.press("enter"); // the releases panel, with all its columns
  expect(app.texts()).toContain("60 GB");
  await app.keyboard.press("escape");
  await app.keyboard.press("escape");
  await app.press("label:Shows");
  expect(app.texts()).toContain("All shows");
});


test("Home, Movies, Shows and Anime have the same nav in the window bar, whose pills keep their size", async () => {
  const app = await app_(NATIVE, { platform: "macos", width: 1440, height: 900 });
  const pills = ["Home", "Movies", "Shows", "Anime"];
  /** What decides a pill's width: its label's size and weight (selected changes only the colour). */
  const sizes = () => pills.map((p) => {
    const s = app.spanStyle(`label:${p} >> text:${p}`);
    return [s.fontSize, s.fontWeight];
  });
  const onHome = sizes();
  expect(new Set(onHome.map((s) => s.join())).size).toBe(1);
  for (const page of ["Movies", "Shows", "Anime", "Home"]) {
    await app.press(`label:${page}`);
    expect(app.count("label:Home")).toBe(1);
    expect(app.count("label:Settings")).toBe(1);
    expect(sizes()).toEqual(onHome);
  }
});

test("Mac: Back in the window bar is disabled on a root, goes back from a title; ⌘[ and Esc go back, never past a root", async () => {
  const app = await app_(NATIVE, { platform: "macos", width: 1440, height: 900 });
  await expect(app.press("label:Back")).rejects.toMatchObject({ code: "ERR_NSH_TEST_DISABLED" });
  await app.press("label:Movies");
  await app.press("label:Dune >> nth=0");
  expect(app.texts()).toContain("1080p BluRay · 8 GB · 412 people sharing");
  expect(app.shows("label:Add to list")).toBe(true); // the page's action, in the bar
  await app.press("label:Back to Movies");
  expect(app.texts()).toContain("All movies");
  await app.press("label:Dune >> nth=0");
  await app.keyboard.press("mod+[");
  expect(app.texts()).toContain("All movies");
  await app.press("label:Dune >> nth=0");
  await app.keyboard.press("escape");
  await app.keyboard.press("escape"); // on a root: stays
  expect(app.texts()).toContain("All movies");
  await app.keyboard.press("mod+1");
  expect(app.texts()).toContain("Continue watching");
});

test("the nav opens Anime after Shows: its trending row and all anime", async () => {
  const app = await app_();
  await app.keyboard.press("up");
  await app.keyboard.press("up");
  for (let i = 0; i < 3; i++) await app.keyboard.press("right"); // Movies, Shows, Anime
  await app.keyboard.press("enter");
  expect(app.texts()).toContain("Seasonal hits and all-time favourites");
  expect(app.texts()).toContain("Trending this season");
  expect(app.texts()).toContain("All anime");
  await app.keyboard.press("enter"); // the first in the row
  expect(app.texts()).toContain("Add to list");
  await app.keyboard.press("escape");
  expect(app.texts()).toContain("All anime");
  await app.keyboard.press("escape"); // the nav
  await app.keyboard.press("escape");
  expect(app.texts()).toContain("Continue watching");
});

test("in a Mac window the Anime pill opens the Anime page", async () => {
  const app = await app_(NATIVE, { platform: "macos", width: 1440, height: 900 });
  await app.press("label:Anime");
  expect(app.texts()).toContain("All anime");
});

test("an episode not in its season's release opens the releases of that episode; picking one plays it", async () => {
  const chosen: [string, number][] = [];
  const missing = AOT_S3.map((e) => (e.number === 3 ? episode(3, "Old Story", { inRelease: "no" }) : e));
  const app = await series({
    ...NATIVE, ...SHOW, "Engine.status": '{"phase":"resolving"}',
    "Catalog.episodes": JSON.stringify(missing),
    "Catalog.episode": JSON.stringify(missing[2]),
    "Catalog.episodeReleases": JSON.stringify({
      releases: [release(4, "720p", "WEB", "AoT.S03E03.720p", "400 MB", 40, 3, "starts_fast", 2)],
      releasesState: "done",
      seasonRelease: { quality: "1080p", source: "WEB", pack: true, size: "22 GB", peers: 90, fast: false },
    }),
    "Catalog.chooseRelease": (id: string, index: number) => {
      chosen.push([id, index]);
      return true;
    },
  });
  expect(app.texts()).toContain("Not in this release");
  await app.keyboard.press("down"); // tabs
  await app.keyboard.press("down"); // S3:E2, where the viewer is
  await app.keyboard.press("down"); // S3:E3, not in the season's release
  await app.keyboard.press("enter");
  expect(app.texts()).toContain("S3:E3 is not in 1080p WEB. Pick a release for this episode.");
  expect(app.texts()).toContain("Releases of S3:E3");
  await app.keyboard.press("enter"); // its only release
  expect(chosen).toEqual([["tmdb:tv:1429:s3e3", 4]]);
  expect(app.texts()).toContain("S3:E3 · Old Story");
});

test("TV: Back on Home takes the focus to the nav, then asks to exit; Stay and Back close the question", async () => {
  const app = await app_();
  await app.keyboard.press("down"); // a shelf
  await app.keyboard.press("escape"); // the top, the focus on Home in the nav
  expect(app.shows("exit-dialog")).toBe(false);
  await app.keyboard.press("escape");
  expect(app.shows("exit-dialog")).toBe(true);
  expect(app.texts()).toContain("Exit reel?");
  expect(app.texts()).toContain("Anything playing stops. What you watched is kept.");
  await app.keyboard.press("escape"); // closes it
  expect(app.shows("exit-dialog")).toBe(false);
  await app.keyboard.press("escape");
  expect(app.shows("exit-dialog")).toBe(true);
  await app.keyboard.press("left"); // Stay is focused already
  await app.keyboard.press("enter");
  expect(app.shows("exit-dialog")).toBe(false);
  expect(app.texts()).toContain("Continue watching");
});

test("TV: OK on the current destination in the nav keeps the page, at its root", async () => {
  const app = await app_();
  await app.keyboard.press("up");
  await app.keyboard.press("up");
  await app.keyboard.press("right"); // Movies
  await app.keyboard.press("enter");
  await app.keyboard.press("escape"); // the focus to Movies in the nav
  await app.keyboard.press("enter"); // Movies again
  expect(app.texts()).toContain("All movies");
  await app.keyboard.press("escape"); // on the nav: Home
  expect(app.texts()).toContain("Continue watching");
});
