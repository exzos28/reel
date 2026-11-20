// The line to a Samsung TV's AVPlay (docs/tizen.md, "Player"). AVPlay lives
// in the TV shell's top-level document (platforms/tizen/ui/shell.js), which is
// cross-origin to the web build, so the page posts `{reel:"avplay", op, …}`
// to `window.top` and the shell answers this frame with
// `{reel:"avplay-event", type, …}`. Where the page has no frame above it,
// NSH's `host` channel carries the same messages (`avplay` posts,
// `avplay-event` events): an embedding app that plays AVPlay for the page,
// as the headless tests do.
import { host } from "nsh";

export type AvplayOp =
  /** `hold`: AVPlay waits for `play` once prepared (the audio track is chosen first). */
  | { op: "open"; url: string; hold?: boolean }
  | { op: "play" }
  | { op: "pause" }
  | { op: "seek"; position: number }
  | { op: "track"; trackType: "AUDIO" | "TEXT"; index: number }
  | { op: "stop" };

/** A track as the shell reports it: AVPlay's `index`, `type` and `extra_info`. */
export interface AvplayTrack {
  index: number;
  type: string;
  extra?: string;
}

export type AvplayEvent =
  | { type: "loaded"; duration: number; tracks?: AvplayTrack[] }
  | { type: "time"; position: number }
  | { type: "buffering"; buffering: boolean }
  | { type: "seeked" }
  | { type: "ended" }
  | { type: "error"; message: string }
  /** AVPlay's other events and the shell's steps, for its log. */
  | { type: "event" | "step" };

export interface AvplayLink {
  send(op: AvplayOp): void;
  /** Hears the player's events until the returned function is called. */
  listen(onEvent: (e: AvplayEvent) => void): () => void;
}

// NSH's typings do not declare the frame globals; in a browser they exist.
interface MessageEventLike {
  source: unknown;
  data: { reel?: string } & Record<string, unknown>;
}
interface FrameLike {
  top: FrameLike | null;
  parent: FrameLike | null;
  document?: { documentElement?: Styled; body?: Styled };
  postMessage(message: unknown, targetOrigin: string): void;
  addEventListener(type: "message", listener: (e: MessageEventLike) => void): void;
  removeEventListener(type: "message", listener: (e: MessageEventLike) => void): void;
}
interface Styled {
  style: { background: string };
}

const frame = (): FrameLike | null => {
  const w = (globalThis as { window?: FrameLike }).window;
  return w && w.top && w.top !== w ? w : null;
};

function frameLink(w: FrameLike): AvplayLink {
  const top = w.top!;
  return {
    // The shell's origin is the packaged widget's, which the page cannot name;
    // the shell checks ours.
    send: (op) => top.postMessage({ reel: "avplay", ...op }, "*"),
    listen(onEvent) {
      const listener = (e: MessageEventLike) => {
        if (e.source === top && e.data?.reel === "avplay-event") onEvent(e.data as unknown as AvplayEvent);
      };
      w.addEventListener("message", listener);
      return () => w.removeEventListener("message", listener);
    },
  };
}

/** Asks the TV shell to leave the app (platforms/tizen/ui/shell.js); false where
 * the page has no shell above it. */
export function postExitToShell(): boolean {
  const w = frame();
  if (!w) return false;
  w.top!.postMessage({ reel: "exit" }, "*");
  return true;
}

const hostLink: AvplayLink = {
  send: (op) => host.post("avplay", op),
  listen: (onEvent) => host.on<AvplayEvent>("avplay-event", onEvent),
};

/** The line to AVPlay here; null where nothing plays it. */
export function avplayLink(): AvplayLink | null {
  const w = frame();
  if (w) return frameLink(w);
  return host.available() ? hostLink : null;
}

/** AVPlay draws on the video plane under the whole web layer: while the
 * player is up, the documents of this frame and those around it up to the
 * shell must not paint a background. Returns what puts them back. */
export function clearPageBackgrounds(): () => void {
  const restore: (() => void)[] = [];
  for (let w = frame(); w && w !== w.top; w = w.parent) {
    try {
      for (const el of [w.document?.documentElement, w.document?.body]) {
        if (!el) continue;
        const was = el.style.background;
        el.style.background = "transparent";
        restore.push(() => (el.style.background = was));
      }
    } catch {
      // A document of another origin: not ours to paint.
      break;
    }
  }
  return () => restore.forEach((r) => r());
}
