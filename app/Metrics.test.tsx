// Where a page's parts go per family (ui/layout/metrics.ts): what is over a page never covers
// its title or a hero's text, and the room under it clears the system's bars.
import { expect, test } from "nsh/test";
import { computeMetrics, heroBox, heroTopFor, type MetricsInput, type NavPlace, type PageKind } from "./ui/layout/metrics";
import { contentWidthFor, sideInsetFor, sideSafeAreaFor } from "./ui/layout/chrome";
import { NATIVE, openApp } from "./testEngine";

const families: { name: string; nav: NavPlace; unit: number; safeTop: number; safeBottom: number }[] = [
  { name: "TV", nav: "page", unit: 1, safeTop: 0, safeBottom: 0 },
  { name: "desktop", nav: "window-bar", unit: 0.66, safeTop: 0, safeBottom: 0 },
  { name: "tablet", nav: "top-row", unit: 0.66, safeTop: 24, safeBottom: 20 },
  { name: "phone", nav: "tab-bar", unit: 0.45, safeTop: 54, safeBottom: 34 },
  { name: "phone landscape", nav: "tab-bar", unit: 0.45, safeTop: 0, safeBottom: 21 },
];
const kinds: PageKind[] = ["root", "title", "deep"];
const input = (f: (typeof families)[number], kind: PageKind): MetricsInput => ({ ...f, kind, tabRow: 80 });

test("what is over a page clears the status bar, and the title stands under it", () => {
  for (const f of families)
    for (const kind of kinds) {
      const m = computeMetrics(input(f, kind));
      expect(m.headBottom >= f.safeTop).toBe(true);
      expect(m.titleTop > m.headBottom).toBe(true);
    }
});

test("a family's pages put their titles at one height (the gap under what is over them)", () => {
  for (const f of families) {
    const gaps = kinds.map((k) => {
      const m = computeMetrics(input(f, k));
      return Math.round((m.titleTop - m.headBottom) * 1000);
    });
    expect(new Set(gaps).size).toBe(1);
  }
});

test("a phone: nothing over a root page but the status bar (Home's tabs on a category's); Back's on a deep page; the tab bar under the content", () => {
  const phone = families[3];
  expect(computeMetrics(input(phone, "root")).headBottom).toBe(54);
  expect(computeMetrics({ ...input(phone, "root"), category: true }).headBottom).toBe(54 + 44 + 28);
  expect(computeMetrics(input(phone, "deep")).headBottom).toBe(54 + 52);
  expect(computeMetrics(input(phone, "root")).bottomRoom >= 34 + 80).toBe(true);
});

test("a hero's text starts under what is over the page, at its design's place where that is lower", () => {
  // A phone's title: the discs under the status bar reach lower than the design's 176 TV px.
  const phone = computeMetrics(input(families[3], "title"));
  expect(heroTopFor(phone, 0.45, 176) >= phone.headBottom).toBe(true);
  // A TV keeps its design.
  const tv = computeMetrics(input(families[0], "title"));
  expect(heroTopFor(tv, 1, 176)).toBe(176);
});

test("a desktop's content column: 1680 at least (1280 in an ultra-wide window), a 16:9 screen of the window's height, 2560 at most", () => {
  expect(contentWidthFor(1440, 900)).toBe(1440);
  expect(contentWidthFor(1920, 900)).toBe(1680);
  // Ultra-wide (wider than 2.2 of its height): 3:2 of the height, 1280 at least.
  expect(contentWidthFor(3008, 1329)).toBe(1993.5);
  expect(contentWidthFor(2560, 900)).toBe(1350);
  expect(contentWidthFor(2560, 600)).toBe(1280);
  expect(Math.round(contentWidthFor(2000, 1250))).toBe(2000);
  expect(contentWidthFor(2560, 1440)).toBe(2560);
  expect(contentWidthFor(3440, 1440)).toBe(2160);
  expect(contentWidthFor(5120, 1440)).toBe(2160);
  // The inset: the family's margin in an ordinary window, what centres the column in a wide one.
  expect(sideInsetFor(1440, 900, 64)).toBe(64);
  expect(sideInsetFor(2000, 1250, 64)).toBe(64);
  expect(sideInsetFor(1920, 900, 64)).toBe(120);
  expect(sideInsetFor(3440, 1440, 64)).toBe(640);
  expect(sideInsetFor(5120, 1440, 64)).toBe(1480);
});

