// The player's own controls, on a stand-in engine and a still video view
// (STILL: it plays its first frame at once and stands still, so the time
// stays where seeks put it); and the stage before the first frame.
import { expect, test } from "nsh/test";
import { episode, HOME, homeOf, NATIVE, STILL, openApp, DUNE_FIRST } from "./testEngine";
import { turnedInsets } from "./ui/layout/surface";

/** Home with Attack on Titan watched last: the hero. */
const AOT_FIRST = { "Catalog.home": homeOf(HOME.map((s) => (s.id === "continue" ? { ...s, items: [...s.items].reverse() } : s))) };

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
    modules: { "app/native": { ...NATIVE, ...DUNE_FIRST, ...STILL, ...DETAILS, "Engine.status": status, "Engine.timeline": timeline } },
  });
  await app.press("Play"); // Dune, the hero of a Home with nothing begun
  await app.wait(600); // one poll of the engine
  return app;
}

/** Play on Dune with the engine answering `engine` and the video never loading. */
async function waiting(engine: Record<string, unknown>) {
  const app = await openApp({
    clock: {},
    modules: { "app/native": { ...NATIVE, ...DUNE_FIRST, ...DETAILS, "Engine.status": JSON.stringify(engine) } },
  });
  await app.press("Play"); // Dune, the hero of a Home with nothing begun
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
  expect(app.texts()).toContain("Finding people sharing it");
  noControls(app);
  await app.keyboard.press("enter"); // nothing to play or pause yet
  noControls(app);
  await app.keyboard.press("escape"); // Back leaves at once
  expect(app.texts()).toContain("Trending movies");
});

test("connected, the stage counts the film's start in until the video loads", async () => {
  const app = await waiting({ ...JSON.parse(status), stage: "connecting", peers: 0, found: 12, start: 0 });
  expect(app.texts()).toContain("Found 12 people, connecting");
  noControls(app);
  const fetching = await waiting({ ...JSON.parse(status), stage: "fetching", start: 42 });
  expect(fetching.texts()).toContain("Fetching the start, 42%");
  expect(fetching.texts()).toContain("streaming at 3.4 MB/s from 37 people");
  noControls(fetching);
  const starting = await waiting(JSON.parse(status));
  expect(starting.texts()).toContain("Starting");
  noControls(starting);
  await starting.keyboard.press("escape"); // the remote's Back
  expect(starting.texts()).toContain("Trending movies");
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
  await app.wait(5100);
  expect(app.texts()).not.toContain("streaming at 3.4 MB/s from 37 people");
  await app.keyboard.press("down");
  expect(app.texts()).toContain("streaming at 3.4 MB/s from 37 people");
  await app.wait(5100);
  expect(app.texts()).not.toContain("streaming at 3.4 MB/s from 37 people");
});

