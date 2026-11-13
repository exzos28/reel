import { expect, open, test } from "nsh/test";

test("home starts in English and moves focus with arrows", async () => {
  const app = await open("./App.tsx");
  expect(app.texts()).toContain("Metropolis");
  expect(app.texts()).toContain("1927, 2 h 33 min, directed by Fritz Lang");
  await app.keyboard.press("right");
  expect(app.texts()).toContain("1922, 1 h 34 min, directed by F. W. Murnau");
});
