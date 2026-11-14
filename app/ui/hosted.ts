// Settings from a phone (docs/hosted-settings.md): where the page is, the code to show
// while a browser pairs, and the settings changed there. The core does all of it; this
// waits on `Settings.changed` and mirrors what it says into signals.
import { signal } from "nsh";
import { Hosted, Settings } from "./native";
import { applySettings, type SettingsJson } from "./preferences";

/** A code a browser waits for the viewer to read off the screen. */
export interface PairingCode {
  code: string;
  expiresIn: number;
}

export const pairingCode = signal<PairingCode | null>(null);
/** `http://<this TV>:47392/settings`, or null where the page is not served. */
export const hostedUrl = signal<string | null>(null);
/** Its QR code (an SVG data URL), or null. */
export const hostedQr = signal<string | null>(null);

/** A JSON answer of the core (awaited: tests' stand-ins answer with a promise). */
const parse = async <T>(json: () => string | Promise<string>): Promise<T | null> => {
  try {
    return JSON.parse(await json()) as T;
  } catch {
    return null; // a core without the method
  }
};

/** Reads the code and the address again. */
async function refreshHosted() {
  const p = await parse<{ code: string | null; expiresIn?: number }>(() => Hosted.pairing());
  pairingCode.set(p?.code ? { code: p.code, expiresIn: p.expiresIn ?? 0 } : null);
  const link = await parse<{ url: string | null; qr: string | null }>(() => Hosted.link());
  hostedUrl.set(link?.url ?? (await parse<{ url: string | null }>(() => Hosted.address()))?.url ?? null);
  hostedQr.set(link?.qr ?? null);
}

/** Reads the settings again (changed elsewhere, e.g. on a phone). */
async function refreshSettings() {
  const s = await parse<SettingsJson>(() => Settings.current());
  if (s) applySettings(s);
}

/** The viewer dismissed the code (Back or Cancel). */
export function cancelPairing() {
  pairingCode.set(null);
  try {
    Hosted.cancelPairing();
  } catch (e) {
    console.warn("could not cancel the pairing", e);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Follows the core's settings revision for as long as the app runs (after `loadSettings`). */
export async function watchSettings() {
  // The settings were just loaded: only what changes after this is read again.
  let seen = -1;
  try {
    seen = Number(await Settings.revision());
  } catch {
    // a core without it: the first answer of `changed` counts as a change
  }
  await refreshHosted();
  for (;;) {
    let now: number;
    try {
      now = Number(await Settings.changed(seen));
    } catch {
      return; // a core without `changed`
    }
    if (!Number.isFinite(now)) return;
    if (now !== seen) {
      seen = now;
      await refreshHosted();
      await refreshSettings();
    } else {
      await sleep(1000); // the core waited and nothing changed
    }
  }
}
