// App settings, kept on the device across launches. The engine owns what they
// mean (Rust: `Engine.setBufferMB`, `Engine.checkSpace`); this keeps the choice.
import { signal, Storage } from "nsh";
import { Engine } from "app/native";

/** Choices for the playback buffer, in MiB. */
export const BUFFER_CHOICES = [128, 256, 512, 1024, 2048] as const;
export const DEFAULT_BUFFER_MB = 256;

const KEY = "settings.bufferMB";

/** How much the engine may keep while a film plays, MiB. */
export const bufferMB = signal<number>(DEFAULT_BUFFER_MB);

/** Restores the saved choice and hands it to the engine. */
export async function restoreSettings() {
  const saved = Number(await Storage.getItem(KEY).catch(() => null));
  if ((BUFFER_CHOICES as readonly number[]).includes(saved)) bufferMB.set(saved);
  await Engine.setBufferMb(bufferMB());
}

export function setBufferMB(mb: number) {
  bufferMB.set(mb);
  Engine.setBufferMb(mb);
  Storage.setItem(KEY, String(mb)).catch((e) => console.warn("could not save the buffer size", e));
}

export interface Space {
  ok: boolean;
  /** Bytes free where the engine keeps its cache; null when unknown. */
  free: number | null;
  /** Bytes needed to start: the buffer plus a reserve. */
  needed: number;
}

export async function checkSpace(): Promise<Space> {
  return JSON.parse(await Engine.checkSpace());
}

/** "256 MB", "1 GB", "1.4 GB". */
export function formatSize(bytes: number) {
  const mb = bytes / (1024 * 1024);
  if (mb < 1024) return `${Math.round(mb)} MB`;
  const gb = mb / 1024;
  return `${gb >= 10 || Number.isInteger(gb) ? Math.round(gb) : gb.toFixed(1)} GB`;
}
