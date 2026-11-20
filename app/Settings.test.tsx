import { expect, test } from "nsh/test";
import { ENGINE, NATIVE, openApp } from "./testEngine";

/** The core's settings with the menu and the loader where a test puts them. */
const appearance = (navPosition: string, loader = "logo") => ({
  "Settings.load": JSON.stringify({
    language: "en", bufferMB: 256, bufferChoices: [{ mb: 256, default: true }], streamDetails: false, navPosition, loader,
  }),
});

test("Settings: Interface, reached with the remote, holds Menu position; Center moves the nav to the middle; Back returns to Settings on its row", async () => {
  const chosen: string[] = [];
  const app = await openApp({
    modules: { "app/native": { ...NATIVE, "Settings.setNavPosition": (p: string) => (chosen.push(p), p) } },
  });
  await app.press("label:Settings");
  expect(app.shows("nav-right")).toBe(true); // the default
  expect(app.texts()).not.toContain("Menu position"); // in Interface now
  for (let i = 0; i < 5; i++) await app.keyboard.press("down"); // language, audio language, buffer, source, stream details
  await app.keyboard.press("enter"); // Interface
  expect(app.texts()).toContain("Menu position");
  expect(app.texts()).toContain("Loading animation");
  await app.keyboard.press("enter"); // Menu position, the first row
  expect(app.shows("choice-panel")).toBe(true);
  expect(app.texts()).toContain("Where the menu sits in the bar at the top of the screen.");
  for (const c of ["Left", "Center", "Right"]) expect(app.texts()).toContain(c);
  await app.keyboard.press("up"); // from Right, the one in effect, to Center
  await app.keyboard.press("enter");
  expect(chosen).toEqual(["center"]);
  expect(app.shows("choice-panel")).toBe(false);
  expect(app.texts()).toContain("Center"); // the row's value
  await app.keyboard.press("escape"); // back to Settings, under the nav in its new place
  expect(app.texts()).toContain("Stream details");
  expect(app.shows("nav-center")).toBe(true);
  expect(app.shows("nav-right")).toBe(false);
  await app.keyboard.press("enter"); // the focus is on Interface again
  expect(app.texts()).toContain("Menu position");
});

test("Settings: on a desktop the window bar's nav sits where the settings say", async () => {
  const app = await openApp({ platform: "macos", width: 1440, height: 900, modules: { "app/native": { ...NATIVE, ...appearance("left") } } });
  await app.waitFor("window-nav-left");
  expect(app.shows("window-nav-right")).toBe(false);
});

test("Settings: a phone's Interface has no Menu position (its tab bar stays), but has Loading animation", async () => {
  const app = await openApp({ platform: "ios", width: 393, height: 852, safeArea: { top: 54, bottom: 34, left: 0, right: 0 }, modules: { "app/native": NATIVE } });
  await app.press("label:Settings");
  await app.press("label:Interface");
  expect(app.texts()).toContain("Loading animation");
  expect(app.texts()).not.toContain("Menu position");
});

test("Settings: Loading animation offers reel (the default) and the dinosaur; picking the dinosaur asks the core", async () => {
  const chosen: string[] = [];
  const app = await openApp({
    modules: { "app/native": { ...NATIVE, "Settings.setLoader": (l: string) => (chosen.push(l), l) } },
  });
  await app.press("label:Settings");
  await app.press("label:Interface");
  await app.press("label:Loading animation");
  expect(app.shows("choice-panel")).toBe(true);
  expect(app.texts()).toContain("Dinosaur");
  await app.keyboard.press("down"); // from reel to Dinosaur
  await app.keyboard.press("enter");
  expect(chosen).toEqual(["dinosaur"]);
  expect(app.texts()).toContain("Dinosaur"); // the row's value
});

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
  await app.press("Check");
  await app.wait(400);
  expect(app.texts()).toContain("Connected. It searches by title.");
});

