// The UI's view of what the core is playing. The core decides everything
// (`Engine.open`, `Engine.status`, `Engine.timeline`); this only asks it
// twice a second and keeps the answers in signals for the screens.
import { signal } from "nsh";
import { Engine } from "app/native";
import type { PlayTarget, Summary } from "./catalog";

/** What plays: a film, or an episode of a show (`title` is the show). */
export interface Playing extends PlayTarget {
  title: Summary;
}

/** What the core says about the film being played (see `engine::status`). */
export type Status =
  | { phase: "idle" }
  | { phase: "no_source" }
  | { phase: "no_space"; needed: number; free: number | null }
  | { phase: "resolving" }
  | { phase: "failed"; message: string }
  | {
      phase: "ready";
      stream_url: string;
      name: string | null;
      low_space: boolean;
      /** MiB/s. */
      speed: number;
      peers: number | null;
    };

export interface Timeline {
  /** Ready stretches of the film, [from, to] in 0..1. */
  ranges: [number, number][];
  /** Seconds ready without a gap from the position. */
  ahead: number;
}

export const playing = signal<Playing | null>(null);
export const status = signal<Status>({ phase: "idle" });
export const timeline = signal<Timeline>({ ranges: [], ahead: 0 });
/** Where the player is, for the core's timeline (set by the player). */
export const position = signal(0);
export const duration = signal(0);

let job = 0;
let poll: ReturnType<typeof setInterval> | undefined;
/** Bumped by `stop`, so an answer for an older film is dropped. */
let generation = 0;

// Engine calls are awaited: the native module answers at once, a test's
// stand-in (`open`'s `modules`) with a promise.
export async function play(what: Playing) {
  stop();
  const gen = generation;
  playing.set(what);
  status.set({ phase: "resolving" });
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
      if (s.phase === "ready") {
        const tl: Timeline = JSON.parse(await Engine.timeline(job, position(), duration()));
        if (gen === generation) timeline.set(tl);
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

export function stop() {
  generation++;
  clearInterval(poll);
  poll = undefined;
  if (job) Engine.close(job);
  job = 0;
  playing.set(null);
  status.set({ phase: "idle" });
  timeline.set({ ranges: [], ahead: 0 });
  position.set(0);
  duration.set(0);
}
