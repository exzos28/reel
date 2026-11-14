// The player's own controls, on a stand-in engine and a still video view
// (STILL: it plays its first frame at once and stands still, so the time
// stays where seeks put it); and the stage before the first frame.
import { expect, test } from "nsh/test";
import { episode, NATIVE, STILL, openApp } from "./testEngine";

const status = JSON.stringify({
  phase: "ready",
  name: "Dune.2021.1080p.BluRay",
  stream_url: "http://127.0.0.1:8000/torrents/0/stream/0",
  low_space: false,
  speed: 3.4,
  peers: 37,
  found: 52,
  start: 100,
  stage: "starting",
});
const timeline = JSON.stringify({ ranges: [[0, 0.3], [0.6, 0.7]], ahead: 0 });
/** Settings with the stream's details on (they are off by default). */
const DETAILS = {
  "Settings.load": JSON.stringify({ language: "en", bufferMB: 256, bufferChoices: [{ mb: 256, default: true }], streamDetails: true }),
};

async function playing() {
  const app = await openApp({
    clock: {},
    modules: { "app/native": { ...NATIVE, ...STILL, ...DETAILS, "Engine.status": status, "Engine.timeline": timeline } },
  });
  await app.keyboard.press("down"); // Trending movies: Dune
  await app.press("Play");
  await app.wait(600); // one poll of the engine
  return app;
}

/** Play on Dune with the engine answering `engine` and the video never loading. */
async function waiting(engine: Record<string, unknown>) {
  const app = await openApp({
    clock: {},
    modules: { "app/native": { ...NATIVE, ...DETAILS, "Engine.status": JSON.stringify(engine) } },
  });
  await app.keyboard.press("down");
  await app.press("Play");
  await app.wait(600);
  return app;
}

const noControls = (app: Awaited<ReturnType<typeof waiting>>) => {
  expect(app.shows("scrubber")).toBe(false);
  expect(app.shows("label:Pause")).toBe(false);
  expect(app.texts()).not.toContain("0:00");
};

test("while the engine looks for people, the stage shows the title and what it does", async () => {
  const app = await waiting({ phase: "resolving", stage: "finding" });
  expect(app.shows("stage")).toBe(true);
  expect(app.texts()).toContain("DUNE"); // the logotype
  expect(app.texts()).toContain("Finding people sharing this film");
  noControls(app);
  await app.keyboard.press("enter"); // nothing to play or pause yet
  noControls(app);
  await app.keyboard.press("escape"); // Back leaves at once
  expect(app.texts()).toContain("Continue watching");
});

test("connected, the stage counts the film's start in until the video loads", async () => {
  const app = await waiting({ ...JSON.parse(status), stage: "connecting", peers: 0, found: 12, start: 0 });
  expect(app.texts()).toContain("Found 12 people, connecting");
  noControls(app);
  const fetching = await waiting({ ...JSON.parse(status), stage: "fetching", start: 42 });
  expect(fetching.texts()).toContain("Fetching the start of the film, 42%");
  expect(fetching.texts()).toContain("streaming at 3.4 MB/s from 37 people");
  noControls(fetching);
  const starting = await waiting(JSON.parse(status));
  expect(starting.texts()).toContain("Starting");
  noControls(starting);
  await starting.press("label:Back");
  expect(starting.texts()).toContain("Continue watching");
});

test("a film that cannot play says so in the middle of the stage, with what to do", async () => {
  const app = await waiting({ phase: "failed", message: "the torrent was only listed" });
  expect(app.shows("stage")).toBe(true);
  expect(app.texts()).toContain("Could not play: the torrent was only listed");
  expect(app.texts()).toContain("Go back and pick another release.");
  noControls(app);
  const unsupported = await waiting({ phase: "unsupported", reason: "container" });
  expect(unsupported.texts()).toContain("This file's format does not play on this device. Choose another release.");
});

test("once the first frame plays, the stage gives way to the controls", async () => {
  const app = await playing();
  expect(app.shows("stage")).toBe(false);
  expect(app.shows("scrubber")).toBe(true);
  expect(app.texts()).toContain("0:00");
});

test("the player shows the stream and its controls", async () => {
  const app = await playing();
  const texts = app.texts();
  expect(texts).toContain("Dune");
  expect(texts).toContain("1080p BluRay");
  expect(texts).toContain("streaming at 3.4 MB/s from 37 people");
  expect(app.shows("label:Pause")).toBe(true);
  expect(app.shows("label:Back 10 seconds")).toBe(true);
  expect(app.shows("label:Forward 10 seconds")).toBe(true);
});

test("the overlay hides after a few quiet seconds and comes back on any key", async () => {
  const app = await playing();
  await app.wait(3100);
  expect(app.texts()).not.toContain("streaming at 3.4 MB/s from 37 people");
  await app.keyboard.press("down");
  expect(app.texts()).toContain("streaming at 3.4 MB/s from 37 people");
  await app.wait(3100);
  expect(app.texts()).not.toContain("streaming at 3.4 MB/s from 37 people");
});

test("a press anywhere brings the overlay back", async () => {
  const app = await playing();
  await app.wait(3100);
  await app.press("player");
  expect(app.texts()).toContain("streaming at 3.4 MB/s from 37 people");
});

