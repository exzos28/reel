// Subtitles from the release, on a stand-in core: picking one in the tracks
// panel and our overlay showing the cue at the player's position (the
// still video view, STILL, plays its first frame and stands still, so the
// position is where seeks put it).
import { expect, test } from "nsh/test";
import { NATIVE, STILL, openApp } from "./testEngine";

const status = JSON.stringify({
  phase: "ready",
  name: "Dune.2021.1080p.BluRay",
  stream_url: "http://127.0.0.1:8000/torrents/0/stream/0",
  low_space: false,
  speed: 3.4,
  peers: 37,
});

/** The core's menu (`Engine.tracks`) with subtitle `chosen` in use: off, or file 5 (English). */
function menu(chosen: "off" | "x:5") {
  return JSON.stringify({
    pending: false,
    audio: [{ key: "original", kind: "original", selected: true }],
    subtitles: [
      { key: "off", kind: "off", selected: chosen === "off" },
      { key: "x:5", kind: "external", language: "en", title: "", format: "srt", forced: false, selected: chosen === "x:5" },
    ],
    apply: { audio: null, subtitle: null, external: chosen === "x:5" ? 5 : null },
  });
}

/** File 5's cues (`Engine.cues`): one line from 10 s to 14 s. */
function cues(_job: number, id: number, from: number, to: number) {
  const on = id === 5 && from < 14 && to >= 10;
  return JSON.stringify({ state: "ready", cues: [], text: on ? "The tide is coming in." : "" });
}

async function playing(remembered: "off" | "x:5") {
  const chosen: string[] = [];
  const app = await openApp({
    clock: {},
    modules: {
      "app/native": {
        ...NATIVE,
        ...STILL,
        "Engine.status": status,
        "Engine.tracks": menu(remembered),
        "Engine.chooseTrack": (_job: number, _id: string, _embedded: string, choice: string) => {
          chosen.push(choice);
          return menu(choice === "x:5" ? "x:5" : "off");
        },
        "Engine.cues": cues,
      },
    },
  });
  await app.keyboard.press("down"); // Trending movies: Dune
  await app.press("Play");
  await app.wait(600); // one poll of the engine
  return { app, chosen };
}

test("the Subtitles column lists the release's files; picking one asks the core", async () => {
  const { app, chosen } = await playing("off");
  await app.keyboard.press("down");
  await app.keyboard.press("right");
  await app.keyboard.press("right"); // → audio and subtitles
  await app.keyboard.press("enter");
  expect(app.texts()).toContain("Off");
  expect(app.texts()).toContain("English");
  expect(app.texts()).toContain("File in the release");
  await app.keyboard.press("right"); // → Subtitles
  await app.keyboard.press("down"); // → English
  await app.keyboard.press("enter");
  expect(chosen).toEqual(["x:5"]);
  await app.keyboard.press("escape"); // close the panel
  await app.keyboard.press("up"); // back on the scrubber
  await app.keyboard.press("right"); // seek to 0:10: the line is on screen
  expect(app.texts()).toContain("The tide is coming in.");
});

test("the overlay shows the cue at the position, and only then", async () => {
  const { app } = await playing("x:5");
  expect(app.shows("subtitle")).toBe(false); // 0:00, nothing yet
  await app.keyboard.press("right"); // 0:10
  expect(app.shows("subtitle")).toBe(true);
  expect(app.texts()).toContain("The tide is coming in.");
  await app.keyboard.press("right"); // 0:20, the line is over
  expect(app.shows("subtitle")).toBe(false);
});

test("Off takes the subtitles away", async () => {
  const { app, chosen } = await playing("x:5");
  await app.keyboard.press("right"); // 0:10
  expect(app.texts()).toContain("The tide is coming in.");
  await app.press("label:Audio and subtitles");
  await app.press("label:Off");
  expect(chosen).toEqual(["off"]);
  expect(app.texts()).not.toContain("The tide is coming in.");
});
