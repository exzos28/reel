// Playback: hands a film's magnet to the built-in engine, waits for its
// metadata, picks the video file and gives the player a local stream URL.
// While it plays, polls what the engine has of that file (`fileMap`).
import { signal } from "nsh";
import { Engine } from "app/native";
import type { Film } from "../data";

export type Playback =
  | { phase: "idle" }
  | { phase: "noSource"; film: Film }
  | { phase: "resolving"; film: Film }
  | { phase: "failed"; film: Film; message: string }
  | { phase: "ready"; film: Film; url: string; job: number; file: number };

export interface TransferStats {
  /** 0..1 of the whole torrent. */
  progress: number;
  /** MiB/s. */
  speed: number;
  peers: number | null;
}

export const playback = signal<Playback>({ phase: "idle" });
export const transfer = signal<TransferStats | null>(null);
/** The playing file cut into `MAP_BUCKETS` equal byte ranges, each the
 * fraction of it the engine already has (empty until known). */
export const fileMap = signal<number[]>([]);
export const MAP_BUCKETS = 200;

const VIDEO = /\.(mp4|m4v|mov|mkv|webm|avi)$/i;
let poll: ReturnType<typeof setInterval> | undefined;
/** Bumped by `stop`, so a poll that was waiting on the engine drops its answer. */
let generation = 0;

// Engine calls are awaited: the native module answers at once, a test's
// stand-in (`open`'s `modules`) with a promise.
export async function play(film: Film) {
  stop();
  const gen = generation;
  if (!film.magnet) {
    playback.set({ phase: "noSource", film });
    return;
  }
  playback.set({ phase: "resolving", film });
  const port = await Engine.start();
  const job = port ? await Engine.add(film.magnet) : 0;
  if (gen !== generation) return;
  if (!job) {
    playback.set({ phase: "failed", film, message: "engine" });
    return;
  }
  let busy = false;
  poll = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      await tick(film, port, job, gen);
    } catch (e) {
      console.warn("engine poll failed", e);
    } finally {
      busy = false;
    }
  }, 500);
}

async function tick(film: Film, port: number, job: number, gen: number) {
  const s = JSON.parse(await Engine.status(job));
  if (gen !== generation) return;
  if (s.state === "failed") {
    playback.set({ phase: "failed", film, message: s.message });
    clearInterval(poll);
    return;
  }
  if (s.state !== "ready") return;
  let p = playback();
  if (p.phase === "resolving") {
    const files: { index: number; name: string; length: number }[] = s.files;
    const video = files.filter((f) => VIDEO.test(f.name)).sort((a, b) => b.length - a.length)[0];
    if (!video) {
      playback.set({ phase: "failed", film, message: "noVideo" });
      clearInterval(poll);
      return;
    }
    p = {
      phase: "ready",
      film,
      job,
      file: video.index,
      url: `http://127.0.0.1:${port}/torrents/${s.torrent}/stream/${video.index}`,
    };
    playback.set(p);
  }
  const live = s.stats?.live;
  transfer.set({
    progress: s.stats?.total_bytes ? s.stats.progress_bytes / s.stats.total_bytes : 0,
    speed: live?.download_speed?.mbps ?? 0,
    peers: live?.snapshot?.peer_stats?.live ?? null,
  });
  if (p.phase !== "ready") return;
  const map = JSON.parse(await Engine.fileMap(job, p.file, MAP_BUCKETS));
  if (gen !== generation) return;
  if (map.state === "ready") fileMap.set(map.buckets);
}

export function stop() {
  generation++;
  clearInterval(poll);
  poll = undefined;
  playback.set({ phase: "idle" });
  transfer.set(null);
  fileMap.set([]);
}