test("a press anywhere brings the overlay back", async () => {
  const app = await playing();
  await app.wait(5100);
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
  await app.wait(5100);
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

// A remote's media keys (Android TV's come as F7 to F11).
test("the remote's media keys: rewind and fast forward step 10 seconds, play/pause, play and pause", async () => {
  const app = await playing();
  await app.keyboard.press("f9");
  await app.keyboard.press("f9");
  expect(app.texts()).toContain("0:20");
  await app.keyboard.press("f7");
  expect(app.texts()).toContain("0:10");
  await app.keyboard.press("f8");
  expect(app.shows("label:Play")).toBe(true); // paused
  await app.keyboard.press("f8");
  expect(app.shows("label:Pause")).toBe(true);
  await app.keyboard.press("f10"); // play: it plays already
  expect(app.shows("label:Pause")).toBe(true);
});

test("F11 pauses where the system leaves it to the app (not Android, Linux, Windows: their full screen)", async () => {
  const app = await phonePlaying(PORTRAIT);
  await app.keyboard.press("f11");
  expect(app.shows("label:Play")).toBe(true);
  await app.keyboard.press("f10");
  expect(app.shows("label:Pause")).toBe(true);
});

test("down moves to the buttons; left and right pick one, enter runs it", async () => {
  const app = await playing();
  await app.keyboard.press("down"); // on play/pause
  expect(app.shows("label:Pause")).toBe(true);
  expect(app.texts()).not.toContain("Pause"); // no caption over the buttons, the icon only
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
});

test("escape hides the overlay first, then leaves the player", async () => {
  const app = await playing();
  await app.keyboard.press("escape");
  expect(app.texts()).not.toContain("streaming at 3.4 MB/s from 37 people");
  expect(app.texts()).not.toContain("Trending movies");
  await app.keyboard.press("escape");
  expect(app.texts()).toContain("Trending movies");
});

test("hidden, the remote is back on the scrubber", async () => {
  const app = await playing();
  await app.keyboard.press("down");
  await app.wait(5100);
  await app.keyboard.press("right");
  expect(app.texts()).toContain("0:10");
});

const nextEpisode = JSON.stringify(episode(3, "Old Story"));

async function nearTheEnd() {
  const app = await openApp({
    clock: {},
    // The core offers the next episode (as it does in the last 40 s).
    modules: { "app/native": { ...NATIVE, ...AOT_FIRST, ...STILL, "Engine.status": status, "Engine.timeline": timeline, "Catalog.upNext": nextEpisode } },
  });
  await app.press("Resume S3:E2 · 10:00"); // the hero: Attack on Titan, watched last
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
    modules: { "app/native": { ...NATIVE, ...DUNE_FIRST, ...STILL, "Engine.status": status, "Engine.timeline": timeline } },
  });
  await app.press("Play"); // Dune, the hero of a Home with nothing begun
  await app.wait(600);
  expect(app.shows("scrubber")).toBe(true);
  expect(app.texts()).not.toContain("streaming at 3.4 MB/s from 37 people");
});

test("Mac: the Back in the window bar's slot closes the player, while it starts and while it plays", async () => {
  for (const engine of [{ ...NATIVE, ...DETAILS, "Engine.status": JSON.stringify({ phase: "resolving", stage: "finding" }) }, { ...NATIVE, ...STILL, ...DETAILS, "Engine.status": status, "Engine.timeline": timeline }]) {
    const app = await openApp({ clock: {}, platform: "macos", width: 1440, height: 900, modules: { "app/native": engine } });
    await app.press("label:Movies");
    await app.press("label:Inception >> nth=0");
    await app.press("Resume 41:12");
    await app.wait(600);
    expect(app.shows("stage") || app.shows("scrubber")).toBe(true);
    await app.press("label:Back to Inception");
    expect(app.shows("stage")).toBe(false);
    expect(app.shows("scrubber")).toBe(false);
  }
});

// A phone: the tracks and the episodes are sheets (from the bottom; at the right held sideways)
// with their own ✕, not panels over the picture.
const PORTRAIT = { width: 393, height: 852, safeArea: { top: 54, bottom: 34, left: 0, right: 0 } };
const SIDEWAYS = { width: 852, height: 393, safeArea: { top: 0, bottom: 21, left: 62, right: 62 } };

/** A picture taller than wide: a phone's player stands upright once it loads (its layout there is
 * the window's, as headless tests lay it out: they do not apply the turned player's transform, so
 * its edges lie outside their screen). */
const UPRIGHT = { "VideoEngine.sideways": false };

async function phonePlaying(screen: typeof PORTRAIT, over: Record<string, unknown> = {}, start = "Play", modules: Record<string, Record<string, unknown>> = {}) {
  const app = await openApp({
    platform: "ios", ...screen, clock: {},
    modules: { ...modules, "app/native": { ...NATIVE, ...DUNE_FIRST, ...STILL, "Engine.status": status, "Engine.timeline": timeline, ...over } },
  });
  await app.press(start);
  await app.wait(600);
  return app;
}

