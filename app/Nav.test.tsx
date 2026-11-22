// The history (ui/nav.ts): destinations as roots, the page's section, a
// tab's own stack on touch, and Back closing what is open before it leaves.
import { expect, test } from "nsh/test";
import { back, canGoBack, go, handleBack, liftSettings, openAbout, openInterface, openSettings, openTitle, route, section, stack, toTop, useOwnSections, useTabStacks } from "./ui/nav";

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

test("choosing the current destination at its root keeps its route: a native stack would push a new one", () => {
  useTabStacks(true);
  go("home");
  const root = stack()[0];
  go("home");
  expect(stack()[0]).toBe(root);
  expect(stack().length).toBe(1);
});

test("a tablet's Settings is a section of its own: its pages on its stack, never a tab's; Back from its root goes where it was opened", () => {
  useTabStacks(true);
  useOwnSections(() => true);
  go("home");
  openTitle("tt1");
  openSettings();
  openInterface();
  expect(names()).toEqual(["settings", "interface"]);
  expect(section()).toBe("settings");
  go("home");
  expect(names()).toEqual(["home", "title"]); // Home never holds Settings' pages
  openSettings(); // to Settings' root
  expect(names()).toEqual(["settings"]);
  back();
  expect(names()).toEqual(["home", "title"]);
  useOwnSections(() => false);
  useTabStacks(false);
});

test("a tablet's Back from Saved and Settings goes where each was opened once: they never send Back to each other forever", () => {
  useTabStacks(true);
  useOwnSections(() => true);
  go("movies");
  go("saved");
  go("settings");
  back(); // to Saved
  expect(section()).toBe("saved");
  go("settings");
  go("saved");
  back(); // to Settings
  expect(section()).toBe("settings");
  back(); // to Saved, where Settings was opened first
  expect(section()).toBe("saved");
  back(); // Saved already went back once: Home
  expect(section()).toBe("home");
  useOwnSections(() => false);
  useTabStacks(false);
});

test("a tablet's window widened: Settings opened on a tab moves to its own section", () => {
  useTabStacks(true);
  go("home");
  go("movies");
  openTitle("tt1");
  openSettings(); // a phone's layout: on top of the film
  openAbout();
  expect(names()).toEqual(["movies", "title", "settings", "about"]);
  useOwnSections(() => true);
  liftSettings();
  expect(names()).toEqual(["settings", "about"]);
  back();
  back(); // Settings' root: back to Movies' film
  expect(names()).toEqual(["movies", "title"]);
  useOwnSections(() => false);
  useTabStacks(false);
});
