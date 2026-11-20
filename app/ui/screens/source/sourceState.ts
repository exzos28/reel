// The search source form's state: what is typed, saving, then checking the
// saved source, and the line that says how it went.
import { effect, signal, untracked } from "nsh";
import { t } from "nsh/i18n";
import { checkSource, saveSource, source, type CheckResult } from "../../preferences";

/** A source a link that opened the app carried (`reel://s?…`, from a partner's bot): the next
 * form shows it in its fields, and saves it only when the viewer does. */
export const linkedSource = signal<{ url: string; key: string } | null>(null);

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
  // A linked source fills the fields (once: the form takes it).
  effect(() => {
    const l = linkedSource();
    if (!l) return;
    untracked(() => {
      url.set(l.url);
      key.set(l.key);
      linkedSource.set(null);
    });
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

  /** The fields typed in: what was checked no longer stands (Check again). */
  const edit = (u: string, k: string) => {
    url.set(u);
    key.set(k);
    if (state() === "saved" || check() || error()) {
      state.set("idle");
      check.set(null);
      error.set(null);
    }
  };

  /** Removes the source: no address, no key. */
  const remove = async () => {
    url.set("");
    key.set("");
    await save();
  };

  /** Checks the source saved (from a phone, say) without saving it again. */
  const recheck = async () => {
    error.set(null);
    check.set(null);
    if (!source().url) return state.set("idle");
    state.set("checking");
    check.set(await checkSource());
    state.set("saved");
  };

  /** The line beside Save; `bad` when it is an error, `ok` when the source answered. */
  const result = () => {
    const c = check();
    if (error()) return { text: error()!, bad: true };
    if (state() === "saving") return { text: t("settings.source.saving"), bad: false };
    if (state() === "checking") return { text: t("settings.source.checking"), bad: false };
    if (!c) return state() === "saved" && !source().url ? { text: t("settings.source.removed"), bad: false } : null;
    // Why, in a sentence the viewer can act on (the core says which); the source's own words otherwise.
    if (c.state === "failed") return { text: t(`settings.source.reason.${c.reason ?? "error"}`, { host: c.host || source().url, message: c.message }), bad: true };
    return { text: c.movieImdb ? t("settings.source.ok_imdb") : t("settings.source.ok_text"), bad: false, ok: true };
  };

  /** Saving or checking: Check waits (it reads "Checking…"). */
  const busy = () => state() === "saving" || state() === "checking";

  /** Saved and checked: the source answered. */
  const connected = () => state() === "saved" && !error() && check()?.state !== "failed" && check() != null;

  return { url, key, edit, save, remove, recheck, result, connected, busy };
}
