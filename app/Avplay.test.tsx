// The player on a Samsung TV: AVPlay plays in the TV shell, under the web
// UI, driven by messages (ui/avplay.ts). Headless there is no frame above the
// page, so the messages go through NSH's host channel and the test plays the
// shell: it takes the page's `avplay` posts (a stand-in for `host.post`, which
// nsh.json grants nothing: declaring capabilities would deny the rest) and
// sends AVPlay's `avplay-event`s back.
import { expect, test } from "nsh/test";
import { NATIVE, openApp } from "./testEngine";

const URL = "http://127.0.0.1:47391/torrents/0/stream/0";
const status = JSON.stringify({
  phase: "ready",
  name: "Dune.2021.1080p.BluRay",
  stream_url: URL,
  low_space: false,
  speed: 3.4,
  peers: 37,
  found: 52,
  start: 100,
  stage: "starting",
});
/** Settings with the stream's details on, so a stall says "Buffering". */
const DETAILS = {
  "Settings.load": JSON.stringify({ language: "en", bufferMB: 256, bufferChoices: [{ mb: 256, default: true }], streamDetails: true }),
};
/** AVPlay's tracks as the shell reports them. */
const TRACKS = [
  { index: 0, type: "VIDEO", extra: "{}" },
  { index: 1, type: "AUDIO", extra: JSON.stringify({ fourCC: "AAC", language: "eng", channels: "2" }) },
  { index: 2, type: "AUDIO", extra: JSON.stringify({ fourCC: "AC3", language: "rus", channels: "6" }) },
];

/** The core's menu (`Engine.tracks`) over AVPlay's two audio tracks, `audio` in use. */
function menu(audio: 1 | 2) {
  const track = (id: number, language: string, detail: string) =>
    ({ key: `a:${id}`, kind: "embedded", language, title: null, detail, selected: id === audio });
  return JSON.stringify({
    pending: false,
    audio: [track(1, "en", "AAC 2.0"), track(2, "ru", "AC3 5.1")],
    subtitles: [{ key: "off", kind: "off", selected: true }],
    apply: { audio, subtitle: "no", external: null },
  });
}

async function tv(settings: Record<string, unknown> = DETAILS, engine: Record<string, unknown> = {}) {
  /** What the page gave the core as the view's tracks. */
  const embedded: string[] = [];
  const posts: { op: string }[] = [];
  const app = await openApp({
    clock: {},
    host: { handlers: { avplay: null } }, // an embedding app: `host.available()`
    modules: {
      "nsh": { "host.post": (_name: string, op: { op: string }) => { posts.push(op); } },
      "app/native": {
        ...NATIVE,
        ...settings,
        "VideoEngine.kind": "avplay",
        "Engine.status": status,
        "Engine.tracks": (_job: number, _id: string, e: string) => {
          embedded.push(e);
          return menu(1);
        },
        "Engine.chooseTrack": (_job: number, _id: string, _e: string, choice: string) => menu(choice === "a:2" ? 2 : 1),
        ...engine,
      },
    },
  });
  await app.keyboard.press("down"); // Trending movies: Dune
  await app.press("Play");
  await app.wait(600); // one poll of the engine
  const ops = () => posts;
  const event = (e: Record<string, unknown>) => app.host.send("avplay-event", e);
  return { app, ops, event, embedded };
}

/** Plays from the start: AVPlay loaded the stream and plays its first second. */
async function playing(settings: Record<string, unknown> = DETAILS, engine: Record<string, unknown> = {}) {
  const t = await tv(settings, engine);
  await t.event({ type: "loaded", duration: 600, tracks: TRACKS });
  await t.event({ type: "time", position: 1 });
  return t;
}

test("the player opens the core's stream in AVPlay and waits on the stage until it plays", async () => {
  const { app, ops, event } = await tv();
  expect(ops()).toEqual([{ op: "open", url: URL }]);
  expect(app.shows("stage")).toBe(true);
  expect(app.shows("scrubber")).toBe(false);
  await event({ type: "loaded", duration: 600, tracks: TRACKS });
  await event({ type: "time", position: 1 });
  expect(app.shows("stage")).toBe(false);
  expect(app.shows("scrubber")).toBe(true);
  expect(app.texts()).toContain("0:01");
  expect(app.texts()).toContain("−9:59");
});

test("AVPlay's tracks go to the core, and the audio picked in the panel to AVPlay", async () => {
  const { app, ops, embedded } = await playing();
  expect(JSON.parse(embedded.at(-1)!)).toEqual({ avplay: TRACKS });
  // AVPlay already plays the first audio track: nothing to switch yet.
  expect(ops().filter((o) => o.op === "track")).toEqual([]);
  await app.press("label:Audio and subtitles");
  await app.press("label:Russian");
  expect(ops().filter((o) => o.op === "track")).toEqual([{ op: "track", trackType: "AUDIO", index: 2 }]);
});

test("pause, play and seeks reach AVPlay", async () => {
  const { app, ops } = await playing();
  await app.keyboard.press("space");
  expect(app.shows("label:Play")).toBe(true);
  await app.keyboard.press("space");
  await app.keyboard.press("right"); // 10 s on from 0:01
  // The seek reaches AVPlay a moment after the key (a slow machine, CI, is not there yet at once).
  await app.waitUntil(() => ops().length >= 4);
  expect(ops().slice(1)).toEqual([{ op: "pause" }, { op: "play" }, { op: "seek", position: 11 }]);
});