test("paused, the overlay stays", async () => {
  const app = await playing();
  await app.keyboard.press("space");
  expect(app.shows("label:Play")).toBe(true);
  await app.wait(5000);
  expect(app.texts()).toContain("streaming at 3.4 MB/s from 37 people");
  await app.keyboard.press("enter");
  expect(app.shows("label:Pause")).toBe(true);
  await app.wait(3100);
  expect(app.texts()).not.toContain("streaming at 3.4 MB/s from 37 people");
});

test("left and right seek 10 seconds on the scrubber", async () => {
  const app = await playing();
  await app.keyboard.press("right");
  await app.keyboard.press("right");
  expect(app.texts()).toContain("0:20");
  await app.keyboard.press("left");
  expect(app.texts()).toContain("0:10");
  await app.keyboard.press("left");
  await app.keyboard.press("left");
  expect(app.texts()).toContain("0:00");
});

test("down moves to the buttons; left and right pick one, enter runs it", async () => {
  const app = await playing();
  await app.keyboard.press("down"); // on play/pause
  expect(app.texts()).toContain("Pause"); // the focused button's label shows
  await app.keyboard.press("right"); // → forward 10 s
  await app.keyboard.press("enter");
  expect(app.texts()).toContain("0:10");
  await app.keyboard.press("left"); // → play/pause
  await app.keyboard.press("left"); // → back 10 s
  await app.keyboard.press("enter");
  expect(app.texts()).toContain("0:00");
  await app.keyboard.press("right"); // → play/pause
  await app.keyboard.press("enter");
  expect(app.shows("label:Play")).toBe(true);
  await app.keyboard.press("up"); // back on the scrubber: right seeks again
  await app.keyboard.press("right");
  expect(app.texts()).toContain("0:10");
});

test("the tracks button opens Audio, Subtitles and Release; Back closes it first", async () => {
  const app = await playing();
  await app.keyboard.press("down");
  await app.keyboard.press("right");
  await app.keyboard.press("right"); // → audio and subtitles
  await app.keyboard.press("enter");
  expect(app.texts()).toContain("Subtitles");
  expect(app.texts()).toContain("Original");
  expect(app.texts()).toContain("720p WEB");
  await app.wait(5000); // stays while the panel is open
  expect(app.texts()).toContain("Subtitles");
  await app.keyboard.press("escape");
  expect(app.texts()).not.toContain("Subtitles");
  expect(app.texts()).toContain("streaming at 3.4 MB/s from 37 people");
});

test("the buttons work with the mouse", async () => {
  const app = await playing();
  await app.press("label:Forward 10 seconds");
  expect(app.texts()).toContain("0:10");
  await app.press("label:Pause");
  expect(app.shows("label:Play")).toBe(true);
  await app.press("label:Back");
  expect(app.texts()).toContain("Continue watching");
});

test("escape hides the overlay first, then leaves the player", async () => {
  const app = await playing();
  await app.keyboard.press("escape");
  expect(app.texts()).not.toContain("streaming at 3.4 MB/s from 37 people");
  expect(app.texts()).not.toContain("Continue watching");
  await app.keyboard.press("escape");
  expect(app.texts()).toContain("Continue watching");
});

test("hidden, the remote is back on the scrubber", async () => {
  const app = await playing();
  await app.keyboard.press("down");
  await app.wait(3100);
  await app.keyboard.press("right");
  expect(app.texts()).toContain("0:10");
});

const nextEpisode = JSON.stringify(episode(3, "Old Story"));

async function nearTheEnd() {
  const app = await openApp({
    clock: {},
    // The core offers the next episode (as it does in the last 40 s).
    modules: { "app/native": { ...NATIVE, ...STILL, "Engine.status": status, "Engine.timeline": timeline, "Catalog.upNext": nextEpisode } },
  });
  await app.keyboard.press("right"); // Attack on Titan
  await app.waitFor("Resume S3:E2"); // the hero follows once the focus rests
  await app.press("Resume S3:E2");
  await app.wait(600);
  return app;
}

test("near the end of an episode, Up next counts down and plays the next one", async () => {
  const app = await nearTheEnd();
  expect(app.texts()).toContain("Next episode · S3:E3");
  expect(app.texts()).toContain("Old Story");
  expect(app.texts()).toContain("in 6 s");
  expect(app.texts()).not.toContain("streaming at 3.4 MB/s from 37 people");
  await app.wait(6100);
  await app.keyboard.press("escape"); // dismiss the card the next episode shows again
  // (The stand-in names every episode as S3:E2.)
  expect(app.texts()).toContain("S3:E3 · Pain");
});

test("Watch credits dismisses Up next and brings the controls back", async () => {
  const app = await nearTheEnd();
  await app.keyboard.press("right");
  await app.keyboard.press("enter");
  expect(app.texts()).not.toContain("Next episode · S3:E3");
  await app.keyboard.press("down");
  expect(app.texts()).toContain("S3:E2 · Pain");
});

test("by default the player keeps the stream's details to itself", async () => {
  const app = await openApp({
    clock: {},
    modules: { "app/native": { ...NATIVE, ...STILL, "Engine.status": status, "Engine.timeline": timeline } },
  });
  await app.keyboard.press("down");
  await app.press("Play");
  await app.wait(600);
  expect(app.shows("scrubber")).toBe(true);
  expect(app.texts()).not.toContain("streaming at 3.4 MB/s from 37 people");
});