test("phone: Audio and subtitles is a sheet, one list at a time under Audio, Subtitles and Release", async () => {
  const app = await phonePlaying(PORTRAIT, UPRIGHT);
  await app.press("label:Audio and subtitles");
  expect(app.shows("tracks-panel")).toBe(true);
  expect(app.shows("tracks-grabber")).toBe(true); // from the bottom
  expect(app.shows("id:audio-original")).toBe(true);
  expect(app.shows("id:subtitles-off")).toBe(false);
  await app.press("id:tracks-tab-1"); // Subtitles
  expect(app.shows("id:subtitles-off")).toBe(true);
  expect(app.shows("id:audio-original")).toBe(false);
  await app.press("id:tracks-tab-2"); // Release
  expect(app.texts()).toContain("720p WEB");
  await app.press("id:release-0");
  expect(app.shows("tracks-panel")).toBe(true); // a pick keeps it open
  await app.drag("id:release-0", { y: 400 }); // a swipe down on the sheet closes the sheet only
  await app.wait(600);
  expect(app.shows("scrubber")).toBe(true);
  if (!app.shows("tracks-panel")) await app.press("label:Audio and subtitles");
  await app.press("id:tracks-close"); // the sheet's ✕, not the player's
  await app.wait(600);
  expect(app.shows("tracks-panel")).toBe(false);
  expect(app.shows("scrubber")).toBe(true);
});

test("phone held sideways: the tracks are a sheet at the right; Back closes it, not the player", async () => {
  const app = await phonePlaying(SIDEWAYS);
  await app.press("label:Audio and subtitles");
  expect(app.shows("tracks-panel")).toBe(true);
  expect(app.shows("tracks-grabber")).toBe(false); // at the right, the full height
  await app.keyboard.press("escape");
  await app.wait(600);
  expect(app.shows("tracks-panel")).toBe(false);
  expect(app.shows("scrubber")).toBe(true);
});

test("phone: Episodes is a sheet titled with the season and its count, the numbers in their own column", async () => {
  const app = await phonePlaying(PORTRAIT, { ...AOT_FIRST, ...UPRIGHT }, "Resume S3:E2 · 10:00");
  await app.press("label:Episodes");
  expect(app.shows("episodes-panel")).toBe(true);
  expect(app.texts()).toContain("Season 3 · 4 episodes");
  expect(app.texts()).toContain("Old Story"); // not "3. Old Story"
  expect(app.texts()).not.toContain("3. Old Story");
  await app.keyboard.press("escape");
  await app.wait(600);
  expect(app.shows("episodes-panel")).toBe(false);
  expect(app.shows("scrubber")).toBe(true);
  await app.press("label:Episodes");
  await app.press("id:episodes-close");
  await app.wait(600);
  expect(app.shows("episodes-panel")).toBe(false);
  expect(app.shows("scrubber")).toBe(true);
});

test("phone: an episode picked in the Episodes sheet plays", async () => {
  const app = await phonePlaying(PORTRAIT, { ...AOT_FIRST, ...UPRIGHT }, "Resume S3:E2 · 10:00");
  await app.press("label:Episodes");
  await app.press("Old Story");
  await app.wait(600);
  expect(app.shows("episodes-panel")).toBe(false);
  expect(app.texts()).toContain("S3:E3 · Pain");
});

test("phone: Play and ±10 s sit in the middle of the picture, the rest at the top", async () => {
  const app = await phonePlaying(PORTRAIT, UPRIGHT);
  expect(app.shows("player-middle")).toBe(true);
  expect(app.shows("label:Pause")).toBe(true);
  expect(app.shows("label:Back 10 seconds")).toBe(true);
  expect(app.shows("label:Forward 10 seconds")).toBe(true);
  expect(app.shows("label:Audio and subtitles")).toBe(true);
  expect(app.shows("label:Rotate screen")).toBe(true);
  await app.press("label:Pause");
  expect(app.shows("label:Play")).toBe(true);
});

