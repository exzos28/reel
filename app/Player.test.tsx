// The player's own controls, on a stand-in engine (no real playback: the
// headless video never loads, so the time stays where seeks put it).
import { expect, open, test } from "nsh/test";
import { readyAhead, readyRanges } from "./ui/scrub";

const status = JSON.stringify({
  state: "ready",
  torrent: 0,
  name: "Sintel",
  files: [{ index: 0, name: "Sintel/sintel.mp4", length: 1000 }],
  stats: { total_bytes: 1000, progress_bytes: 300, live: { download_speed: { mbps: 3.4 }, snapshot: { peer_stats: { live: 37 } } } },
});
const map = JSON.stringify({ state: "ready", length: 1000, buckets: [1, 1, 1, 0.2, 0, 0, 1, 0, 0, 0] });

async function playing() {
  const app = await open("./App.tsx", {
    clock: {},
    modules: { "app/native": { "Engine.start": 8000, "Engine.add": 1, "Engine.status": status, "Engine.fileMap": map } },
  });
  await app.press("Watch");
  await app.wait(600); // one poll of the engine
  return app;
}

test("the player shows the stream and the scrubber legend", async () => {
  const app = await playing();
  const texts = app.texts();
  expect(texts).toContain("Sintel");
  expect(texts).toContain("streaming at 3.4 MB/s from 37 people");
  expect(texts).toContain("Watched");
  expect(texts).toContain("Ready, plays instantly");
  expect(texts).toContain("Not loaded yet");
  expect(app.shows("label:Pause")).toBe(true);
  expect(app.shows("label:Back 10 seconds")).toBe(true);
  expect(app.shows("label:Forward 10 seconds")).toBe(true);
});

test("the overlay hides after a few quiet seconds and comes back on any key", async () => {
  const app = await playing();
  await app.wait(3100);
  expect(app.texts()).not.toContain("Watched");
  await app.keyboard.press("down");
  expect(app.texts()).toContain("Watched");
  await app.wait(3100);
  expect(app.texts()).not.toContain("Watched");
});

test("a press anywhere brings the overlay back", async () => {
  const app = await playing();
  await app.wait(3100);
  await app.press("player");
  expect(app.texts()).toContain("Watched");
});

test("paused, the overlay stays", async () => {
  const app = await playing();
  await app.keyboard.press("space");
  expect(app.shows("label:Play")).toBe(true);
  await app.wait(5000);
  expect(app.texts()).toContain("Watched");
  await app.keyboard.press("enter");
  expect(app.shows("label:Pause")).toBe(true);
  await app.wait(3100);
  expect(app.texts()).not.toContain("Watched");
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
  expect(app.texts()).not.toContain("Watched");
  expect(app.texts()).not.toContain("Continue watching");
  await app.keyboard.press("escape");
  expect(app.texts()).toContain("Continue watching");
});

test("ready ranges merge neighbouring buckets", () => {
  expect(readyRanges([1, 1, 0.2, 0, 0.6])).toEqual([{ from: 0, to: 0.4 }, { from: 0.8, to: 1 }]);
  expect(readyRanges([])).toEqual([]);
});

test("ready ahead counts whole buckets from the position without a gap", () => {
  // 10 buckets of 60 s each in a 600 s film.
  const b = [1, 1, 1, 0.2, 0, 0, 1, 0, 0, 0];
  expect(Math.round(readyAhead(b, 0, 600))).toBe(180);
  expect(Math.round(readyAhead(b, 90, 600))).toBe(90);
  expect(Math.round(readyAhead(b, 200, 600))).toBe(0);
  expect(Math.round(readyAhead(b, 0, 0))).toBe(0);
});

test("hidden, the remote is back on the scrubber", async () => {
  const app = await playing();
  await app.keyboard.press("down");
  await app.wait(3100);
  await app.keyboard.press("right");
  expect(app.texts()).toContain("0:10");
});
