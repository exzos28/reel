// What the scrubber draws from the engine's file map (`fileMap` of
// ./playback): byte buckets of the file mapped to time.
//
// Bytes become time proportionally (bucket i of n is the stretch
// i/n..(i+1)/n of the film). That is exact only for constant bitrate; with
// variable bitrate and the index at either end it is an approximation, good
// enough to show where the film is ready.

/** A bucket counts as ready when this much of it is downloaded. */
const READY = 0.5;
/** "Ready ahead" counts only buckets downloaded whole. */
const FULL = 0.999;

export interface Range {
  /** 0..1 of the film. */
  from: number;
  to: number;
}

/** The ready stretches of the film, neighbouring buckets merged. */
export function readyRanges(buckets: number[]): Range[] {
  const n = buckets.length;
  const out: Range[] = [];
  for (let i = 0; i < n; i++) {
    if (buckets[i] < READY) continue;
    const last = out[out.length - 1];
    if (last && last.to === i / n) last.to = (i + 1) / n;
    else out.push({ from: i / n, to: (i + 1) / n });
  }
  return out;
}

/** Seconds of the film downloaded without a gap from `position` on. */
export function readyAhead(buckets: number[], position: number, duration: number): number {
  const n = buckets.length;
  if (!n || duration <= 0) return 0;
  const at = Math.min(Math.max(position / duration, 0), 1);
  let i = Math.floor(at * n);
  if (i >= n || buckets[i] < FULL) return 0;
  let ahead = (i + 1) / n - at;
  for (i++; i < n && buckets[i] >= FULL; i++) ahead += 1 / n;
  return ahead * duration;
}
