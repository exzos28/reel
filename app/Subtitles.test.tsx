// Subtitles from the release, on a stand-in core: picking one in the tracks
// panel and our overlay showing the cue at the player's position (the
// still video view, STILL, plays its first frame and stands still, so the
// position is where seeks put it).
import { expect, test } from "nsh/test";
import { NATIVE, STILL, openApp, DUNE_FIRST } from "./testEngine";
import { MIN_SIZE, ems, subtitleBottom, subtitleFit, subtitleScale } from "./ui/SubtitleOverlay";

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
        ...DUNE_FIRST,
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
  await app.press("Play"); // Dune, the hero of a Home with nothing begun
  // The core's answers come from outside the app's clock: wait for the blocks they bring, not for a time.
  await app.waitFor("stage", { state: "gone" }); // the first frame played: the controls are there
  return { app, chosen };
}

test("the Subtitles column lists the release's files; picking one asks the core", async () => {
  const { app, chosen } = await playing("off");
  await app.keyboard.press("down");
  await app.keyboard.press("right");
  await app.keyboard.press("right"); // → audio and subtitles
  await app.keyboard.press("enter");
  await app.waitFor("id:subtitles-x:5"); // the core's menu came: the release's file is listed
  expect(app.texts()).toContain("Off");
  expect(app.texts()).toContain("English");
  expect(app.texts()).toContain("File in the release");
  await app.keyboard.press("right"); // → Subtitles
  await app.keyboard.press("down"); // → English
  await app.keyboard.press("enter");
  await app.waitUntil(() => chosen.length > 0);
  expect(chosen).toEqual(["x:5"]);
  await app.keyboard.press("escape"); // close the panel
  await app.keyboard.press("up"); // back on the scrubber
  await app.keyboard.press("right"); // seek to 0:10: the line is on screen
  await app.waitFor("id:subtitle"); // the core's answer comes a moment after the seek
  expect(app.texts()).toContain("The tide is coming in.");
});

test("the overlay shows the cue at the position, and only then", async () => {
  const { app } = await playing("x:5");
  expect(app.shows("subtitle")).toBe(false); // 0:00, nothing yet
  await app.keyboard.press("right"); // 0:10
  await app.waitFor("id:subtitle"); // the core's answer comes a moment after the seek
  expect(app.texts()).toContain("The tide is coming in.");
  await app.keyboard.press("right"); // 0:20, the line is over
  await app.waitFor("id:subtitle", { state: "gone" });
});

test("Off takes the subtitles away", async () => {
  const { app, chosen } = await playing("x:5");
  await app.keyboard.press("right"); // 0:10
  await app.waitFor("id:subtitle"); // the core's answer comes a moment after the seek
  await app.press("label:Audio and subtitles");
  await app.press("id:subtitles-off");
  await app.waitUntil(() => chosen.length > 0);
  expect(chosen).toEqual(["off"]);
  await app.waitFor("id:subtitle", { state: "gone" });
});

// The subtitles' box (ours, and mpv's sides): from the picture's height, room at the sides,
// two lines at most.
const LINE = "The tide is coming in.";
const near = (a: number, b: number) => Math.abs(a - b) < 0.05;
const LONG = "Utilizing the footage from Argentina, a virtually complete Metropolis has been reconstructed\nand its proper editing has been restored.\nThe text of the intertitles was taken from German censorship records.";

test("subtitles are 5 % of the picture's height, whatever the window", () => {
  // A TV: 1080 high, its title-safe sides.
  const tv = subtitleFit({ width: 1920, height: 1080 }, undefined, 96, 22, LINE);
  expect(near(tv.size, 54)).toBe(true);
  expect(tv.side).toBe(Math.max(96, 1920 * 0.06));
  // An iPad held upright: a 16:9 frame 432 high in a 1024-high window, not the window's size.
  const ipad = subtitleFit({ width: 768, height: 1024 }, 16 / 9, 24, 15, LINE);
  expect(near(ipad.size, 21.6)).toBe(true);
  expect(near(ipad.side, 768 * 0.06)).toBe(true);
  // A 4:3 film on a 16:9 screen fills its height.
  expect(near(subtitleFit({ width: 1920, height: 1080 }, 4 / 3, 96, 22, LINE).size, 54)).toBe(true);
  // A wide window, a 16:9 picture: the picture's height.
  expect(near(subtitleFit({ width: 2560, height: 900 }, 16 / 9, 40, 22, LINE).size, 45)).toBe(true);
  // A phone held upright: no smaller than reads.
  expect(subtitleFit({ width: 393, height: 852 }, 16 / 9, 20, 10, LINE).size).toBe(MIN_SIZE);
});

