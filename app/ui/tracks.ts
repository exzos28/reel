// The player's tracks, as the core decides them (`Engine.tracks`,
// `Engine.chooseTrack`, `Engine.cues`): the Audio and Subtitles columns of
// the tracks panel, what the video view applies, and the subtitle line our
// overlay shows. This only asks and keeps the answers in signals.
import { cleanup, computed, effect, signal } from "nsh";
import { Engine } from "app/native";
import { currentJob, playing, position, status } from "./playback";

export interface TrackOption {
  key: string;
  kind: "original" | "off" | "embedded" | "external";
  /** ISO 639-1 when the core knows the language, else what the file says. */
  language?: string | null;
  title?: string | null;
  codec?: string | null;
  channels?: string | null;
  format?: string;
  forced?: boolean;
  selected: boolean;
}

export interface TrackMenu {
  /** The release's subtitle files are not known yet. */
  pending: boolean;
  audio: TrackOption[];
  subtitles: TrackOption[];
  /** What the video view applies, and the subtitle file our overlay shows. */
  apply: { audio: number | null; subtitle: number | "no" | null; external: number | null };
}

const BEFORE: TrackMenu = {
  pending: true,
  audio: [{ key: "original", kind: "original", selected: true }],
  subtitles: [{ key: "off", kind: "off", selected: true }],
  apply: { audio: null, subtitle: null, external: null },
};

/** For the player (call inside its component): the menu, the overlay's line,
 * `embedded` for the view's `onTracks`, and `choose` for the panel. */
export function playerTracks() {
  /** The view's tracks (JSON), empty where it reports none. */
  const embedded = signal("");
  const menu = signal<TrackMenu>(BEFORE);
  /** The subtitle line on screen now ("" for none). */
  const cue = signal("");
  const ready = computed(() => status().phase === "ready");

  let asked = 0;
  const refresh = async () => {
    const job = currentJob();
    const w = playing();
    if (!job || !w) return;
    const n = ++asked;
    const m: TrackMenu = JSON.parse(await Engine.tracks(job, w.id, embedded()));
    if (n === asked) menu.set(m);
  };
  effect(() => {
    embedded();
    if (ready()) void refresh().catch((e) => console.warn("tracks", e));
  });
  // Until the release's files are known (its metadata comes from peers).
  const poll = setInterval(() => {
    if (ready() && menu().pending) void refresh().catch((e) => console.warn("tracks", e));
  }, 1000);
  cleanup(() => clearInterval(poll));

  const choose = async (key: string) => {
    const job = currentJob();
    const w = playing();
    if (!job || !w) return;
    const n = ++asked;
    const m: TrackMenu = JSON.parse(await Engine.chooseTrack(job, w.id, embedded(), key));
    if (n === asked) menu.set(m);
  };

  let cueAsked = 0;
  effect(() => {
    const file = menu().apply.external;
    const at = position();
    if (file == null) {
      cue.set("");
      return;
    }
    const n = ++cueAsked;
    Promise.resolve(Engine.cues(currentJob(), file, at, at))
      .then((r) => { if (n === cueAsked) cue.set(JSON.parse(r).text ?? ""); })
      .catch((e) => console.warn("cues", e));
  });

  return { embedded, menu, cue, choose };
}
