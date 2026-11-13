// The player's own controls, on a stand-in engine (no real playback: the
// headless video never loads, so the time stays where seeks put it).
import { expect, open, test } from "nsh/test";
import { ENGINE } from "./testEngine";

const status = JSON.stringify({
  phase: "ready",
  name: "Sintel",
  stream_url: "http://127.0.0.1:8000/torrents/0/stream/0",
  low_space: false,
  speed: 3.4,
  peers: 37,
});
const timeline = JSON.stringify({ ranges: [[0, 0.3], [0.6, 0.7]], ahead: 0 });

async function playing() {
  const app = await open("./App.tsx", {
    clock: {},
    modules: { "app/native": { ...ENGINE, "Engine.status": status, "Engine.timeline": timeline } },
  });
  await app.press("Watch");
  await app.wait(600); // one poll of the engine
  return app;
}

test("the player shows the stream and its controls", async () => {
  const app = await playing();
  const texts = app.texts();
  expect(texts).toContain("Sintel");
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
  await app.keyboard.press("down");
  await app.keyboard.press("right"); // play → back 10 s
  await app.keyboard.press("right"); // → forward 10 s
  await app.keyboard.press("enter");
  expect(app.texts()).toContain("0:10");
  await app.keyboard.press("left"); // → back 10 s
  await app.keyboard.press("enter");
  expect(app.texts()).toContain("0:00");
  await app.keyboard.press("left"); // → play/pause
  await app.keyboard.press("enter");
  expect(app.shows("label:Play")).toBe(true);
  await app.keyboard.press("up"); // back on the scrubber: right seeks again
  await app.keyboard.press("right");
  expect(app.texts()).toContain("0:10");
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
