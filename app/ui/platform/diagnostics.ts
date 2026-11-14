// Diagnostics: what the platform gives to see the app's logs and its performance.
// - tizen (a TV's web build): the console forwarded to the core's log, and with
//   `reelPerf=1` in the page's address (`scripts/tizen-local.sh --perf`) the perf probe;
// - none elsewhere: the system's own console and NSH's performance monitor (⌘⇧F).
import { runtime } from "./runtime";
import { tizenDiagnostics } from "./diagnostics.tizen";

export interface Diagnostics {
  /** Starts what this platform has; says whether the perf probe is on. */
  start(): boolean;
}

const none: Diagnostics = { start: () => false };
const impl: Diagnostics = runtime.web ? tizenDiagnostics : none;

/** The `--perf` switch: code on hot paths checks `perf.on` and logs "[perf]" lines
 * through the forwarded console. */
export const perf = { on: false };

/** Once at start, before the app mounts. */
export function startDiagnostics() {
  perf.on = impl.start();
}
