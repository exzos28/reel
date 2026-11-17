// Settings from a phone (docs/hosted-settings.md) as the TV shows them: the pairing code
// over any screen, and the address of the page where a source is set.
import { expect, test } from "nsh/test";
import { NATIVE, openApp } from "./testEngine";

const URL = "http://192.168.1.20:47392/settings";

/** The core's side: a code that a test puts up or takes down, and the settings revision
 * that wakes the app (`Settings.changed`), as the core does when a phone pairs. */
function core(address: string | null = URL) {
  const state = { rev: 1, code: null as string | null, cancelled: 0 };
  const native = {
    ...NATIVE,
    "Hosted.address": JSON.stringify({ url: address }),
    "Hosted.link": JSON.stringify({ url: address, qr: address ? "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E" : null }),
    "Hosted.pairing": () => JSON.stringify(state.code ? { code: state.code, expiresIn: 120 } : { code: null }),
    "Hosted.cancelPairing": () => {
      state.cancelled++;
      state.code = null;
      state.rev++;
    },
    "Settings.revision": () => state.rev,
    // At once, even when nothing changed (the app then asks again a second later).
    "Settings.changed": () => state.rev,
  };
  const show = (code: string | null) => {
    state.code = code;
    state.rev++;
  };
  return { state, native, show };
}

test("a phone asks for a code: the TV shows it over the screen, and Back dismisses it", async () => {
  const c = core();
  const app = await openApp({ modules: { "app/native": c.native } });
  expect(app.shows("pairing-dialog")).toBe(false);
  c.show("482913");
  await app.waitFor("pairing-dialog");
  expect(app.texts()).toContain("Pair your phone");
  expect(app.texts()).toContain("482913");
  // The screen under it does not move while it is up.
  await app.keyboard.press("down");
  await app.keyboard.press("escape");
  expect(app.shows("pairing-dialog")).toBe(false);
  expect(c.state.cancelled).toBeGreaterThan(0);
  expect(app.texts()).toContain("Continue watching"); // Back closed the code, not Home
});

test("the code goes once the phone paired (the core takes it down)", async () => {
  const c = core();
  const app = await openApp({ modules: { "app/native": c.native } });
  c.show("123456");
  await app.waitFor("pairing-dialog");
  c.show(null);
  await app.waitUntil(() => !app.shows("pairing-dialog"));
  expect(c.state.cancelled).toBe(0);
  expect(app.texts()).not.toContain("123456");
});

test("OK on Cancel dismisses the code", async () => {
  const c = core();
  const app = await openApp({ modules: { "app/native": c.native } });
  c.show("777001");
  await app.waitFor("pairing-dialog");
  await app.keyboard.press("enter");
  expect(app.shows("pairing-dialog")).toBe(false);
  expect(c.state.cancelled).toBe(1);
});

test("Settings shows a QR code and the address to set the source from a phone", async () => {
  const app = await openApp({ modules: { "app/native": core().native } });
  await app.press("label:Settings");
  expect(app.texts()).toContain(`Scan the code, or open ${URL}.`);
  expect(app.shows("hosted-qr")).toBe(true);
});

test("no address where the page is not served", async () => {
  const app = await openApp({ modules: { "app/native": core(null).native } });
  await app.press("label:Settings");
  expect(app.shows("hosted-address")).toBe(false);
  expect(app.texts()).toContain("Search source");
});

test("a title with no search source points to the page on a phone", async () => {
  const title = { ...JSON.parse(NATIVE["Catalog.title"] as string), release: null, playable: false, releases: [], releasesState: "no_source" };
  const app = await openApp({ modules: { "app/native": { ...core().native, "Catalog.title": JSON.stringify(title) } } });
  await app.keyboard.press("enter"); // Inception
  expect(app.texts()).toContain(`Add a search source in Settings, or open ${URL} on your phone.`);
});

test("what a phone changed shows on the TV's Settings without a restart", async () => {
  const c = core();
  /** `Settings.current` once the phone chose Polish and a bigger buffer. */
  const current = {
    language: "en",
    contentLanguage: "pl-PL",
    contentLanguages: [{ tag: "en-US", name: "English" }, { tag: "pl-PL", name: "Polski" }],
    bufferMB: 512,
    streamDetails: false,
    source: { url: "http://192.168.1.10:9117/api", hasKey: true },
    bufferChoices: [{ mb: 128, default: false }, { mb: 256, default: true }, { mb: 512, default: false }],
  };
  let changed = false;
  const app = await openApp({
    modules: { "app/native": { ...c.native, "Settings.current": () => (changed ? JSON.stringify(current) : null) } },
  });
  await app.press("label:Settings");
  expect(app.texts()).toContain("English");
  changed = true;
  c.show(null); // the core's revision goes up: the app reads the settings again
  await app.waitUntil(() => app.texts().includes("Polski"));
  expect(app.texts()).toContain("512 MB · 10 GB free");
});
