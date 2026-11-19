import { expect, test } from "nsh/test";
import { NATIVE, openApp } from "./testEngine";

/** The core's settings with the content language in effect, which the UI follows. */
const settings = (contentLanguage: string) => ({
  "Settings.load": JSON.stringify({ language: "en", contentLanguage, bufferMB: 256, bufferChoices: [{ mb: 256, default: true }], setupDone: true }),
});

test("Locale: the UI is in the content language, by its base when the tag has no file of its own", async () => {
  const app = await openApp({ modules: { "app/native": { ...NATIVE, ...settings("ru-RU") } } });
  await app.waitFor("label:Настройки");
  expect(app.texts()).toContain("Главная");
  expect(app.texts()).not.toContain("Home");
});

test("Locale: the content language wins over the system's", async () => {
  const app = await openApp({ locale: "ru-RU", modules: { "app/native": { ...NATIVE, ...settings("en-US") } } });
  await app.waitFor("label:Settings");
  expect(app.texts()).toContain("Home");
  expect(app.texts()).not.toContain("Главная");
});
