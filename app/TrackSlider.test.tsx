// The slider of the scrubber and the volume (ui/kit/TrackSlider): a tap jumps, a drag follows
// and commits once on release, a vertical swipe leaves it as it was.
import { expect, open, test } from "nsh/test";

// Android: the headless pointer counts a pan from the press, as Android does (on iOS the slider
// counts it from where UIKit recognized it, which the headless runner does not play).
const slider = () => open("./tests/TrackSliderApp.tsx", { clock: {}, platform: "android" });

test("a tap puts it where it lands, once", async () => {
  const app = await slider();
  expect(app.texts()).toContain("value 0.20");
  await app.press("slider"); // its middle
  expect(app.texts()).toContain("value 0.50");
  expect(app.texts()).toContain("commits 1");
  expect(app.texts()).toContain("free");
});

test("a drag follows the finger and commits once, where it is let go", async () => {
  const app = await slider();
  await app.dragAndHold("slider", { x: 60 });
  await app.wait(100);
  expect(app.texts()).toContain("held");
  expect(app.texts()).toContain("scrub 0.70"); // 150 + 60 of 300
  expect(app.texts()).toContain("commits 0"); // nothing sent while it moves
  expect(app.texts()).toContain("value 0.20");
  await app.drop();
  expect(app.texts()).toContain("value 0.70");
  expect(app.texts()).toContain("commits 1");
  expect(app.texts()).toContain("free");
});

test("a drag past the end stops at the end, wherever the finger goes", async () => {
  const app = await slider();
  await app.drag("slider", { x: 400, y: 40 });
  expect(app.texts()).toContain("value 1.00");
  await app.drag("slider", { x: -500 });
  expect(app.texts()).toContain("value 0.00");
  expect(app.texts()).toContain("commits 2");
});

test("a swipe up or down is not a drag: it stays where it was", async () => {
  const app = await slider();
  await app.drag("slider", { y: 200 });
  await app.wait(50);
  expect(app.texts()).toContain("value 0.20");
  expect(app.texts()).toContain("commits 0");
  expect(app.texts()).toContain("scrub none");
  expect(app.texts()).toContain("free");
});