test("subtitles take two lines at most: more of their own become one paragraph, a long one gets smaller", () => {
  for (const w of [{ width: 1024, height: 768 }, { width: 1366, height: 1024 }, { width: 1920, height: 1080 }]) {
    const fit = subtitleFit(w, 16 / 9, 24, 15, LONG);
    expect(fit.text.split("\n").length).toBe(1);
    const width = w.width - 2 * fit.side - 30;
    expect(Math.ceil((ems(fit.text) * fit.size) / width)).toBeLessThanOrEqual(2);
  }
  // A narrow window: no smaller than reads, and nothing cut (a third line rather).
  const narrow = subtitleFit({ width: 768, height: 1024 }, 16 / 9, 24, 15, LONG);
  expect(narrow.size).toBe(MIN_SIZE);
  expect(narrow.text.length).toBe(LONG.length);
  // Russian and Japanese are wider per letter than English: they get smaller sooner.
  const ru = "С помощью аргентинского материала было возможно реконструировать и исправить фильм целиком";
  const ja = "アルゼンチンで見つかったフィルムによって、ほぼ完全なメトロポリスが復元され、編集も元に戻された";
  for (const text of [ru, ja]) {
    const fit = subtitleFit({ width: 768, height: 1024 }, 16 / 9, 24, 15, text);
    expect(Math.ceil((ems(fit.text) * fit.size) / (768 - 2 * fit.side - 30))).toBeLessThanOrEqual(2);
  }
  // Two lines of its own that fit stay as they are, at full size.
  const two = subtitleFit({ width: 1920, height: 1080 }, 16 / 9, 96, 22, "- Who's there?\n- Nobody.");
  expect(two.text).toBe("- Who's there?\n- Nobody.");
  expect(near(two.size, 54)).toBe(true);
});

// Where they sit on a phone (points from the window's bottom): 393 × 852 upright, 852 × 393 sideways.
const UPRIGHT = { width: 393, height: 852 };
const SIDEWAYS = { width: 852, height: 393 };
const room = { aspect: 16 / 9, rest: 40, controls: 0, middle: 0, size: 14, gap: 8 };

test("held upright, the subtitles sit at the picture's bottom, not at the window's", () => {
  const frame = 393 / (16 / 9);
  const pictureBottom = (852 - frame) / 2;
  const at = subtitleBottom({ ...room, window: UPRIGHT });
  expect(at).toBeGreaterThan(pictureBottom);
  expect(at).toBeLessThan(pictureBottom + 20);
  // The controls far below the picture do not move them.
  expect(subtitleBottom({ ...room, window: UPRIGHT, controls: 200 })).toBe(at);
});

test("sideways, the subtitles rest at the bottom and rise above the controls", () => {
  expect(subtitleBottom({ ...room, window: SIDEWAYS })).toBe(40);
  expect(subtitleBottom({ ...room, window: SIDEWAYS, controls: 120 })).toBe(120);
});

test("two lines that would reach the middle buttons go over them", () => {
  // The buttons 65 pt tall in the middle: from 164 to 229 pt off the bottom.
  const at = subtitleBottom({ ...room, window: SIDEWAYS, controls: 150, middle: 65 });
  expect(at).toBe(393 / 2 + 65 / 2 + 8);
  // Far enough below them, they stay.
  expect(subtitleBottom({ ...room, window: SIDEWAYS, controls: 60, middle: 65 })).toBe(60);
});

test("the film's own subtitles grow to the least size where the picture is small", () => {
  expect(subtitleScale(SIDEWAYS, 16 / 9)).toBe(1); // 393 pt high: 19.6 pt
  const upright = subtitleScale(UPRIGHT, 16 / 9); // 221 pt high: 11 pt
  expect(Math.abs(upright * (393 / (16 / 9)) * 0.05 - MIN_SIZE)).toBeLessThan(0.001);
});
