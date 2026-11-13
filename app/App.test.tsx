import { expect, open, test } from "nsh/test";
import { ENGINE } from "./testEngine";

test("home starts on Continue watching and the hero follows the focus", async () => {
  const app = await open("./App.tsx");
  expect(app.texts()).toContain("1 h 53 min");
  expect(app.texts()).toContain("Resume 41:12");
  await app.keyboard.press("right");
  expect(app.texts()).toContain("1936–1940");
  expect(app.texts()).toContain("Resume S3:E4");
  await app.keyboard.press("down");
  expect(app.texts()).toContain("15 min");
  expect(app.texts()).toContain("Play");
});

test("a title without a source says so instead of playing", async () => {
  const app = await open("./App.tsx", {
    modules: { "app/native": { ...ENGINE, "Engine.status": JSON.stringify({ phase: "no_source" }) } },
  });
  await app.keyboard.press("up"); // the hero's Resume
  await app.keyboard.press("enter");
  expect(app.texts()).toContain("No source for this yet. Try one from Free to watch.");
  await app.keyboard.press("escape");
  expect(app.texts()).toContain("Continue watching");
});

test("pressing Play opens the player", async () => {
  // The engine as it is while it looks for the film's metadata.
  const app = await open("./App.tsx", {
    modules: { "app/native": { ...ENGINE, "Engine.status": '{"phase":"resolving"}' } },
  });
  await app.press("Resume 41:12");
  expect(app.shows("label:Back")).toBe(true);
  expect(app.texts()).toContain("Finding peers…");
});

test("without room for the buffer, the film does not start and says why", async () => {
  const app = await open("./App.tsx", {
    modules: {
      "app/native": {
        ...ENGINE,
        "Engine.status": JSON.stringify({ phase: "no_space", needed: 306 * 1024 ** 2, free: 120 * 1024 ** 2 }),
      },
    },
  });
  await app.press("Resume 41:12");
  expect(app.texts()).toContain(
    "Not enough space to play: needs 306 MB, 120 MB free. Free up space on this device or lower the buffer size in Settings.",
  );
});

test("Settings: from the nav, choose a buffer size, back", async () => {
  const app = await open("./App.tsx", { modules: { "app/native": ENGINE } });
  await app.keyboard.press("up"); // hero
  await app.keyboard.press("up"); // nav, on Home
  for (let i = 0; i < 4; i++) await app.keyboard.press("right"); // Movies, Shows, Search, Settings
  await app.keyboard.press("enter");
  expect(app.texts()).toContain("Playback buffer");
  expect(app.texts()).toContain("10 GB free on this device");
  await app.keyboard.press("down");
  await app.keyboard.press("enter");
  expect(app.shows("label:Selected")).toBe(true);
  await app.keyboard.press("escape");
  expect(app.texts()).toContain("Continue watching");
});

test("the nav opens Movies; a poster opens its film; Back comes back", async () => {
  const app = await open("./App.tsx");
  await app.keyboard.press("up");
  await app.keyboard.press("up");
  await app.keyboard.press("right"); // Movies
  await app.keyboard.press("enter");
  expect(app.texts()).toContain("Discover the latest and greatest films");
  expect(app.texts()).toContain("All movies");
  await app.keyboard.press("right"); // Nosferatu in Trending
  await app.keyboard.press("enter");
  expect(app.texts()).toContain("Releases");
  expect(app.texts()).toContain("5 found, fastest to start first");
  expect(app.texts()).toContain("Starts fastest");
  expect(app.texts()).toContain("Needs 25 Mbit/s");
  await app.keyboard.press("escape");
  expect(app.texts()).toContain("All movies");
  await app.keyboard.press("down"); // the grid: Detour
  await app.keyboard.press("enter");
  expect(app.texts()).toContain("1 h 8 min");
  await app.keyboard.press("escape");
  await app.keyboard.press("escape");
  expect(app.texts()).toContain("Continue watching");
});

test("a release chosen on the film screen is the one Play uses", async () => {
  const app = await open("./App.tsx");
  await app.keyboard.press("enter"); // Charade
  expect(app.texts()).toContain("1080p BluRay · 2.1 GB · 412 people sharing");
  await app.keyboard.press("down"); // releases, fastest first: 720p WEB
  await app.keyboard.press("enter");
  expect(app.texts()).toContain("720p WEB · 920 MB · 655 people sharing");
  expect(app.texts()).toContain("WEB");
});

async function flashGordon(options = {}) {
  const app = await open("./App.tsx", options);
  await app.keyboard.press("up");
  await app.keyboard.press("up");
  await app.keyboard.press("right");
  await app.keyboard.press("right"); // Shows
  await app.keyboard.press("enter");
  expect(app.texts()).toContain("Current & upcoming");
  await app.keyboard.press("enter"); // Flash Gordon, first in the row
  return app;
}

test("a series opens on the season the viewer is in", async () => {
  const app = await flashGordon();
  expect(app.texts()).toContain("Resume S3:E4");
  expect(app.texts()).toContain("12 episodes · Flash Gordon Conquers the Universe");
  expect(app.texts()).toContain("The Destroying Ray");
  expect(app.texts()).toContain("19 min · Apr 24, 1940 · 7 min left");
  expect(app.texts()).toContain("Watched");
});

test("left and right on the season tabs switch the season; down lands on its first episode", async () => {
  const app = await flashGordon({
    modules: { "app/native": { ...ENGINE, "Engine.status": '{"phase":"resolving"}' } },
  });
  await app.keyboard.press("down"); // tabs, Season 3
  await app.keyboard.press("left"); // Season 2
  expect(app.texts()).toContain("15 episodes · Flash Gordon's Trip to Mars");
  expect(app.texts()).toContain("New Worlds to Conquer");
  await app.keyboard.press("down");
  await app.keyboard.press("enter");
  expect(app.texts()).toContain("S2:E1 · New Worlds to Conquer");
});

test("in the season the viewer is in, the focus lands on their episode", async () => {
  const app = await flashGordon({
    modules: { "app/native": { ...ENGINE, "Engine.status": '{"phase":"resolving"}' } },
  });
  await app.keyboard.press("down"); // tabs
  await app.keyboard.press("down"); // S3:E4
  await app.keyboard.press("up"); // S3:E3
  await app.keyboard.press("enter");
  expect(app.texts()).toContain("S3:E3 · Walking Bombs");
  await app.keyboard.press("escape");
  expect(app.texts()).toContain("12 episodes · Flash Gordon Conquers the Universe");
});

test("a show without listed episodes says so", async () => {
  const app = await flashGordon();
  await app.keyboard.press("escape");
  await app.keyboard.press("right"); // Les Vampires
  await app.keyboard.press("enter");
  expect(app.texts()).toContain("The episodes of this show are not listed yet.");
});

test("in a Mac window the screens lay out with all their columns", async () => {
  const app = await open("./App.tsx", { platform: "macos", width: 1440, height: 900 });
  expect(app.texts()).toContain("Home"); // nav labels show beside the icons
  await app.press("label:Movies");
  expect(app.texts()).toContain("All movies");
  await app.press("label:Nosferatu >> nth=0");
  expect(app.texts()).toContain("Piano score, EN subs");
  expect(app.texts()).toContain("1.9 GB");
  await app.keyboard.press("escape");
  await app.press("label:Shows");
  await app.press("label:Bonanza >> nth=0");
  expect(app.texts()).toContain("14 Seasons");
  expect(app.texts()).toContain("The episodes of this show are not listed yet.");
});
