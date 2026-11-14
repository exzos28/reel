import { expect, open, test } from "nsh/test";
import { ENGINE } from "./testEngine";

const SOURCE = {
  ...ENGINE,
  "Settings.setSource": JSON.stringify({ ok: true, source: { url: "http://127.0.0.1:9117/api", hasKey: true } }),
  "Sources.check": 7,
  "Sources.result": JSON.stringify({ state: "done", caps: { movieImdb: false, tvImdb: false, tvSeasonEp: true } }),
};

test("Settings: saving a search source checks it and says how it searches", async () => {
  const app = await open("./App.tsx", { clock: {}, modules: { "app/native": SOURCE } });
  await app.press("label:Settings");
  expect(app.texts()).toContain("Search source");
  await app.press("Save and check");
  await app.wait(400);
  expect(app.texts()).toContain("Connected. It searches by title.");
});

test("Settings: a bad address is refused with the core's message", async () => {
  const app = await open("./App.tsx", {
    modules: { "app/native": { ...SOURCE, "Settings.setSource": JSON.stringify({ ok: false, message: "not an address" }) } },
  });
  await app.press("label:Settings");
  await app.press("Save and check");
  expect(app.texts()).toContain("not an address");
});

test("Settings: About reel, past the buffer sizes, shows the TMDB logo and notice and the other sources", async () => {
  const app = await open("./App.tsx", { modules: { "app/native": SOURCE } });
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

test("Settings: choosing a language asks the core and marks it chosen", async () => {
  const app = await open("./App.tsx", {
    modules: { "app/native": { ...SOURCE, "Settings.setContentLanguage": "ru-RU" } },
  });
  await app.press("label:Settings");
  expect(app.texts()).toContain("Language");
  expect(app.texts()).toContain("Русский");
  await app.keyboard.press("down");
  await app.keyboard.press("enter");
  expect(app.shows("label:Selected")).toBe(true);
});
