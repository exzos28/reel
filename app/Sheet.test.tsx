// A phone's drawers are bottom sheets (design/navigation.md, "Panels"): a short list is one
// detent as tall as its rows; a long one opens at medium and grows to large by a drag up or the
// grabber; a drag down, Back or ✕ closes it.
import { expect, test } from "nsh/test";
import { NATIVE, openApp } from "./testEngine";

const PHONE = { platform: "ios" as const, width: 393, height: 852, safeArea: { top: 54, bottom: 34, left: 0, right: 0 } };
/** The audio languages: a list of choices longer than the medium height. */
const MANY = ["en", "ru", "kk", "de", "fr", "es", "it", "pl", "tr", "uk", "ja", "zh", "pt", "ko"];
const settings = {
  "Settings.load": JSON.stringify({
    language: "en", bufferMB: 256, bufferChoices: [{ mb: 256, default: true }], streamDetails: false,
    audioLanguage: "", audioLanguages: MANY,
  }),
};

async function longList(reducedMotion = false) {
  const app = await openApp({ ...PHONE, reducedMotion, modules: { "app/native": { ...NATIVE, ...settings } } });
  await app.press("label:Settings");
  await app.press("label:Audio language");
  await app.wait(600);
  return app;
}

test("phone: a long list opens at medium; a drag up or the grabber takes it to large and back", async () => {
  const app = await longList();
  expect(app.shows("choice-panel")).toBe(true);
  expect(app.shows("label:Show more")).toBe(true); // the grabber, at medium
  await app.drag("text:The language films play in when they have it. Picking a track in the player changes it.", { y: -300 });
  await app.wait(600);
  expect(app.shows("label:Show less")).toBe(true); // large
  await app.press("label:Show less");
  await app.wait(600);
  expect(app.shows("label:Show more")).toBe(true);
  await app.press("label:Show more");
  await app.wait(600);
  expect(app.shows("label:Show less")).toBe(true);
  expect(app.shows("choice-panel")).toBe(true);
});

test("phone: a drag down closes a sheet; so do ✕ and Back", async () => {
  const app = await longList();
  await app.drag("id:choice-panel", { y: 500 });
  await app.wait(600);
  expect(app.shows("choice-panel")).toBe(false);
  await app.press("label:Audio language");
  await app.wait(600);
  await app.press("choice-close");
  await app.wait(600);
  expect(app.shows("choice-panel")).toBe(false);
  await app.press("label:Audio language");
  await app.wait(600);
  await app.keyboard.press("escape");
  await app.wait(600);
  expect(app.shows("choice-panel")).toBe(false);
  expect(app.texts()).toContain("Audio language"); // Settings, not left
});

test("phone: a short list is one detent: a drag up keeps it where it is, a drag down closes it", async () => {
  const app = await openApp({ ...PHONE, modules: { "app/native": NATIVE } });
  await app.press("label:Movies");
  await app.press("label:Dune >> nth=0");
  await app.press("label:Other releases");
  await app.wait(600);
  expect(app.shows("releases-panel")).toBe(true);
  expect(app.shows("releases-grabber")).toBe(true);
  expect(app.shows("label:Show more")).toBe(false); // nothing to grow to: no control for a screen reader
  await app.drag("text:3 found, the best of each quality first", { y: -200 });
  await app.wait(600);
  expect(app.shows("releases-panel")).toBe(true);
  expect(app.shows("label:Show less")).toBe(false);
  await app.drag("text:3 found, the best of each quality first", { y: 400 });
  await app.wait(600);
  expect(app.shows("releases-panel")).toBe(false);
});

test("phone: with less motion the sheet opens and closes at once", async () => {
  const app = await longList(true);
  expect(app.shows("choice-panel")).toBe(true);
  await app.press("choice-close");
  expect(app.shows("choice-panel")).toBe(false);
});
