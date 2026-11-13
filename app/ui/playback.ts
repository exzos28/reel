// Playback: hands a film's magnet to the built-in engine, waits for its
// metadata, picks the video file and gives the player a local stream URL.
import { signal } from "nsh";
import { Engine } from "app/native";
import type { Film } from "../data";

export type Playback =
  | { phase: "idle" }
  | { phase: "noSource"; film: Film }
  | { phase: "resolving"; film: Film }
  | { phase: "failed"; film: Film; message: string }
  | { phase: "ready"; film: Film; url: string; job: number };

export interface TransferStats {
  /** 0..1 of the whole torrent. */
  progress: number;
  /** MiB/s. */
  speed: number;
  peers: number | null;
}

export const playback = signal<Playback>({ phase: "idle" });
export const transfer = signal<TransferStats | null>(null);

const VIDEO = /\.(mp4|m4v|mov|mkv|webm|avi)$/i;
let poll: ReturnType<typeof setInterval> | undefined;

export function play(film: Film) {
  stop();
  if (!film.magnet) {
    playback.set({ phase: "noSource", film });
    return;
  }
  const port = Engine.start();
  const job = port ? Engine.add(film.magnet) : 0;
  if (!job) {
    playback.set({ phase: "failed", film, message: "engine" });
    return;
  }
  playback.set({ phase: "resolving", film });
  poll = setInterval(() => {
    const s = JSON.parse(Engine.status(job));
    if (s.state === "failed") {
      playback.set({ phase: "failed", film, message: s.message });
      clearInterval(poll);
      return;
    }
    if (s.state !== "ready") return;
    const p = playback();
    if (p.phase === "resolving") {
      const files: { index: number; name: string; length: number }[] = s.files;
      const video = files.filter((f) => VIDEO.test(f.name)).sort((a, b) => b.length - a.length)[0];
      if (!video) {
        playback.set({ phase: "failed", film, message: "noVideo" });
        clearInterval(poll);
        return;
      }
      playback.set({ phase: "ready", film, job, url: `http://127.0.0.1:${port}/torrents/${s.torrent}/stream/${video.index}` });
    }
    const live = s.stats?.live;
    transfer.set({
      progress: s.stats?.total_bytes ? s.stats.progress_bytes / s.stats.total_bytes : 0,
      speed: live?.download_speed?.mbps ?? 0,
      peers: live?.snapshot?.peer_stats?.live ?? null,
    });
  }, 500);
}

export function stop() {
  clearInterval(poll);
  poll = undefined;
  playback.set({ phase: "idle" });
  transfer.set(null);
}
