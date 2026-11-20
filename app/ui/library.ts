// Saved films (design/offline-downloads.md): the core's answers (`Library`) as the screens
// read them. The core decides everything; this asks it again every second while a screen that
// shows saving progress is up.
import { cleanup, signal } from "nsh";
import { Library } from "./native";

/** Whether this device saves films: false on TVs and without the engine (no Save control). */
export const librarySupported: boolean = (() => {
  try {
    return Library.supported() === true;
  } catch {
    return false;
  }
})();

/** A saved film or episode, as `Library.list` gives it. */
export interface SavedItem {
  id: number;
  key: string;
  title: string;
  label: string;
  image: string;
  season: number | null;
  number: number | null;
  /** resolving, saving, paused, waiting, saved, unavailable, failed. */
  state: string;
  size: number;
  have: number;
  progress: number;
  /** What is on the disk is being checked (after a restart): `have` is not known yet. */
  checking?: boolean;
  /** MiB/s while saving. */
  speed: number | null;
  peers: number | null;
  /** Minutes it still takes, rounded; null when not known (or its show's row says it). */
  left: number | null;
  message: string | null;
}

export interface SavedSpace {
  saved: number;
  free: number | null;
  folder: string | null;
}

/** One title on the Saved screen: a film with its one item, a show with its episodes. */
export interface SavedGroup {
  /** The title's id (a catalog key without the episode). */
  id: string;
  title: string;
  image: string;
  show: boolean;
  count: number;
  size: number;
  have: number;
  progress: number;
  /** An item of it is being checked (after a restart): `have` is not known yet. */
  checking?: boolean;
  /** MiB/s of its torrents while saving, null when none saves; people sharing them. */
  speed: number | null;
  peers: number;
  /** Minutes until all of it that is unfinished is saved, rounded; null when not known. */
  left: number | null;
  items: SavedItem[];
}

export interface SavedList {
  saving: SavedGroup[];
  ready: SavedGroup[];
  failed: SavedGroup[];
  space: SavedSpace;
}

/** A key's or a title's state for its Save button. */
export interface SaveState {
  state: string;
  progress: number;
  id?: number;
  message?: string | null;
  /** A show's: episodes saved and being saved. */
  saved?: number;
  saving?: number;
}

/** An episode in the Save drawer. */
export interface PlanEpisode {
  key: string;
  number: number;
  title: string;
  size: number | null;
  state: string;
  progress: number;
  locked: boolean;
}

export interface SeasonPlan {
  episodes: PlanEpisode[];
  saved: number;
  total: number;
  size: number | null;
  /** Bytes free where films are saved, null when not known. */
  free: number | null;
  /** The ticked episodes: how many, the bytes of those whose size is known, and whether they fit
   * the free space (null while a size or the free space is not known). */
  picked: { count: number; size: number; fits: boolean | null };
}

/** A film's Save as the core sees it: the bytes its release takes, the free space, whether it
 * fits (null while either is not known), and the release to save instead when it does not. */
export interface SaveOffer {
  size: number | null;
  free: number | null;
  fits: boolean | null;
  smaller: { id: string; quality: string; source: string; size: number } | null;
}

/** The Saved tab's mark: something is being found or saved, and the share saved of all that
 * is unfinished. */
export interface SavingOverall {
  saving: boolean;
  progress: number;
}

/** Ticks every second while some screen watches (`watchSaved`): readers ask the core again. */
const tick = signal(0);
let watchers = 0;
let timer: ReturnType<typeof setInterval> | undefined;

/** Keeps the saved answers fresh while the calling component is shown. */
export function watchSaved() {
  if (!librarySupported) return;
  watchers++;
  if (!timer) timer = setInterval(() => tick.set(tick() + 1), 1000);
  cleanup(() => {
    watchers--;
    if (watchers === 0 && timer) {
      clearInterval(timer);
      timer = undefined;
    }
  });
}

/** Read again right away (after the viewer acted). */
const refresh = () => tick.set(tick() + 1);

/** The last answer per call: an answer the same as the last one gives the same object, so
 * what reads it does not draw again (as `catalog.ts` does). */
