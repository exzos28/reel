import { expect, open, test } from "nsh/test";

test("home starts in English on the open films and moves focus with arrows", async () => {
  const app = await open("./App.tsx");
  expect(app.texts()).toContain("2010, 15 min, directed by Colin Levy");
  await app.keyboard.press("right");
  expect(app.texts()).toContain("2008, 10 min, directed by Sacha Goedegebure");
  await app.keyboard.press("down");
  expect(app.texts()).toContain("1927, 2 h 33 min, directed by Fritz Lang");
});

test("a film without a source says so instead of playing", async () => {
  const app = await open("./App.tsx");
  await app.keyboard.press("down");
  await app.keyboard.press("enter");
  expect(app.texts()).toContain("No source for this film yet. Try one from Free to watch.");
  await app.keyboard.press("escape");
  expect(app.texts()).toContain("Continue watching");
});

test("pressing Watch opens the player", async () => {
  // The engine as it is while it looks for the film's metadata.
  const app = await open("./App.tsx", {
    modules: { "app/native": { "Engine.start": 8000, "Engine.add": 1, "Engine.status": '{"state":"resolving"}' } },
  });
  await app.press("Watch");
  expect(app.shows("label:Back")).toBe(true);
  expect(app.texts()).toContain("Finding peers…");
});
