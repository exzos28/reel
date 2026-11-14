// Phone and tablet (design/navigation.md, "Tablet" and "Phone"): the tabs,
// each tab keeping its own stack, Settings pushed on the current tab, Back
// from a pushed page.
import { expect, test } from "nsh/test";
import { NATIVE, openApp } from "./testEngine";

const phone = () => openApp({ platform: "ios", width: 393, height: 852, safeArea: { top: 54, bottom: 34, left: 0, right: 0 }, modules: { "app/native": NATIVE } });

test("phone: a bottom tab bar; a tab keeps its place; the selected tab chosen again goes to its root", async () => {
  const app = await phone();
  expect(app.shows("tab-bar")).toBe(true);
  for (const tab of ["Home", "Movies", "Shows", "Anime", "Search"]) expect(app.shows(`label:${tab}`)).toBe(true);
  await app.press("label:Movies");
  expect(app.texts()).toContain("All movies");
  await app.press("label:Dune >> nth=0");
  expect(app.texts()).toContain("1080p BluRay · 8 GB · 412 people sharing");
  expect(app.shows("tab-bar")).toBe(true); // on a pushed page too
  await app.press("label:Shows");
  expect(app.texts()).toContain("All shows");
  await app.press("label:Movies"); // back to Movies: the film is still open
  expect(app.texts()).toContain("1080p BluRay · 8 GB · 412 people sharing");
  await app.press("label:Movies"); // chosen again: its root
  expect(app.texts()).toContain("All movies");
});

test("phone: the back disc over a title's hero goes back; Add to list is the disc across from it", async () => {
  const app = await phone();
  await app.press("label:Movies");
  await app.press("label:Dune >> nth=0");
  expect(app.shows("label:Add to list")).toBe(true);
  await app.press("label:Back");
  expect(app.texts()).toContain("All movies");
});

test("phone: Settings opens from the head on the current tab; Back returns to it", async () => {
  const app = await phone();
  await app.press("label:Settings");
  expect(app.texts()).toContain("Playback buffer");
  expect(app.shows("tab-bar")).toBe(true);
  await app.keyboard.press("escape");
  expect(app.texts()).toContain("Continue watching");
});

test("phone: the player's ✕ closes it", async () => {
  const app = await openApp({
    platform: "ios", width: 852, height: 393, safeArea: { top: 0, bottom: 21, left: 62, right: 62 },
    modules: { "app/native": { ...NATIVE, "Engine.status": '{"phase":"resolving","stage":"finding"}' } },
  });
  await app.press("Resume 41:12");
  expect(app.shows("tab-bar")).toBe(false); // not over the player
  await app.press("label:Close");
  expect(app.texts()).toContain("Continue watching");
});

// The tablet's top row (layout/TouchNav.tsx) is not covered here: a headless
// run reports the phone idiom at any size, and `open` cannot set the idiom.

test("phone: the release button opens the releases in a bottom sheet; ✕ closes it", async () => {
  const app = await phone();
  await app.press("label:Movies");
  await app.press("label:Dune >> nth=0");
  await app.press("1080p BluRay · 8 GB · 412 people sharing"); // the release button
  expect(app.texts()).toContain("3 found, the best of each quality first");
  await app.press("label:Close");
  expect(app.texts()).not.toContain("3 found, the best of each quality first");
  await app.press("label:Back");
  expect(app.texts()).toContain("All movies");
});