test("a run of presses is one seek, sent once the arrows rest; the scrubber keeps its target until AVPlay gets there", async () => {
  const { app, ops, event } = await playing();
  for (let i = 0; i < 5; i++) await app.keyboard.press("right"); // 50 s on from 0:01
  expect(app.texts()).toContain("0:51"); // the scrubber moved at once
  expect(ops().filter((o) => o.op === "seek")).toEqual([]); // AVPlay not asked yet
  await app.waitUntil(() => ops().some((o) => o.op === "seek"));
  expect(ops().filter((o) => o.op === "seek")).toEqual([{ op: "seek", position: 51 }]);
  // The loader shows from the seek on (AVPlay holds the page while it seeks).
  expect(app.shows("buffering")).toBe(true);
  // AVPlay still reports the old place while it seeks: the scrubber stays on the target.
  await event({ type: "time", position: 2 });
  expect(app.texts()).toContain("0:51");
  await event({ type: "time", position: 51 });
  await event({ type: "time", position: 52 });
  expect(app.texts()).toContain("0:52");
  expect(app.shows("buffering")).toBe(false);
});

test("AVPlay's seeked ends the seek's loader, landed on a keyframe before the target", async () => {
  const { app, ops, event } = await playing();
  await app.keyboard.press("right");
  await app.keyboard.press("right"); // 0:21
  await app.waitUntil(() => ops().some((o) => o.op === "seek"));
  expect(app.shows("buffering")).toBe(true);
  await event({ type: "seeked" });
  await event({ type: "time", position: 16 }); // the keyframe, 5 s before
  expect(app.shows("buffering")).toBe(false);
  expect(app.texts()).toContain("0:16");
});

test("a seek waits for the core to have the place, then goes to AVPlay", async () => {
  const asked: unknown[][] = [];
  const { app, ops } = await playing(DETAILS, {
    // The place comes 3 s after it is asked for.
    "Engine.seek": (...args: unknown[]) => {
      asked.push(args);
      return new Promise<string>((r) => setTimeout(() => r(JSON.stringify({ state: "ready" })), 3000));
    },
  });
  await app.keyboard.press("right"); // 0:11
  await app.wait(1500); // the arrows rested, the place asked for
  expect(asked).toEqual([[1, 11]]);
  expect(ops().filter((o) => o.op === "seek")).toEqual([]); // not before the place is in
  expect(app.shows("buffering")).toBe(true);
  await app.wait(3000);
  expect(ops().filter((o) => o.op === "seek")).toEqual([{ op: "seek", position: 11 }]);
});

test("a seek the core replaced (the job closed) never goes to AVPlay, and its loader goes", async () => {
  const { app, ops } = await playing(DETAILS, {
    "Engine.seek": async () => JSON.stringify({ state: "replaced" }),
  });
  await app.keyboard.press("right");
  await app.wait(1500);
  expect(ops().filter((o) => o.op === "seek")).toEqual([]);
  expect(app.shows("buffering")).toBe(false);
});

test("a seek the core could not get ready stays where it plays", async () => {
  const { app, ops, event } = await playing(DETAILS, {
    "Engine.seek": async () => { throw new Error("the core is gone"); },
  });
  await app.keyboard.press("right");
  await app.wait(1500);
  expect(ops().filter((o) => o.op === "seek")).toEqual([]);
  expect(app.shows("buffering")).toBe(false);
  await event({ type: "time", position: 2 });
  expect(app.texts()).toContain("0:02"); // the scrubber back where it plays
});

test("a stall shows the buffering note until AVPlay has enough again", async () => {
  const { app, event } = await playing();
  await event({ type: "buffering", buffering: true });
  const note = () => app.texts().some((t) => t.startsWith("Buffering"));
  await app.wait(400);
  expect(note()).toBe(true);
  await event({ type: "buffering", buffering: false });
  expect(note()).toBe(false);
});

test("a stall shows the loader Settings picked: the dinosaur by default, the blinking reel instead", async () => {
  const dino = await playing();
  await dino.event({ type: "buffering", buffering: true });
  await dino.app.wait(400);
  expect(dino.app.shows("loader-dinosaur")).toBe(true);
  expect(dino.app.shows("loader-logo")).toBe(false);

  const logo = await playing({
    "Settings.load": JSON.stringify({ language: "en", bufferMB: 256, bufferChoices: [{ mb: 256, default: true }], streamDetails: true, loader: "logo" }),
  });
  await logo.event({ type: "buffering", buffering: true });
  await logo.app.wait(400);
  expect(logo.app.shows("loader-logo")).toBe(true);
  expect(logo.app.shows("loader-dinosaur")).toBe(false);
});

test("at the end the film stands paused with the controls up", async () => {
  const { app, event } = await playing();
  await app.wait(5100);
  expect(app.shows("scrubber")).toBe(false);
  await event({ type: "ended" });
  expect(app.shows("scrubber")).toBe(true);
  expect(app.shows("label:Play")).toBe(true);
});

test("AVPlay's error shows on the stage, and Back stops AVPlay", async () => {
  const { app, ops, event } = await playing();
  await event({ type: "error", message: "PLAYER_ERROR_NOT_SUPPORTED_FILE" });
  expect(app.shows("stage")).toBe(true);
  expect(app.texts()).toContain("Could not play: PLAYER_ERROR_NOT_SUPPORTED_FILE");
  await app.keyboard.press("escape"); // the remote's Back
  expect(app.texts()).toContain("Continue watching");
  expect(ops().at(-1)).toEqual({ op: "stop" });
});