test("iPad: no Rotate in the player (its window does not turn for an app); the ✕ at the corner", async () => {
  const app = await phonePlaying({ width: 1180, height: 820, safeArea: { top: 24, bottom: 20, left: 0, right: 0 } }, {}, "Play", { nsh: { "platform.idiom": "pad" } });
  expect(app.shows("label:Audio and subtitles")).toBe(true);
  expect(app.shows("label:Rotate screen")).toBe(false);
  expect(app.shows("label:Close")).toBe(true);
});

// The core's answer for a picture: sideways unless it is taller than wide.
const sidewaysUnlessTall = (w: number, h: number) => !(w > 0 && h > w);

// A phone's interface never turns: the player draws itself sideways inside the upright window
// (layout/TurnedBox), a box of the window's size the other way round, turned a quarter.
/** How the device is held, as `VideoEngine.held` answers: the angle and the count of its turns. */
const heldAs = (turn: number | null, turns = 0) => JSON.stringify({ turn, turns });
/** Runs a phone player's button `index` from the keys: −10 s, Play, +10 s, then the top's. */
async function runButton(app: Awaited<ReturnType<typeof phonePlaying>>, index: number) {
  await app.keyboard.press("down");
  for (let i = 0; i < 6; i++) await app.keyboard.press("left");
  for (let i = 0; i < index; i++) await app.keyboard.press("right");
  await app.keyboard.press("enter");
}
/** The buttons' places: Audio and subtitles, then Episodes (a series) and Rotate. */
const TRACKS = 3;
/** The angle the player is turned to: 90 clockwise (the common way), -90 the other way, 0 upright. */
const angleOf = (app: Awaited<ReturnType<typeof phonePlaying>>) =>
  app.shows("player-turned") ? 90 : app.shows("player-turned-other") ? -90 : app.shows("player-upright") ? 0 : null;

test("turned insets: the screen's insets on the sides of the box they are on", () => {
  const screen = { top: 54, right: 0, bottom: 34, left: 0 };
  // Clockwise: the box's left is the screen's top (the Dynamic Island), its right the home indicator.
  expect(turnedInsets(screen, 90)).toEqual({ top: 0, right: 34, bottom: 0, left: 54 });
  expect(turnedInsets(screen, -90)).toEqual({ top: 0, right: 54, bottom: 0, left: 34 });
  expect(turnedInsets(screen, 0)).toEqual(screen);
});

test("phone: the player opens drawn sideways in the upright window, before the film loads; the system is asked for no turn", async () => {
  const immersive: boolean[] = [];
  const app = await openApp({
    platform: "ios", ...PORTRAIT, clock: {},
    // The engine still looks for people: no video view yet.
    modules: { "app/native": { ...NATIVE, ...DUNE_FIRST, "Engine.status": JSON.stringify({ phase: "resolving", stage: "finding" }), "VideoEngine.immersive": (on: boolean) => { immersive.push(on); } } },
  });
  await app.press("Play");
  await app.wait(600);
  expect(app.shows("stage")).toBe(true);
  expect(app.shows("player-turned")).toBe(true);
  expect(immersive).toEqual([true]); // the home indicator fades
  await app.keyboard.press("escape"); // Back
  await app.wait(600);
  expect(app.shows("player")).toBe(false);
  expect(immersive).toEqual([true, false]);
});

test("phone: a wide film stays sideways once it loads; a picture taller than wide stands it upright", async () => {
  const wide = await phonePlaying(PORTRAIT, { "VideoEngine.sideways": sidewaysUnlessTall });
  expect(wide.shows("scrubber")).toBe(true);
  expect(angleOf(wide)).toBe(90);
  const tall = await phonePlaying(PORTRAIT, UPRIGHT);
  expect(angleOf(tall)).toBe(0);
});

test("phone: Rotate turns the player sideways and stands it back upright", async () => {
  const app = await phonePlaying(PORTRAIT, UPRIGHT);
  await app.press("label:Rotate screen");
  await app.wait(600);
  expect(angleOf(app)).toBe(90);
  expect(app.shows("scrubber")).toBe(true);
  await runButton(app, TRACKS + 1); // Rotate, from the keys (its place is off the headless screen)
  await app.wait(600);
  expect(angleOf(app)).toBe(0);
});

