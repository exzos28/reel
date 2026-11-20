// The platform layer's capabilities (ui/platform) as the player shows them: a desktop's
// window can fill the screen (a button and F) and has a Back in the window bar's slot;
// a TV has neither (the remote's Back is it).
import { expect, test } from "nsh/test";
import { NATIVE, STILL, openApp, DUNE_FIRST } from "./testEngine";

const engine = {
  ...NATIVE,
  ...DUNE_FIRST,
  ...STILL,
  "Engine.status": JSON.stringify({ phase: "ready", name: "Dune.2021.1080p.BluRay", stream_url: "http://127.0.0.1:8000/torrents/0/stream/0", low_space: false, speed: 3.4, peers: 37, found: 52, start: 100, stage: "starting" }),
};

test("TV: the player offers no full screen and no Back button", async () => {
  const app = await openApp({ clock: {}, modules: { "app/native": engine } });
  await app.press("Play"); // Dune, the hero of a Home with nothing begun
  await app.wait(600);
  expect(app.shows("label:Pause")).toBe(true);
  expect(app.shows("label:Full screen")).toBe(false);
  expect(app.shows("label:Back to Dune")).toBe(false);
  await app.keyboard.press("f");
  expect(app.shows("label:Exit full screen")).toBe(false);
});

test("Mac: the player offers full screen (the button and F) and Back in the window bar's slot", async () => {
  const app = await openApp({ clock: {}, platform: "macos", width: 1440, height: 900, modules: { "app/native": engine } });
  await app.press("label:Movies");
  await app.press("label:Inception >> nth=0");
  await app.press("Resume 41:12");
  await app.wait(600);
  expect(app.shows("label:Full screen")).toBe(true);
  expect(app.shows("label:Back to Inception")).toBe(true);
  await app.keyboard.press("f");
  expect(app.shows("label:Exit full screen")).toBe(true);
  await app.keyboard.press("f");
  expect(app.shows("label:Full screen")).toBe(true);
});

test("TV: the core hears the family before it is asked whether this device saves films", async () => {
  const asked: string[] = [];
  const app = await openApp({
    modules: {
      "app/native": {
        ...engine,
        "Settings.setFamily": (name: string) => (asked.push(`family ${name}`), true),
        "Library.supported": () => (asked.push("supported"), false),
      },
    },
  });
  expect(asked.slice(0, 2)).toEqual(["family tv", "supported"]);
  expect(app.shows("label:Saved")).toBe(false);
});