const last = new Map<string, { raw: string; value: unknown }>();
function parsed<T>(key: string, raw: string): T {
  const before = last.get(key);
  if (before && before.raw === raw) return before.value as T;
  const value = JSON.parse(raw) as T;
  last.set(key, { raw, value });
  return value;
}

const EMPTY_LIST: SavedList = { saving: [], ready: [], failed: [], space: { saved: 0, free: null, folder: null } };

export function savedList(): SavedList {
  tick();
  if (!librarySupported) return EMPTY_LIST;
  return parsed<SavedList>("list", Library.list());
}

const IDLE: SavingOverall = { saving: false, progress: 0 };
let overallAt = -1;
let overall: SavingOverall = IDLE;
/** The Saved tab's mark, read every second while watched: the core is asked again only while
 * something saves or after a change (its revision is cheap to ask). */
export function savingOverall(): SavingOverall {
  tick();
  if (!librarySupported) return IDLE;
  const revision = Library.revision();
  if (revision !== overallAt || overall.saving) {
    overallAt = revision;
    overall = parsed<SavingOverall>("overall", Library.overall());
  }
  return overall;
}

/** Where the app opens: "saved" without a network when something is saved to watch, "home",
 * or "wait" while Home's first answers are on their way (the core's `Library.opening`). */
export function opening(): "saved" | "home" | "wait" {
  if (!librarySupported) return "home";
  return Library.opening() as "saved" | "home" | "wait";
}

export function titleSaveState(id: string, show: boolean): SaveState {
  tick();
  if (!librarySupported) return { state: "none", progress: 0 };
  return parsed<SaveState>(`title:${id}`, Library.title(id, show));
}

export const NO_PLAN: SeasonPlan = { episodes: [], saved: 0, total: 0, size: null, free: null, picked: { count: 0, size: 0, fits: true } };

/** The Save drawer's season, with the keys ticked in it. */
export function seasonPlan(show: string, season: number, picked: string[]): SeasonPlan {
  tick();
  if (!librarySupported) return NO_PLAN;
  return parsed<SeasonPlan>(`plan:${show}:${season}`, Library.plan(show, season, JSON.stringify(picked)));
}

const NO_OFFER: SaveOffer = { size: null, free: null, fits: null, smaller: null };

/** A film's Save: its size and whether it fits (read again every second while watched). */
export function saveOffer(key: string): SaveOffer {
  tick();
  if (!librarySupported) return NO_OFFER;
  return parsed<SaveOffer>(`offer:${key}`, Library.offer(key));
}

export function save(keys: string[]) {
  if (keys.length) Library.save(JSON.stringify(keys));
  refresh();
}

/** Saves film `key` from release `release` (an offer's smaller one); Play's release stays. */
export function saveRelease(key: string, release: string) {
  Library.saveRelease(key, release);
  refresh();
}

export function pauseSaved(id: number, paused: boolean) {
  if (paused) Library.pause(id);
  else Library.resume(id);
  refresh();
}

export function removeSaved(id: number) {
  Library.remove(id);
  refresh();
}

/** A film's or an episode's state for its mark (`SaveMark`): none, searching, resolving, saving,
 * paused, waiting, saved, unavailable, failed; read again every second while watched. */
export function itemState(key: string): SaveState {
  tick();
  if (!librarySupported) return { state: "none", progress: 0 };
  return parsed<SaveState>(`item:${key}`, Library.item(key));
}

/** Whether `key` (a film or an episode) is saved whole on this device: it plays from its file,
 * with no search source and no network. */
export function isSaved(key: string): boolean {
  if (!librarySupported) return false;
  try {
    return JSON.parse(Library.item(key)).state === "saved";
  } catch {
    return false;
  }
}

/** Shows the folder of saved films in the file manager (desktops). */
export const openSavedFolder = () => librarySupported && Library.openFolder();

/** The title a saved key belongs to: a show's for an episode. */
export const titleOf = (key: string) => key.replace(/:s\d+e\d+$/, "");
