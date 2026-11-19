import { expect, test } from "nsh/test";
import { NATIVE, openApp } from "./testEngine";

/** The core's settings with the UI language picked (null: the system's). */
const settings = (language: string | null) => ({
  "Settings.load": JSON.stringify({ language, bufferMB: 256, bufferChoices: [{ mb: 256, default: true }], setupDone: true }),
});

test("Locale: on a Russian system the app is in Russian until a language is picked", async () => {
  const app = await openApp({ locale: "ru-RU", modules: { "app/native": { ...NATIVE, ...settings(null) } } });
  await app.waitFor("label:Настройки");
  expect(app.texts()).toContain("Главная");
  expect(app.texts()).not.toContain("Home");
});

test("Locale: a picked language wins over the system's", async () => {
  const app = await openApp({ locale: "ru-RU", modules: { "app/native": { ...NATIVE, ...settings("en") } } });
  await app.waitFor("label:Settings");
  expect(app.texts()).toContain("Home");
  expect(app.texts()).not.toContain("Главная");
});
