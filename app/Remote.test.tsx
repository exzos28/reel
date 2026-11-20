// The TV remote's focus (an Android TV, as `openApp` opens the app): where Up, Back and OK go,
// what the focused control shows.
import { expect, test } from "nsh/test";
import { NATIVE, openApp } from "./testEngine";

type Native = Record<string, {} | null>;
const app_ = (native: Native = NATIVE) => openApp({ modules: { "app/native": native } });

test("TV: Up from Home's hero goes to Home in the nav, wherever the nav was left", async () => {
  const app = await app_();
  await app.keyboard.press("up"); // the hero
  await app.keyboard.press("up"); // the nav, on Home
  for (let i = 0; i < 6; i++) await app.keyboard.press("right"); // Movies … Settings
  await app.keyboard.press("down"); // the hero again
  await app.keyboard.press("up"); // the nav: on Home, not on Settings
  await app.keyboard.press("enter"); // Home chosen again: Home stays
  expect(app.texts()).toContain("Continue watching");
  expect(app.texts()).not.toContain("Playback buffer");
});

test("TV: Up from Trending goes to the page's own item in the nav", async () => {
  const app = await app_();
  await app.keyboard.press("up");
  await app.keyboard.press("up");
  await app.keyboard.press("right"); // Movies
  await app.keyboard.press("enter");
  expect(app.texts()).toContain("All movies");
  await app.keyboard.press("right"); // Series, left in the nav
  await app.keyboard.press("down"); // into the page
  await app.keyboard.press("up"); // the nav: on Movies again
  await app.keyboard.press("enter");
  expect(app.texts()).toContain("All movies");
});

test("TV: the hero's way to the title's page is a button that says Details", async () => {
  const app = await app_();
  expect(app.texts()).toContain("Details");
  await app.keyboard.press("up"); // the hero, on Resume
  await app.keyboard.press("right");
  await app.keyboard.press("right"); // Details
  await app.keyboard.press("enter");
  expect(app.texts()).toContain("Director");
});

test("TV: the split Play is one focus ring; the part with the focus stays white, the other turns grey", async () => {
  const app = await app_();
  await app.keyboard.press("enter"); // Inception's page, the focus on Play
  expect(app.shows("split-play")).toBe(true);
  const more = () => app.viewStyle("split-play-more")?.backgroundColor;
  const onPlay = more();
  await app.keyboard.press("right"); // ⌄
  const onMore = more();
  expect(onMore).not.toBe(onPlay);
  await app.keyboard.press("down"); // off the split: both parts white again
  expect(more()).toBe(onMore);
});
