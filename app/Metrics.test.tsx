// Where a page's parts go per family (ui/layout/metrics.ts): what is over a page never covers
// its title or a hero's text, and the room under it clears the system's bars.
import { expect, test } from "nsh/test";
import { computeMetrics, heroTopFor, type MetricsInput, type NavPlace, type PageKind } from "./ui/layout/metrics";
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
      return m.titleTop - m.headBottom;
    });
    expect(new Set(gaps).size).toBe(1);
  }
});

test("a phone: the head under the status bar; Back's on a deep page; the tab bar under the content", () => {
  const phone = families[3];
  expect(computeMetrics(input(phone, "root")).headBottom).toBe(54 + 44);
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

test("phone: Settings and About have Back and their title (no system header); Back goes back", async () => {
  const app = await openApp({ platform: "ios", width: 393, height: 852, safeArea: { top: 54, bottom: 34, left: 0, right: 0 }, modules: { "app/native": NATIVE } });
  await app.press("label:Settings");
  expect(app.shows("back-head")).toBe(true);
  expect(app.texts()).toContain("Settings");
  await app.press("label:Back");
  expect(app.texts()).toContain("Continue watching");
  expect(app.shows("back-head")).toBe(false);
});
