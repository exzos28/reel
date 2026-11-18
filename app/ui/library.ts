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
  /** MiB/s while saving. */
  speed: number | null;
  peers: number | null;
  message: string | null;
}

export interface SavedSpace {
  saved: number;
  free: number | null;
  folder: string | null;
}

export interface SavedList {
  saving: SavedItem[];
  ready: SavedItem[];
  failed: SavedItem[];
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

const EMPTY_LIST: SavedList = { saving: [], ready: [], failed: [], space: { saved: 0, free: null, folder: null } };

export function savedList(): SavedList {
  tick();
  if (!librarySupported) return EMPTY_LIST;
  return JSON.parse(Library.list());
}

export function titleSaveState(id: string, show: boolean): SaveState {
  tick();
  if (!librarySupported) return { state: "none", progress: 0 };
  return JSON.parse(Library.title(id, show));
}

export function seasonPlan(show: string, season: number): SeasonPlan {
  tick();
  if (!librarySupported) return { episodes: [], saved: 0, total: 0, size: null };
  return JSON.parse(Library.plan(show, season));
}

export function save(keys: string[]) {
  if (keys.length) Library.save(JSON.stringify(keys));
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

/** Shows the folder of saved films in the file manager (desktops). */
export const openSavedFolder = () => librarySupported && Library.openFolder();

/** The title a saved key belongs to: a show's for an episode. */
export const titleOf = (key: string) => key.replace(/:s\d+e\d+$/, "");