test("phone: the player turns towards how the device is held: the other way when its top is at the right", async () => {
  const opened = await phonePlaying(PORTRAIT, { "VideoEngine.held": heldAs(-90) });
  expect(angleOf(opened)).toBe(-90);
  const rotated = await phonePlaying(PORTRAIT, { ...UPRIGHT, "VideoEngine.held": heldAs(-90) });
  await rotated.press("label:Rotate screen");
  expect(angleOf(rotated)).toBe(-90);
  // Upright or not known: the common way.
  for (const held of [heldAs(0), heldAs(null)]) expect(angleOf(await phonePlaying(PORTRAIT, { "VideoEngine.held": held }))).toBe(90);
});

test("phone: the player follows the device as it turns (rotation lock off); a reading that does not change turns nothing", async () => {
  let held = heldAs(0, 3);
  const app = await phonePlaying(PORTRAIT, { "VideoEngine.held": () => held });
  expect(angleOf(app)).toBe(90); // it opened sideways, held upright
  await app.wait(1000);
  expect(angleOf(app)).toBe(90); // upright as at the start: no turn (with the lock on iOS says no more)
  held = heldAs(-90, 4);
  await app.wait(600);
  expect(angleOf(app)).toBe(-90);
  held = heldAs(0, 5);
  await app.wait(600);
  expect(angleOf(app)).toBe(0);
  held = heldAs(null, 6); // flat on a table: as it was
  await app.wait(600);
  expect(angleOf(app)).toBe(0);
  held = heldAs(90, 7);
  await app.wait(600);
  expect(angleOf(app)).toBe(90);
});

test("phone with a screen reader: the player opens upright and does not follow the device; Rotate turns it", async () => {
  let held = heldAs(0);
  const app = await phonePlaying(PORTRAIT, { "VideoEngine.held": () => held }, "Play", { nsh: { screenReaderEnabled: true } });
  expect(app.shows("player-upright")).toBe(true);
  held = heldAs(90, 1);
  await app.wait(600);
  expect(app.shows("player-upright")).toBe(true);
  await app.press("label:Rotate screen");
  await app.wait(600);
  expect(app.shows("player-turned")).toBe(true);
});

test("iPad: the player is the window's, never turned", async () => {
  const app = await phonePlaying({ width: 1180, height: 820, safeArea: { top: 24, bottom: 20, left: 0, right: 0 } }, {}, "Play", { nsh: { "platform.idiom": "pad" } });
  expect(app.shows("scrubber")).toBe(true);
  expect(app.shows("player-turned")).toBe(false);
  expect(app.shows("player-upright")).toBe(false);
});

// NSH's Sheet is a dialog of its own, which shows the window's way up: in the turned player the
// drawers are drawn in place, at the box's right.
test("phone turned: Audio and subtitles are drawn in place at the box's right; Back closes them, not the player", async () => {
  const app = await phonePlaying(PORTRAIT);
  await runButton(app, TRACKS);
  expect(app.shows("tracks-panel")).toBe(true);
  expect(app.shows("tracks-sheet")).toBe(false); // no dialog
  expect(app.shows("tracks-grabber")).toBe(false); // the side's, not from the bottom
  await app.keyboard.press("escape");
  await app.wait(600);
  expect(app.shows("tracks-panel")).toBe(false);
  expect(app.shows("scrubber")).toBe(true);
  await app.keyboard.press("enter"); // the keys are still on it
  expect(app.shows("tracks-panel")).toBe(true);
  await app.press("id:tracks-backdrop"); // a tap beside it
  expect(app.shows("tracks-panel")).toBe(false);
});

