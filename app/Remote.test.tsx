// The TV remote's focus (an Android TV, as `openApp` opens the app): where Up, Back and OK go,
// what the focused control shows.
import { expect, test } from "nsh/test";
import { NATIVE, openApp } from "./testEngine";

type Native = Record<string, {} | null>;
const app_ = (native: Native = NATIVE) => openApp({ modules: { "app/native": native } });

test("TV: Up from Home's hero goes to Home in the nav, wherever the nav was left", async () => {
  const app = await app_();
  await app.keyboard.press("up"); // the hero
  await app.keyboard.press("up"); // the nav, on Home
  for (let i = 0; i < 6; i++) await app.keyboard.press("right"); // Movies … Settings
  await app.keyboard.press("down"); // the hero again
  await app.keyboard.press("up"); // the nav: on Home, not on Settings
  await app.keyboard.press("enter"); // Home chosen again: Home stays
  expect(app.texts()).toContain("Continue watching");
  expect(app.texts()).not.toContain("Playback buffer");
});

test("TV: Up from Trending goes to the page's own item in the nav", async () => {
  const app = await app_();
  await app.keyboard.press("up");
  await app.keyboard.press("up");
  await app.keyboard.press("right"); // Movies
  await app.keyboard.press("enter");
  expect(app.texts()).toContain("All movies");
  await app.keyboard.press("right"); // Series, left in the nav
  await app.keyboard.press("down"); // into the page
  await app.keyboard.press("up"); // the nav: on Movies again
  await app.keyboard.press("enter");
  expect(app.texts()).toContain("All movies");
});

test("TV: the hero's way to the title's page is a button that says Details", async () => {
  const app = await app_();
  expect(app.texts()).toContain("Details");
  await app.keyboard.press("up"); // the hero, on Resume
  await app.keyboard.press("right");
  await app.keyboard.press("right"); // Details
  await app.keyboard.press("enter");
  expect(app.texts()).toContain("Director");
});

test("TV: the split Play is one focus ring; the part with the focus stays white, the other turns grey", async () => {
  const app = await app_();
  await app.keyboard.press("enter"); // Inception's page, the focus on Play
  expect(app.shows("split-play")).toBe(true);
  const more = () => app.viewStyle("split-play-more")?.backgroundColor;
  const onPlay = more();
  await app.keyboard.press("right"); // ⌄
  const onMore = more();
  expect(onMore).not.toBe(onPlay);
  await app.keyboard.press("down"); // off the split: both parts white again
  expect(more()).toBe(onMore);
});

/** A core that keeps the source it is given (`saved` gets each [address, key]) and finds it works. */
function sourceCore(url = "") {
  const saved: string[][] = [];
  const native = {
    ...NATIVE,
    ...(url ? { "Settings.load": JSON.stringify({ language: "en", bufferMB: 256, bufferChoices: [{ mb: 256, default: true }], streamDetails: false, source: { url, hasKey: false } }) } : {}),
    "Settings.setSource": (u: string, k: string) => (saved.push([u, k]), JSON.stringify({ ok: true, source: { url: u, hasKey: false } })),
    "Sources.check": 7,
    "Sources.result": JSON.stringify({ state: "done", caps: { movieImdb: false, tvImdb: false, tvSeasonEp: true } }),
  };
  return { native, saved };
}

/** Settings with the remote, the focus on its Search source row. */
async function sourceRow(native: Native) {
  const app = await openApp({ clock: {}, modules: { "app/native": native } });
  await app.keyboard.press("up"); // the hero
  await app.keyboard.press("up"); // the nav, on Home
  for (let i = 0; i < 6; i++) await app.keyboard.press("right"); // Settings
  await app.keyboard.press("enter");
  await app.keyboard.press("down"); // Language
  for (let i = 0; i < 3; i++) await app.keyboard.press("down"); // Audio language, Playback buffer, Search source
  return app;
}

test("TV: the source drawer takes the remote's focus: Down walks its fields to Save, OK saves; Back gives the focus back to the row", async () => {
  const { native, saved } = sourceCore();
  const app = await sourceRow(native);
  await app.keyboard.press("enter");
  expect(app.shows("source-panel")).toBe(true);
  await app.keyboard.press("enter"); // OK on the address: its keyboard
  for (const k of ["h", "t"]) await app.keyboard.press(k);
  expect(app.value("source-url")).toBe("ht");
  await app.keyboard.press("down"); // the key (the address lets the keyboard go)
  await app.keyboard.press("down"); // Save (Check)
  await app.keyboard.press("enter");
  expect(saved).toEqual([["ht", ""]]);
  await app.keyboard.press("escape");
  expect(app.shows("source-panel")).toBe(false);
  // Settings did not move under the drawer: OK is on Search source still.
  await app.keyboard.press("enter");
  expect(app.shows("source-panel")).toBe(true);
});

test("TV: in the source drawer Remove is right of Save; OK takes the source away", async () => {
  const { native, saved } = sourceCore("http://old.example/api");
  const app = await sourceRow(native);
  await app.keyboard.press("enter");
  expect(app.texts()).toContain("Remove source");
  await app.keyboard.press("down");
  await app.keyboard.press("down"); // Save
  await app.keyboard.press("right"); // Remove
  await app.keyboard.press("enter");
  expect(saved).toEqual([["", ""]]);
});

/** The first run's core: the setup shows; the source it is given is kept (`saved`). */
function firstRun() {
  const { native, saved } = sourceCore();
  const languages = [{ tag: "en-US", name: "English" }, { tag: "de-DE", name: "Deutsch" }];
  const chosen: string[] = [];
  return {
    saved,
    chosen,
    native: {
      ...native,
      "Settings.load": JSON.stringify({ language: "en", contentLanguage: "en-US", setupDone: false, bufferMB: 256, streamDetails: false, contentLanguages: languages, source: { url: "", hasKey: false }, bufferChoices: [{ mb: 256, default: true }] }),
      "Settings.setContentLanguage": (tag: string) => (chosen.push(tag), tag),
    },
  };
}

test("TV setup, source step: the remote starts on the address, walks to the key and Check; OK on Check checks what was typed", async () => {
  const { native, saved } = firstRun();
  const app = await openApp({ clock: {}, modules: { "app/native": native } });
  await app.waitFor("label:Next");
  await app.press("label:Next");
  await app.press("label:Next");
  expect(app.texts()).toContain("Where should reel find films?");
  await app.keyboard.press("enter"); // OK on the address: its keyboard
  for (const k of ["h", "t"]) await app.keyboard.press(k);
  expect(app.value("source-url")).toBe("ht");
  await app.keyboard.press("down"); // the key (the address lets the keyboard go)
  await app.keyboard.press("down"); // Check
  await app.keyboard.press("enter");
  expect(saved).toEqual([["ht", ""]]);
});
