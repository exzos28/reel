// The search source form's state: what is typed, saving, then checking the
// saved source, and the line that says how it went.
import { effect, signal, untracked } from "nsh";
import { t } from "nsh/i18n";
import { checkSource, saveSource, source, type CheckResult } from "../../preferences";

export function sourceForm() {
  const url = signal(source().url);
  const key = signal("");
  const state = signal<"idle" | "saving" | "saved" | "checking">("idle");
  const error = signal<string | null>(null);
  const check = signal<CheckResult | null>(null);
  // A source saved elsewhere (on a phone) shows in the field.
  effect(() => {
    const saved = source().url;
    untracked(() => url.set(saved));
  });

  const save = async () => {
    state.set("saving");
    error.set(null);
    check.set(null);
    const message = await saveSource(url(), key());
    if (message != null) {
      error.set(message);
      state.set("idle");
      return;
    }
    key.set("");
    if (!source().url) {
      state.set("saved");
      return;
    }
    state.set("checking");
    check.set(await checkSource());
    state.set("saved");
  };

  /** The line beside Save; `bad` when it is an error. */
  const result = () => {
    const c = check();
    if (error()) return { text: error()!, bad: true };
    if (state() === "saving") return { text: t("settings.source.saving"), bad: false };
    if (state() === "checking") return { text: t("settings.source.checking"), bad: false };
    if (!c) return state() === "saved" && !source().url ? { text: t("settings.source.removed"), bad: false } : null;
    if (c.state === "failed") return { text: t("settings.source.failed", { message: c.message }), bad: true };
    return { text: c.movieImdb ? t("settings.source.ok_imdb") : t("settings.source.ok_text"), bad: false };
  };

  /** Saved and checked: the source answered. */
  const connected = () => state() === "saved" && !error() && check()?.state !== "failed" && check() != null;

  return { url, key, save, result, connected };
}
