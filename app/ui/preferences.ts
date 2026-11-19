// The UI's mirror of the user's settings. The core keeps and applies them
// (`Settings.load`, `Settings.setBufferMb`); this holds them in signals for
// the screens.
import { signal } from "nsh";
import { setLocale } from "nsh/i18n";
import { dataDir, Settings, Sources } from "./native";

export interface BufferChoice {
  mb: number;
  default: boolean;
}

/** The search source as the core shows it: the address, and whether a key is set. */
export interface SourceInfo {
  url: string;
  hasKey: boolean;
}

/** A language titles and descriptions can be shown in: its tag and its own name. */
export interface ContentLanguage {
  tag: string;
  name: string;
}

/** Where the top nav's group sits in its bar (a TV's, a desktop's): after the logo, in the
 * middle, at the right edge. */
export type NavPosition = "left" | "center" | "right";
export const NAV_POSITIONS: NavPosition[] = ["left", "center", "right"];
/** What shows while something loads: the running dinosaur or the blinking logotype. */
export type Loader = "dinosaur" | "logo";
export const LOADERS: Loader[] = ["logo", "dinosaur"];

/** The settings as the core answers them (`Settings.load`, `Settings.current`). */
export interface SettingsJson {
  language: string;
  bufferMB: number;
  bufferChoices: BufferChoice[];
  streamDetails?: boolean;
  navPosition?: NavPosition;
  loader?: Loader;
  contentLanguage?: string;
  contentLanguages?: ContentLanguage[];
  source?: SourceInfo;
  /** The first-run setup was gone through (the core says when). */
  setupDone?: boolean;
}

export const contentLanguage = signal("en-US");
export const contentLanguages = signal<ContentLanguage[]>([]);

export const bufferMB = signal(0);
/** The player shows the stream's speed, people and what is ready ahead. */
export const streamDetails = signal(false);
export const navPosition = signal<NavPosition>("right");
export const loader = signal<Loader>("logo");
export const source = signal<SourceInfo>({ url: "", hasKey: false });
export const bufferChoices = signal<BufferChoice[]>([]);
/** Whether the first-run setup was gone through; null until the settings are loaded. */
export const setupDone = signal<boolean | null>(null);

/** The first-run setup is done: the app opens as usual from now on. */
export async function finishSetup() {
  setupDone.set(true);
  await Settings.finishSetup();
}

/** Loads the settings from the core and applies the language. */
export async function loadSettings() {
  applySettings(JSON.parse(await Settings.load(dataDir())));
}

/** Shows the settings as the core answers them (`Settings.load` or `Settings.current`,
 * e.g. after a change made on a phone). */
export function applySettings(s: SettingsJson) {
  bufferMB.set(s.bufferMB);
  bufferChoices.set(s.bufferChoices);
  streamDetails.set(!!s.streamDetails);
  if (s.navPosition) navPosition.set(s.navPosition);
  if (s.loader) loader.set(s.loader);
  if (s.contentLanguage) contentLanguage.set(s.contentLanguage);
  if (s.contentLanguages) contentLanguages.set(s.contentLanguages);
  if (s.source) source.set(s.source);
  if (s.setupDone !== undefined) setupDone.set(s.setupDone);
  setLocale(s.language);
}

export async function toggleStreamDetails() {
  streamDetails.set(await Settings.setStreamDetails(!streamDetails()));
}

/** Moves the top nav; the core keeps it and answers with the position in effect. */
export async function chooseNavPosition(p: NavPosition) {
  navPosition.set((await Settings.setNavPosition(p)) as NavPosition);
}

export async function chooseLoader(l: Loader) {
  loader.set((await Settings.setLoader(l)) as Loader);
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
  | { state: "failed"; message: string; reason?: "unreachable" | "key" | "not_torznab" | "error"; host?: string };

/** Asks the core to check the saved source (`t=caps`) and waits for the answer. */
export async function checkSource(): Promise<CheckResult> {
  const job = await Sources.check();
  if (!job) return { state: "failed", message: "", reason: "error", host: "" };
  for (;;) {
    await new Promise((r) => setTimeout(r, 300));
    const r = JSON.parse(await Sources.result(job));
    if (r.state === "pending") continue;
    if (r.state === "done") return { state: "ok", ...r.caps };
    return { state: "failed", message: r.message ?? "", reason: r.reason ?? "error", host: r.host ?? "" };
  }
}

/** Shows titles and descriptions in `tag`; the core drops what it asked in the old one. */
export async function chooseContentLanguage(tag: string) {
  contentLanguage.set(await Settings.setContentLanguage(tag));
}