test("phone turned: Episodes are drawn in place; Back closes them; a turn closes an open drawer", async () => {
  let held = heldAs(0, 0);
  const app = await phonePlaying(PORTRAIT, { ...AOT_FIRST, "VideoEngine.held": () => held }, "Resume S3:E2 · 10:00");
  await runButton(app, TRACKS + 1);
  expect(app.shows("episodes-panel")).toBe(true);
  expect(app.shows("episodes-sheet")).toBe(false);
  expect(app.texts()).toContain("Season 3 · 4 episodes");
  await app.keyboard.press("escape");
  expect(app.shows("episodes-panel")).toBe(false);
  expect(app.shows("scrubber")).toBe(true);
  await app.keyboard.press("enter"); // the keys are still on it
  expect(app.shows("episodes-panel")).toBe(true);
  held = heldAs(0, 1); // the device stood upright
  await app.wait(600);
  expect(app.shows("player-upright")).toBe(true);
  expect(app.shows("episodes-panel")).toBe(false);
});

// The scrubber and the volume are sliders (ui/kit/TrackSlider): a drag holds the controls up and
// sideways drags are theirs; a swipe down from the scrubber still closes the player.
test("phone: a drag on the scrubber keeps the controls up until it is let go", async () => {
  const app = await phonePlaying(PORTRAIT, UPRIGHT);
  await app.dragAndHold("scrubber", { x: 60 });
  await app.wait(7000); // longer than the controls stay on their own
  expect(app.shows("scrubber")).toBe(true);
  await app.drop();
  expect(app.shows("scrubber")).toBe(true);
  await app.wait(5100);
  expect(app.shows("scrubber")).toBe(false);
});

test("phone: sideways on the scrubber is not the swipe that closes; down is", async () => {
  for (const over of [UPRIGHT, {}]) {
  const app = await phonePlaying(PORTRAIT, over); // upright, and turned (its pan in the box)
  await app.drag("scrubber", { x: -120, y: 30 });
  await app.wait(600);
  expect(app.shows("scrubber")).toBe(true);
  await app.drag("scrubber", { y: 300 });
  await app.wait(600);
  expect(app.shows("scrubber")).toBe(false);
  expect(app.shows("player")).toBe(false);
  }
});

test("Mac: a drag on the volume keeps the controls up until it is let go", async () => {
  const app = await openApp({ clock: {}, platform: "macos", width: 1440, height: 900, modules: { "app/native": { ...NATIVE, ...DUNE_FIRST, ...STILL, "Engine.status": status, "Engine.timeline": timeline } } });
  await app.press("Play");
  await app.wait(600);
  await app.dragAndHold("volume", { x: -40 });
  await app.wait(7000);
  expect(app.shows("volume")).toBe(true);
  await app.drop();
  await app.wait(5100);
  expect(app.shows("volume")).toBe(false);
});

// Another episode plays in the same player: on iOS the player is a dialog of its own, and going
// through "nothing plays" closed it and opened another over the one leaving (a blank screen).
test("phone: an episode picked in the Episodes sheet plays in the same player, which stays up", async () => {
  const app = await phonePlaying(PORTRAIT, { ...AOT_FIRST, ...UPRIGHT }, "Resume S3:E2 · 10:00");
  await app.press("label:Rotate screen"); // sideways: the viewer's choice
  await app.wait(600);
  await runButton(app, TRACKS + 1); // Episodes
  await app.keyboard.press("down"); // the next one
  await app.keyboard.press("enter");
  expect(app.shows("player-host")).toBe(true); // never closed on the way
  await app.wait(600);
  expect(app.shows("player-host")).toBe(true);
  expect(app.shows("scrubber")).toBe(true);
  expect(app.texts()).toContain("S3:E3 · Pain");
  // The player was not torn down, and the next episode keeps the way the viewer turned it
  // (a tall picture stands only the first one upright).
  expect(app.shows("player-turned")).toBe(true);
});

