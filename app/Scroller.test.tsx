// Scroll views that follow the remote: the offset math, and the screens
// moving with the arrow keys.
import { expect, open, test } from "nsh/test";
import { anchorOffset, nearestOffset } from "./ui/anchor";
import { NATIVE } from "./testEngine";

// A shelf on a 1920-wide TV: 96 px inset, 352 px cards 24 px apart.
const card = (i: number) => ({ start: 96 + i * 376, end: 96 + i * 376 + 352 });
const shelf = { viewport: 1920, content: 96 * 2 + 12 * 376 - 24, anchor: 96, pad: 20 };

test("a shelf puts the focused card at the left edge of its inset", () => {
  expect(anchorOffset({ ...shelf, ...card(0) })).toBe(0);
  // The 5th card (index 4): its start lands on the inset.
  const at = anchorOffset({ ...shelf, ...card(4) });
  expect(card(4).start - at).toBe(96);
});

test("near the end a shelf stops at its end instead of leaving a gap", () => {
  const max = shelf.content - shelf.viewport;
  expect(anchorOffset({ ...shelf, ...card(11) })).toBe(max);
});

// A page 1080 tall, 3000 long (its bottom inset included).
const page = { viewport: 1080, content: 3000, anchor: 360, pad: 20 };

test("a page puts the focused row in its upper third", () => {
  expect(anchorOffset({ ...page, start: 1500, end: 1860 })).toBe(1500 - 360);
});

test("the last row shows whole, captions and the page's end included", () => {
  // The last shelf: its block ends where the content does, minus the bottom inset.
  const row = { start: 2580, end: 2946 };
  const at = anchorOffset({ ...page, ...row });
  expect(at).toBe(3000 - 1080);
  expect(row.end - at).toBeLessThanOrEqual(1080);
  expect(row.start - at).toBeGreaterThanOrEqual(0);
});

test("a row taller than what the anchor leaves below it moves up to show whole", () => {
  const row = { start: 1200, end: 1200 + 900 };
  const at = anchorOffset({ ...page, ...row });
  expect(row.end + page.pad - at).toBe(1080);
});

test("the top of the page goes back to 0", () => {
  expect(anchorOffset({ ...page, start: 0, end: 780 })).toBe(0);
  expect(anchorOffset({ ...page, start: 200, end: 400 })).toBe(0);
});

test("revealing moves only as far as needed", () => {
  const { anchor: _, ...g } = page;
  expect(nearestOffset({ ...g, start: 300, end: 500 }, 0)).toBe(0);
  expect(nearestOffset({ ...g, start: 900, end: 1200 }, 0)).toBe(1200 + 20 - 1080);
  expect(nearestOffset({ ...g, start: 100, end: 300 }, 500)).toBe(80);
});

test("pressing right moves the focus along a shelf; down reaches the last shelf", async () => {
  const app = await open("./App.tsx", { platform: "macos", width: 800, height: 600, modules: { "app/native": NATIVE } });
  for (let i = 0; i < 4; i++) await app.keyboard.press("right");
  await app.wait(300);
  for (let i = 0; i < 8; i++) await app.keyboard.press("down");
  await app.wait(300);
  expect(app.texts()).toContain("Anime trending");
});
