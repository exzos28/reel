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

test("a source offered from a phone waits for Use on the screen; Back declines it", async () => {
  const c = core();
  const offer = { host: null as string | null, answers: [] as boolean[] };
  const native = {
    ...c.native,
    "Hosted.offered": () => JSON.stringify({ host: offer.host }),
    "Hosted.answerOffer": (yes: boolean) => {
      offer.answers.push(yes);
      offer.host = null;
      c.state.rev++;
    },
  };
  const app = await openApp({ modules: { "app/native": native } });
  expect(app.shows("offer-dialog")).toBe(false);
  offer.host = "jackett.partner.example";
  c.state.rev++;
  await app.waitFor("offer-dialog");
  expect(app.texts()).toContain("Use the source from your phone?");
  expect(app.texts()).toContain("jackett.partner.example");
  await app.keyboard.press("enter"); // Use is focused first
  expect(offer.answers).toEqual([true]);
  await app.waitUntil(() => !app.shows("offer-dialog"));

  offer.host = "other.example";
  c.state.rev++;
  await app.waitFor("offer-dialog");
  await app.keyboard.press("escape");
  expect(offer.answers).toEqual([true, false]);
  expect(app.texts()).toContain("Continue watching"); // Back closed the offer, not Home
});

test("a reel:// link from the partner's bot fills the source's drawer; nothing is saved until Save", async () => {
  const c = core(null);
  let saved = 0;
  const native = {
    ...c.native,
    "Hosted.linkSource": (link: string) =>
      JSON.stringify(link.startsWith("reel://s?") ? { url: "https://jackett.partner.example/api", key: "rented" } : { url: null }),
    "Settings.setSource": () => (saved++, JSON.stringify({ ok: true, source: { url: "https://jackett.partner.example/api", hasKey: true } })),
  };
  const app = await openApp({ modules: { "app/native": native } });
  await app.openWithUrl("reel://other");
  expect(app.texts()).not.toContain("Use this source?");
  await app.openWithUrl("reel://s?t=rented&u=https%3A%2F%2Fjackett.partner.example%2Fapi");
  await app.waitUntil(() => app.texts().includes("Use this source?"));
  expect(saved).toBe(0);
  // Save saves what the link filled in.
  await app.press("label:Save and check");
  expect(saved).toBe(1);
});

test("with a partner, the TV shows its bot's QR beside the source's fields", async () => {
  const c = core();
  const native = {
    ...c.native,
    "Hosted.partner": JSON.stringify({ bot: "reel_partner_bot", tv: { url: "https://t.me/reel_partner_bot?start=x", qr: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E" }, app: { url: "https://t.me/reel_partner_bot?start=y", qr: null } }),
  };
  const app = await openApp({ modules: { "app/native": native } });
  await app.press("label:Settings");
  await app.press("label:Search source");
  await app.waitFor("partner-qr");
  expect(app.texts().some((x) => x.includes("@reel_partner_bot"))).toBe(true);
});
