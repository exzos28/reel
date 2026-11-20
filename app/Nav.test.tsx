// The history (ui/nav.ts): destinations as roots, the page's section, a
// tab's own stack on touch, and Back closing what is open before it leaves.
import { expect, test } from "nsh/test";
import { back, canGoBack, go, handleBack, openAbout, openInterface, openSettings, openTitle, route, section, settingsOpen, sheet, stack, toTop, useSettingsSheet, useTabStacks } from "./ui/nav";

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

test("a tablet's Settings is a sheet with pages of its own: the tab's stack never holds it", () => {
  useTabStacks(true);
  useSettingsSheet(true);
  go("home");
  openTitle("tt1");
  openSettings();
  openInterface();
  expect(sheet().map((r) => r.name)).toEqual(["settings", "interface"]);
  expect(names()).toEqual(["home", "title"]);
  back(); // Interface, then Settings: the sheet closes
  expect(sheet().map((r) => r.name)).toEqual(["settings"]);
  openAbout();
  back();
  back();
  expect(settingsOpen()).toBe(false);
  expect(names()).toEqual(["home", "title"]);
  openSettings();
  go("search"); // a destination closes it
  expect(settingsOpen()).toBe(false);
  useSettingsSheet(false);
  useTabStacks(false);
});
