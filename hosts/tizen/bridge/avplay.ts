// The player on a Samsung TV, from inside the web build: AVPlay lives in the shell's
// top-level document (hosts/tizen/ui/shell.js), which is cross-origin to the web build (served
// by the core on 127.0.0.1), so the page drives it with postMessage to window.top.
// Reference implementation for app/ (docs/tizen.md, "Player"); not compiled in hosts/tizen.
//
// While a video plays, everything the page draws over it must be transparent: AVPlay draws
// on the TV's video plane, under the whole web layer.

export type AvplayEvent =
  | { type: "loaded"; duration: number; tracks: { index: number; type: string; extra: string }[] }
  | { type: "time"; position: number }
  | { type: "buffering"; buffering: boolean }
  | { type: "seeked" }
  | { type: "ended" }
  | { type: "error"; message: string }
  | { type: "event"; event: string; data: unknown };

type Op =
  | { op: "open"; url: string }
  | { op: "play" }
  | { op: "pause" }
  | { op: "seek"; position: number }
  | { op: "track"; trackType: "AUDIO" | "TEXT"; index: number }
  | { op: "stop" };

// NSH's typings do not declare the frame globals; on the web they exist.
declare const window: {
  top: { postMessage(message: unknown, targetOrigin: string): void };
  addEventListener(type: "message", listener: (e: { source: unknown; data: any }) => void): void;
  removeEventListener(type: "message", listener: (e: { source: unknown; data: any }) => void): void;
};

function send(op: Op) {
  // The shell's origin is the packaged widget's; it checks ours (http://127.0.0.1:47391).
  window.top.postMessage({ reel: "avplay", ...op }, "*");
}

/** Starts playing `url` (the core's stream URL); `onEvent` gets the player's events until
 * the returned function is called (which also stops playback). */
export function play(url: string, onEvent: (e: AvplayEvent) => void): () => void {
  const listener = (e: { source: unknown; data: any }) => {
    if (e.source === window.top && e.data?.reel === "avplay-event") onEvent(e.data as AvplayEvent);
  };
  window.addEventListener("message", listener);
  send({ op: "open", url });
  return () => {
    window.removeEventListener("message", listener);
    send({ op: "stop" });
  };
}

export const pause = () => send({ op: "pause" });
export const resume = () => send({ op: "play" });
export const seek = (position: number) => send({ op: "seek", position });
export const selectTrack = (trackType: "AUDIO" | "TEXT", index: number) => send({ op: "track", trackType, index });
