// The UI's view of what the core is playing. The core decides everything
// (`Engine.open`, `Engine.status`, `Engine.timeline`, where to start and
// what counts as watched: `Catalog.startAt`, `Catalog.saveProgress`); this
// only asks it twice a second, reports the position every 10 s and on stop,
// and keeps the answers in signals for the screens.
import { signal } from "nsh";
import { Catalog, Engine, VideoEngine } from "./native";
import type { PlayTarget, Summary } from "./catalog";

/** What plays: a film, or an episode of a show (`title` is the show). */
export interface Playing extends PlayTarget {
  title: Summary;
}

/** What the core says about the film being played (see `engine::status`). */
export type Status =
  | { phase: "idle" }
  /** No search source is set. */
  | { phase: "no_source" }
  /** The search source did not answer while the player waited for it. */
  | { phase: "source_failed" }
  /** The search found no release this device plays. */
  | { phase: "not_found" }
  /** The episode is not in its season's release: the viewer picks one for it. */
  | { phase: "not_in_release" }
  /** The chosen file will not play on this device (`compat.<reason>`). */
  | { phase: "unsupported"; reason: string }
  | { phase: "no_space"; needed: number; free: number | null }
  /** Before the torrent is in: the catalog still `searching` for a release,
   * or `finding` people who have the torrent's metadata. `ready`: as in `ready`. */
  | { phase: "resolving"; stage?: "searching" | "finding"; ready?: number }
  | { phase: "failed"; message: string }
  | {
      phase: "ready";
      stream_url: string;
      name: string | null;
      low_space: boolean;
      /** MiB/s. */
      speed: number;
      peers: number | null;
      /** People seen so far; null when unknown. */
      found?: number | null;
      /** Percent (0..100) of the file's start the player needs that is in. */
      start?: number;
      /** `connecting` (no one yet), `fetching` (the start comes in), `starting` (it is in). */
      stage?: "connecting" | "fetching" | "starting";
      /** How far it is from its first frame, 0..100, as the core counts it (its steps, then the
       * bytes the player reads first); never goes back, 100 only once the first frame shows. */
      ready?: number;
    };

export interface Timeline {
  /** Ready stretches of the film, [from, to] in 0..1. */
  ranges: [number, number][];
  /** Seconds ready without a gap from the position. */
  ahead: number;
}

export const playing = signal<Playing | null>(null);
export const status = signal<Status>({ phase: "idle" });
/** The player has the screen (a film is opening or playing). */
export const playerUp = () => status().phase !== "idle";
/** An episode the player found missing from its season's release (its key):
 * back on the show, the release panel opens for it. */
export const pickReleaseFor = signal<string | null>(null);
export const timeline = signal<Timeline>({ ranges: [], ahead: 0 });
/** Where the player is, for the core's timeline (set by the player). */
export const position = signal(0);
/** Seconds the video view holds in memory ahead of `position` (mpv's cache; 0 where unknown). */
export const cachedAhead = signal(0);
/** Where the view has read the file to: the byte, and the moment of the film it holds (0: unknown). */
export const readAt = signal({ byte: 0, time: 0 });
export const duration = signal(0);
/** Where the player seeks once the video loads (where the viewer stopped), seconds. */
export const startAt = signal(0);

/** How often the position is reported while playing. */
const SAVE_MS = 10_000;
let savedAt = 0;
function saveProgress() {
  const w = playing();
  if (!w || duration() <= 0 || position() <= 0) return;
  savedAt = Date.now();
  Promise.resolve(Catalog.saveProgress(w.id, position(), duration())).catch((e) => console.warn("saving progress failed", e));
}

let job = 0;
/** The engine's job for what plays (0 when nothing does), for the tracks. */
export const currentJob = () => job;
let poll: ReturnType<typeof setInterval> | undefined;
/** Bumped by `stop`, so an answer for an older film is dropped. */
let generation = 0;

// Engine calls are awaited: the native module answers at once, a test's
// stand-in (`open`'s `modules`) with a promise.
// Another film or episode while one plays (Up next, the Episodes panel) goes straight from the
// one to the other: `playing` and `status` never pass through "nothing plays" on the way, which
// closed the player's screen (iOS: its dialog) and opened it again over the one still leaving.
export async function play(what: Playing) {
  end();
  const gen = generation;
  playing.set(what);
  status.set({ phase: "resolving" });
  savedAt = Date.now();
  startAt.set(Number(await Catalog.startAt(what.id)) || 0);
  if (gen !== generation) return;
  // The last film ends first: its job is closed (`end`) and its view goes with the status above,
  // and the core says when its player has ended. Only then this job, its stream and its player.
  await VideoEngine.ended();
  if (gen !== generation) return;
  const opened = await Engine.open(what.id);
  if (gen !== generation) return;
  if (!opened) {
    status.set({ phase: "failed", message: "engine" });
    return;
  }
  job = opened;
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      const s: Status = JSON.parse(await Engine.status(job));
      if (gen !== generation) return;
      status.set(s);
      if (s.phase === "not_in_release") pickReleaseFor.set(playing()?.id ?? null);
      if (s.phase === "ready") {
        const tl: Timeline = JSON.parse(await Engine.timeline(job, position(), duration(), cachedAhead(), readAt().byte, readAt().time));
        if (gen === generation) timeline.set(tl);
        if (gen === generation && Date.now() - savedAt >= SAVE_MS) saveProgress();
      } else if (s.phase !== "resolving") {
        clearInterval(poll);
      }
    } catch (e) {
      console.warn("engine poll failed", e);
    } finally {
      busy = false;
    }
  };
  await tick();
  if (gen === generation && (status().phase === "resolving" || status().phase === "ready")) {
    poll = setInterval(tick, 500);
  }
}

/** The first frame is on screen: the core logs how long that took (timing log). */
export function firstFrame() {
  if (job) Engine.firstFrame(job);
}

/** What plays now ends: its place saved, its job closed, its answers dropped. */
function end() {
  saveProgress();
  generation++;
  clearInterval(poll);
  poll = undefined;
  if (job) Engine.close(job);
  job = 0;
  timeline.set({ ranges: [], ahead: 0 });
  position.set(0);
  duration.set(0);
  startAt.set(0);
}

/** Nothing plays: the player goes. */
export function stop() {
  end();
  playing.set(null);
  status.set({ phase: "idle" });
}
