// The UI's mirror of the user's settings. The core keeps and applies them
// (`Settings.load`, `Settings.setBufferMb`); this holds them in signals for
// the screens.
import { signal } from "nsh";
import { setLocale } from "nsh/i18n";
import process from "process";
import { Settings } from "app/native";

export interface BufferChoice {
  mb: number;
  default: boolean;
}

export const bufferMB = signal(0);
export const bufferChoices = signal<BufferChoice[]>([]);

/** Loads the settings from the core and applies the language. */
export async function loadSettings() {
  const s = JSON.parse(await Settings.load(process.dataDir ?? ""));
  bufferMB.set(s.bufferMB);
  bufferChoices.set(s.bufferChoices);
  setLocale(s.language);
}

export async function chooseBuffer(mb: number) {
  bufferMB.set(await Settings.setBufferMb(mb));
}
