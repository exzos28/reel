// The UI's mirror of the user's settings. The core keeps and applies them
// (`Settings.load`, `Settings.setBufferMb`); this holds them in signals for
// the screens.
import { signal } from "nsh";
import { setLocale } from "nsh/i18n";
import process from "process";
import { Settings, Sources } from "app/native";

export interface BufferChoice {
  mb: number;
  default: boolean;
}

/** The search source as the core shows it: the address, and whether a key is set. */
export interface SourceInfo {
  url: string;
  hasKey: boolean;
}

export const bufferMB = signal(0);
export const source = signal<SourceInfo>({ url: "", hasKey: false });
export const bufferChoices = signal<BufferChoice[]>([]);

/** Loads the settings from the core and applies the language. */
export async function loadSettings() {
  const s = JSON.parse(await Settings.load(process.dataDir ?? ""));
  bufferMB.set(s.bufferMB);
  bufferChoices.set(s.bufferChoices);
  if (s.source) source.set(s.source);
  setLocale(s.language);
}

export async function chooseBuffer(mb: number) {
  bufferMB.set(await Settings.setBufferMb(mb));
}

/** Saves the search source; an empty `key` keeps none. Resolves to an error
 * message from the core (bad address), or null when saved. */
export async function saveSource(url: string, key: string): Promise<string | null> {
  const r = JSON.parse(await Settings.setSource(url, key));
  if (!r.ok) return r.message;
  source.set(r.source);
  return null;
}

export type CheckResult =
  | { state: "ok"; movieImdb: boolean; tvImdb: boolean; tvSeasonEp: boolean }
  | { state: "failed"; message: string };

/** Asks the core to check the saved source (`t=caps`) and waits for the answer. */
export async function checkSource(): Promise<CheckResult> {
  const job = await Sources.check();
  if (!job) return { state: "failed", message: "" };
  for (;;) {
    await new Promise((r) => setTimeout(r, 300));
    const r = JSON.parse(await Sources.result(job));
    if (r.state === "pending") continue;
    if (r.state === "done") return { state: "ok", ...r.caps };
    return { state: "failed", message: r.message ?? "" };
  }
}