test("Settings: a bad address is refused with the core's message", async () => {
  const app = await openApp({
    modules: { "app/native": { ...SOURCE, "Settings.setSource": JSON.stringify({ ok: false, message: "not an address" }) } },
  });
  await app.press("label:Settings");
  await app.press("label:Search source");
  await app.press("Check");
  await app.waitFor("text:not an address"); // the core's answer comes a moment after the press
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

test("Settings: Audio language says the app's until one is picked; OK on a language asks the core", async () => {
  const chosen: string[] = [];
  const app = await openApp({
    modules: {
      "app/native": {
        ...SOURCE,
        "Settings.load": JSON.stringify({
          language: "en", bufferMB: 256, bufferChoices: [{ mb: 256, default: true }], streamDetails: false,
          audioLanguage: "", audioLanguages: ["en", "ru", "kk"],
        }),
        "Settings.setAudioLanguage": (code: string) => (chosen.push(code), code),
      },
    },
  });
  await app.press("label:Settings");
  expect(app.texts()).toContain("Audio language");
  expect(app.texts()).toContain("Same as app language"); // the value on its row
  await app.press("label:Audio language");
  expect(app.shows("choice-panel")).toBe(true);
  for (const l of ["English", "Russian", "Kazakh"]) expect(app.texts()).toContain(l);
  await app.keyboard.press("down"); // from the app's language to English
  await app.keyboard.press("down"); // to Russian
  await app.keyboard.press("enter");
  expect(chosen).toEqual(["ru"]);
  expect(app.shows("choice-panel")).toBe(false);
  expect(app.texts()).toContain("Russian"); // the row's value now
  // Back to the app's language: the first choice.
  await app.press("label:Audio language");
  await app.keyboard.press("up");
  await app.keyboard.press("up");
  await app.keyboard.press("enter");
  expect(chosen).toEqual(["ru", ""]);
  expect(app.texts()).toContain("Same as app language");
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

test("setup, source step: one button, Check (Checking… and disabled while it checks) until the source answers, then Finish alone; an edit makes it Check again", async () => {
  let finished = 0;
  const failing = await openApp({ clock: {}, modules: { "app/native": { ...firstRun({ state: "failed", message: "can't reach it" }), "Settings.finishSetup": () => (finished++, null) } } });
  for (const _ of [0, 1]) await failing.press("label:Next");
  expect(failing.texts()).toContain("Where should reel find films?");
  await failing.type("source-url", "https://source.example/api");
  await failing.press("label:Check");
  await failing.wait(400);
  expect(failing.texts().some((x) => x.includes("can't reach it"))).toBe(true);
  expect(failing.texts()).not.toContain("Finish"); // it did not answer: still Check
  expect(finished).toBe(0);

  const working = await openApp({ clock: {}, modules: { "app/native": { ...firstRun({ state: "done", caps: { movieImdb: true } }), "Settings.finishSetup": () => (finished++, null) } } });
  for (const _ of [0, 1]) await working.press("label:Next");
  await working.type("source-url", "https://source.example/api");
  expect(working.shows("source-result")).toBe(true); // its room is there before it says anything
  await working.press("label:Check");
  expect(working.texts()).toContain("Checking…");
  expect(working.enabled("label:Checking…")).toBe(false);
  await working.wait(400);
  expect(working.texts()).toContain("Connected. It searches by IMDb id.");
  expect(working.texts()).toContain("Finish");
  expect(working.texts()).not.toContain("Skip"); // one thing left to press
  await working.type("source-url", "/other"); // an edit: Check again
  expect(working.texts()).toContain("Check");
  await working.press("label:Check");
  await working.wait(400);
  await working.press("label:Finish");
  expect(finished).toBe(1);
});

test("setup, language step: More languages opens the ones the step does not show, and the remote moves in the drawer and picks", async () => {
  const chosen: string[] = [];
  const tags = ["en-US", "ru-RU", "de-DE", "fr-FR", "es-ES", "it-IT", "ja-JP", "pt-BR"];
  const names = ["English", "Русский", "Deutsch", "Français", "Español", "Italiano", "日本語", "Português"];
  const app = await openApp({
    modules: {
      "app/native": {
        ...firstRun({ state: "done" }),
        "Settings.load": JSON.stringify({
          language: "en", contentLanguage: "en-US", setupDone: false, bufferMB: 256, streamDetails: false,
          contentLanguages: tags.map((tag, i) => ({ tag, name: names[i] })), source: { url: "", hasKey: false },
          bufferChoices: [{ mb: 256, default: true }],
        }),
        "Settings.setContentLanguage": (tag: string) => (chosen.push(tag), tag),
      },
    },
  });
  await app.waitFor("label:More languages  ›");
  await app.press("label:More languages  ›");
  expect(app.shows("choice-panel")).toBe(true);
  // The five shown on the step are not repeated: Italiano, 日本語, Português.
  expect(app.texts().filter((x) => x === "English")).toHaveLength(1);
  expect(app.texts()).toContain("Italiano");
  for (let i = 0; i < 4; i++) await app.keyboard.press("down"); // to the last (and past it: it stays)
  await app.keyboard.press("enter");
  expect(chosen).toEqual(["pt-BR"]);
  expect(app.shows("choice-panel")).toBe(false);
});
