// Saved on a phone (design/offline-downloads.md): an empty screen invites to find a film; a
// film saving says how long it still takes, and the Saved tab shows the progress meanwhile.
import { expect, test } from "nsh/test";
import { NATIVE, openApp } from "./testEngine";

const MB = 1024 * 1024;
const SPACE = { saved: 35 * MB, free: 19 * 1024 * MB, folder: null };
const NOTHING = { saving: [], ready: [], failed: [], space: { ...SPACE, saved: 0 } };
const IDLE = { saving: false, progress: 0 };

/** Night of the Living Dead, 35 of 700 MB, at a pace the core puts at 1 h 50 min. */
const FILM = {
  id: 1,
  key: "tmdb:movie:10331",
  title: "Night of the Living Dead",
  label: "",
  image: "",
  season: null,
  number: null,
  state: "saving",
  size: 700 * MB,
  have: 35 * MB,
  progress: 0.05,
  speed: 0.1,
  peers: 2,
  left: 110,
  message: null,
};
const SAVING = {
  saving: [{ id: FILM.key, title: FILM.title, image: "", show: false, count: 1, size: FILM.size, have: FILM.have, progress: FILM.progress, speed: 0.1, peers: 2, left: 110, items: [FILM] }],
  ready: [],
  failed: [],
  space: SPACE,
};

const phone = (list: object, overall: object) =>
  openApp({
    platform: "ios",
    width: 393,
    height: 852,
    safeArea: { top: 54, bottom: 34, left: 0, right: 0 },
    modules: {
      "app/native": {
        ...NATIVE,
        "Library.supported": true,
        "Library.revision": 1,
        "Library.list": JSON.stringify(list),
        "Library.overall": JSON.stringify(overall),
      },
    },
  });

test("phone: an empty Saved says what it is for and Browse films goes Home; no space, no mark", async () => {
  const app = await phone(NOTHING, IDLE);
  await app.press("label:Saved");
  expect(app.texts()).toContain("Save a film to watch it offline");
  expect(app.texts().some((s) => s.includes("free"))).toBe(false);
  expect(app.shows("saved-progress")).toBe(false);
  await app.press("label:Browse films");
  expect(app.shows("category-bar")).toBe(true);
});

test("phone: a film saving says how long it still takes, and the Saved tab shows the progress", async () => {
  const app = await phone(SAVING, { saving: true, progress: 0.05 });
  expect(app.shows("saved-progress")).toBe(true);
  await app.press("label:Saved");
  expect(app.texts()).toContain("5% · 35 of 700 MB · about 1 h 50 min left");
  expect(app.texts()).toContain("35 MB saved · 19 GB free");
  expect(app.texts()).not.toContain("Save a film to watch it offline");
});

test("phone: without a time the core trusts, the row says none", async () => {
  const film = { ...FILM, left: null };
  const app = await phone({ ...SAVING, saving: [{ ...SAVING.saving[0], left: null, items: [film] }] }, { saving: true, progress: 0.05 });
  await app.press("label:Saved");
  expect(app.texts()).toContain("5% · 35 of 700 MB");
});