test("phone: Up next plays the next episode in the same player", async () => {
  const app = await phonePlaying(PORTRAIT, { ...AOT_FIRST, ...UPRIGHT, "Catalog.upNext": nextEpisode }, "Resume S3:E2 · 10:00");
  expect(app.texts()).toContain("Next episode · S3:E3");
  await app.press("label:Play now");
  expect(app.shows("player-host")).toBe(true);
  await app.wait(600);
  expect(app.shows("player-host")).toBe(true);
  await app.press("label:Watch credits"); // the next one's card: the controls come back
  expect(app.shows("scrubber")).toBe(true);
});

test("phone: back from the background, the player keeps the way it is turned", async () => {
  const app = await phonePlaying(PORTRAIT, UPRIGHT);
  await app.press("label:Rotate screen"); // sideways
  await app.wait(600);
  await app.setLifecycle("background");
  await app.setLifecycle("active");
  await app.wait(600);
  expect(app.shows("player-turned")).toBe(true);
});

// A saved film has no releases to switch to: no empty Release list.
const SAVED_TRACKS = { "Catalog.tracks": JSON.stringify({ audio: [{ key: "original", selected: true }], subtitles: [{ key: "off", selected: true }], releases: [] }) };

test("phone: a film without releases has no Release list in its tracks", async () => {
  const app = await phonePlaying(PORTRAIT, { ...SAVED_TRACKS, ...UPRIGHT });
  await app.press("label:Audio and subtitles");
  expect(app.shows("id:tracks-tab-1")).toBe(true);
  expect(app.shows("id:tracks-tab-2")).toBe(false);
});

test("iPad: a film without releases has no Release column in its tracks", async () => {
  const app = await phonePlaying({ width: 1180, height: 820, safeArea: { top: 24, bottom: 20, left: 0, right: 0 } }, SAVED_TRACKS, "Play", { nsh: { "platform.idiom": "pad" } });
  await app.press("label:Audio and subtitles");
  expect(app.texts()).toContain("Subtitles");
  expect(app.texts()).not.toContain("Release");
});

test("phone: the secondary buttons sit at the top, the bottom keeps the timeline", async () => {
  for (const screen of [PORTRAIT, SIDEWAYS]) {
    const app = await phonePlaying(screen, UPRIGHT);
    expect(app.shows("player-top-buttons")).toBe(true);
    expect(app.shows("player-top-buttons >> label:Audio and subtitles")).toBe(true);
    expect(app.shows("player-top-buttons >> label:Rotate screen")).toBe(true);
    expect(app.shows("scrubber")).toBe(true);
  }
});

// A phone's middle has Play: the waiting line is in the bottom row, between the times, and the
// controls stay up while it waits.
test("phone: a slow seek's waiting line is in the bottom row between the times, not over Play", async () => {
  for (const screen of [PORTRAIT, SIDEWAYS]) {
    const app = await phonePlaying(screen, {
      ...DETAILS,
      // The place comes long after it is asked for.
      "Engine.seek": () => new Promise<string>((r) => setTimeout(() => r(JSON.stringify({ state: "ready" })), 9000)),
    });
    await app.press("label:Forward 10 seconds");
    await app.wait(1500); // the press rested: the place is asked for, and takes long
    expect(app.shows("player-bottom >> buffering")).toBe(true);
    expect(app.texts()).toContain("Waiting for the stream · 3.4 MB/s");
    expect(app.shows("player-middle >> label:Pause")).toBe(true);
    await app.wait(6000); // longer than the controls stay on their own
    expect(app.shows("player-bottom >> buffering")).toBe(true);
    expect(app.shows("scrubber")).toBe(true);
  }
});

test("iPad: the waiting line stays a note at the picture's middle", async () => {
  const app = await phonePlaying({ width: 1180, height: 820, safeArea: { top: 24, bottom: 20, left: 0, right: 0 } }, {
    "Engine.seek": () => new Promise<string>((r) => setTimeout(() => r(JSON.stringify({ state: "ready" })), 3000)),
  }, "Play", { nsh: { "platform.idiom": "pad" } });
  await app.press("label:Forward 10 seconds");
  await app.wait(1500);
  expect(app.shows("buffering")).toBe(true);
  expect(app.shows("player-bottom >> buffering")).toBe(false);
});
