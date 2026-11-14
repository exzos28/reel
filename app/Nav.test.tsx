// The history (ui/nav.ts): destinations as roots, the page's section, a
// tab's own stack on touch, and Back closing what is open before it leaves.
import { expect, test } from "nsh/test";
import { back, canGoBack, go, handleBack, openAbout, openSettings, openTitle, route, section, stack, toTop, useTabStacks } from "./ui/nav";

const names = () => stack().map((r) => r.name);

test("a destination starts the stack over; a title keeps its section", () => {
  useTabStacks(false);
  go("home");
  go("movies");
  openTitle("tt1");
  expect(names()).toEqual(["movies", "title"]);
  expect(section()).toBe("movies");
  expect(canGoBack()).toBe(true);
  go("search");
  expect(names()).toEqual(["search"]);
  expect(canGoBack()).toBe(false);
});

test("Settings is a destination; About belongs to it", () => {
  useTabStacks(false);
  go("movies");
  openSettings();
  openAbout();
  expect(names()).toEqual(["settings", "about"]);
  expect(section()).toBe("settings");
  back();
  expect(route().name).toBe("settings");
});

test("choosing the current destination again goes to its root and asks for the top", () => {
  useTabStacks(false);
  go("shows");
  openTitle("tt2");
  const before = toTop();
  go("shows");
  expect(names()).toEqual(["shows"]);
  expect(toTop()).toBe(before + 1);
});

test("with tab stacks each tab keeps its place and Settings opens on the current tab", () => {
  useTabStacks(true);
  go("home");
  go("movies");
  openTitle("tt1");
  go("shows");
  expect(names()).toEqual(["shows"]);
  go("movies");
  expect(names()).toEqual(["movies", "title"]);
  openSettings();
  expect(names()).toEqual(["movies", "title", "settings"]);
  expect(section()).toBe("movies");
  useTabStacks(false);
});

test("Back from a root other than Home goes Home", () => {
  useTabStacks(false);
  go("anime");
  handleBack();
  expect(names()).toEqual(["home"]);
});