test("a hero's box: a TV's and touch's are the design's; a desktop's grows with the window and its still shows most of the frame", () => {
  // A TV: the design's height, the still from `left` to the right edge.
  expect(heroBox({ height: 640, left: 0, width: 1920, windowHeight: 1080, desktop: false })).toEqual({ height: 640, stillWidth: 1920, stillLeft: 0, stillRight: 0, stillFadeRight: 0, stillBelow: 0 });
  expect(heroBox({ height: 422, left: 343, width: 1440, windowHeight: 900, desktop: false })).toEqual({ height: 422, stillWidth: 1097, stillLeft: 343, stillRight: 0, stillFadeRight: 0, stillBelow: 0 });
  const shown = (b: { height: number; stillWidth: number }) => b.height / ((b.stillWidth * 9) / 16);
  // A desktop: never under the design's height, at most 60% of the window's.
  const mac = heroBox({ height: 515, left: 0, width: 1440, windowHeight: 900, desktop: true });
  expect(mac.height).toBe(540);
  expect(mac.stillWidth).toBe(1440);
  expect(heroBox({ height: 515, left: 0, width: 1440, windowHeight: 700, desktop: true }).height).toBe(515);
  // The user's 2000 x 1250 window: taller, and the still no longer cut to its top half.
  const wide = heroBox({ height: 515, left: 0, width: 2000, windowHeight: 1250, desktop: true });
  expect(wide.height).toBe(750);
  expect(shown(wide) > 0.62).toBe(true);
  // Ultra-wide: the still is no wider than shows 62% of its frame, anchored right.
  for (const width of [3440, 5120]) {
    const b = heroBox({ height: 515, left: 0, width, windowHeight: 1440, desktop: true });
    expect(b.height).toBe(864);
    expect(Math.abs(shown(b) - 0.62) < 1e-9).toBe(true);
    expect(Math.abs(b.stillLeft + b.stillWidth - width) < 1e-9).toBe(true);
  }
  // A title's backdrop that starts further in keeps that start where the window is narrow.
  expect(heroBox({ height: 422, left: 343, width: 1440, windowHeight: 900, desktop: true }).stillLeft).toBe(343);
});

test("phone: About has Back and its title (no system header) over the Settings tab; Back goes back", async () => {
  const app = await openApp({ platform: "ios", width: 393, height: 852, safeArea: { top: 54, bottom: 34, left: 0, right: 0 }, modules: { "app/native": NATIVE } });
  await app.press("label:Settings");
  expect(app.shows("back-head")).toBe(false);
  await app.press("About reel");
  expect(app.shows("back-head")).toBe(true);
  await app.press("label:Back");
  expect(app.texts()).toContain("Playback buffer");
  expect(app.shows("back-head")).toBe(false);
});

test("a wide Mac window keeps the hero's text: its column moves to the content column, it does not narrow to nothing", async () => {
  for (const [width, height] of [[1440, 900], [2000, 1250], [3440, 1440], [5120, 1440]]) {
    const app = await openApp({ platform: "macos", width, height, modules: { "app/native": NATIVE } });
    expect(app.texts()).toContain("Action, Science Fiction");
    expect(app.texts()).toContain("Resume 41:12");
    app.dispose();
  }
});

test("an iPad's sides have no system insets (a window's are the controls', at the top left only); a phone's notch side has", () => {
  // iPadOS reports 66 pt at the left of a window that does not fill the screen.
  expect(sideSafeAreaFor(true, { left: 66, right: 0 })).toEqual({ left: 0, right: 0 });
  expect(sideSafeAreaFor(false, { left: 62, right: 62 })).toEqual({ left: 62, right: 62 });
});
