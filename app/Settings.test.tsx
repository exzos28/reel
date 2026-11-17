import { expect, test } from "nsh/test";
import { ENGINE, openApp } from "./testEngine";

const SOURCE = {
  ...ENGINE,
  "Settings.setSource": JSON.stringify({ ok: true, source: { url: "http://127.0.0.1:9117/api", hasKey: true } }),
  "Sources.check": 7,
  "Sources.result": JSON.stringify({ state: "done", caps: { movieImdb: false, tvImdb: false, tvSeasonEp: true } }),
};

test("Settings: the source row opens its drawer; saving checks it and says how it searches", async () => {
  const app = await openApp({ clock: {}, modules: { "app/native": SOURCE } });
  await app.press("label:Settings");
  await app.press("label:Search source");
  expect(app.shows("source-panel")).toBe(true);
  await app.press("Save and check");
  await app.wait(400);
  expect(app.texts()).toContain("Connected. It searches by title.");
});

test("Settings: a bad address is refused with the core's message", async () => {
  const app = await openApp({
    modules: { "app/native": { ...SOURCE, "Settings.setSource": JSON.stringify({ ok: false, message: "not an address" }) } },
  });
  await app.press("label:Settings");
  await app.press("label:Search source");
  await app.press("Save and check");
  expect(app.texts()).toContain("not an address");
});

test("Settings: About reel, past the buffer sizes, shows the TMDB logo and notice and the other sources", async () => {
  const app = await openApp({ modules: { "app/native": SOURCE } });
  await app.press("label:Settings");
  for (let i = 0; i < 20; i++) await app.keyboard.press("down"); // past the languages and buffer sizes, stops on About
  await app.keyboard.press("enter");
  expect(app.texts()).toContain("Data sources");
  expect(app.shows("label:The Movie Database (TMDB)")).toBe(true);
  expect(app.texts()).toContain(
    "This application uses TMDB and the TMDB APIs but is not endorsed, certified, or otherwise approved by TMDB.",
  );
  for (const s of ["AniList", "Jikan (MyAnimeList)", "Fribb/anime-lists"]) expect(app.texts()).toContain(s);
  await app.keyboard.press("escape");
  expect(app.texts()).toContain("Playback buffer");
  await app.keyboard.press("enter"); // the focus is back on About
  expect(app.texts()).toContain("Data sources");
});

test("Settings: the language row opens the languages on the right; OK picks one, asks the core and closes", async () => {
  const chosen: string[] = [];
  const app = await openApp({
    modules: {
      "app/native": {
        ...SOURCE,
        "Settings.setContentLanguage": (tag: string) => {
          chosen.push(tag);
          return tag;
        },
      },
    },
  });
  await app.press("label:Settings");
  expect(app.texts()).toContain("Language");
  expect(app.texts()).toContain("English"); // the language in effect, on its row
  expect(app.texts()).not.toContain("Русский");
  await app.press("label:Language"); // the row
  expect(app.texts()).toContain("Русский");
  expect(app.shows("choice-panel")).toBe(true);
  await app.keyboard.press("down"); // from English to Русский
  await app.keyboard.press("enter");
  expect(chosen).toEqual(["ru-RU"]);
  expect(app.shows("choice-panel")).toBe(false);
});

test("Settings: Back closes the language panel before it leaves", async () => {
  const app = await openApp({ modules: { "app/native": SOURCE } });
  await app.press("label:Settings");
  await app.press("label:Language");
  expect(app.shows("choice-panel")).toBe(true);
  await app.keyboard.press("escape");
  expect(app.shows("choice-panel")).toBe(false);
  expect(app.texts()).toContain("Language");
});

/** The core of a first run: setup not done, nothing chosen yet. */
const firstRun = (result: object) => ({
  ...SOURCE,
  "Sources.result": JSON.stringify(result),
  "Settings.load": JSON.stringify({
    language: "en", contentLanguage: "en-US", setupDone: false, bufferMB: 256, streamDetails: false,
    contentLanguages: [{ tag: "en-US", name: "English" }], source: { url: "", hasKey: false },
    bufferChoices: [{ mb: 256, default: true }],
  }),
});

test("setup, source step: Check says why a source failed and Finish does not end the setup; once it answers, Finish does", async () => {
  let finished = 0;
  const failing = await openApp({ clock: {}, modules: { "app/native": { ...firstRun({ state: "failed", message: "can't reach it" }), "Settings.finishSetup": () => (finished++, null) } } });
  await failing.keyboard.press("down"); // past the language
  for (const _ of [0, 1]) await failing.press("label:Next");
  expect(failing.texts()).toContain("Where should reel find films?");
  await failing.press("label:Check");
  await failing.wait(400);
  expect(failing.texts().some((x) => x.includes("can't reach it"))).toBe(true);
  // Finish checks it again: it still does not answer, so the setup stays.
  await failing.press("label:Finish");
  await failing.wait(400);
  expect(finished).toBe(0);

  const working = await openApp({ clock: {}, modules: { "app/native": { ...firstRun({ state: "done", caps: { movieImdb: true } }), "Settings.finishSetup": () => (finished++, null) } } });
  for (const _ of [0, 1]) await working.press("label:Next");
  await working.press("label:Check");
  await working.wait(400);
  expect(working.texts()).toContain("Connected. It searches by IMDb id.");
  await working.press("label:Finish");
  expect(finished).toBe(1);
});

test("setup, source step: Finish on a filled-in source checks it, and ends the setup only once it answers", async () => {
  let finished = 0;
  const failing = await openApp({ clock: {}, modules: { "app/native": { ...firstRun({ state: "failed", message: "can't reach it" }), "Settings.finishSetup": () => (finished++, null) } } });
  for (const _ of [0, 1]) await failing.press("label:Next");
  await failing.type("source-url", "https://source.example/api");
  await failing.press("label:Finish");
  await failing.wait(400);
  expect(failing.texts().some((x) => x.includes("can't reach it"))).toBe(true);
  expect(finished).toBe(0);

  const working = await openApp({ clock: {}, modules: { "app/native": { ...firstRun({ state: "done", caps: { movieImdb: true } }), "Settings.finishSetup": () => (finished++, null) } } });
  for (const _ of [0, 1]) await working.press("label:Next");
  await working.type("source-url", "https://source.example/api");
  await working.press("label:Finish"); // no Check first: Finish checks it
  await working.wait(400);
  expect(finished).toBe(1);
});
