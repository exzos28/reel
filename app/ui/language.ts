// App language: English by default whatever the system language; a chosen
// language is kept across launches. Add a language = add locales/<tag>.yml.
import { Storage } from "nsh";
import { availableLocales, setLocale } from "nsh/i18n";

const KEY = "language";
export const DEFAULT_LANGUAGE = "en";

export function chooseLanguage(tag: string) {
  setLocale(tag);
  Storage.setItem(KEY, tag).catch((e) => console.warn("could not save the language", e));
}

/** Restores the saved language, else English. */
export async function restoreLanguage() {
  setLocale(DEFAULT_LANGUAGE);
  const saved = await Storage.getItem(KEY).catch(() => null);
  if (saved && availableLocales().includes(saved)) setLocale(saved);
}
