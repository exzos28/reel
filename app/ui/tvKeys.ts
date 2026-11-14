// A Samsung TV remote's Back sends keyCode 10009 (XF86Back), which NSH's web keymap does not
// know. On the web it is turned into Escape, the key every screen binds for Back. The app's
// code runs in a frame of the same origin as NSH's page, so it listens on every document it
// can reach (the TV shell above them is another origin and is skipped).

const TIZEN_BACK = 10009;

// The web's DOM, as far as this file uses it (the project has no DOM types).
interface Key {
  keyCode: number;
  target: Target | null;
  preventDefault(): void;
  stopImmediatePropagation(): void;
}
interface Target {
  dispatchEvent(e: unknown): boolean;
}
interface Doc extends Target {
  addEventListener(type: string, listener: (e: Key) => void, capture: boolean): void;
}
type KeyEventCtor = new (type: string, init: Record<string, unknown>) => unknown;

export function mapRemoteBack() {
  const g = globalThis as unknown as { document?: Doc; parent?: { document?: Doc }; KeyboardEvent?: KeyEventCtor };
  const KeyEvent = g.KeyboardEvent;
  if (!KeyEvent) return;
  const docs: Doc[] = [];
  for (const get of [() => g.document, () => g.parent?.document]) {
    try {
      const d = get();
      if (d && !docs.includes(d)) docs.push(d);
    } catch {
      // another origin
    }
  }
  for (const doc of docs) {
    for (const type of ["keydown", "keyup"]) {
      doc.addEventListener(
        type,
        (e) => {
          if (e.keyCode !== TIZEN_BACK) return;
          e.preventDefault();
          e.stopImmediatePropagation();
          const escape = new KeyEvent(type, { key: "Escape", code: "Escape", keyCode: 27, which: 27, bubbles: true, cancelable: true });
          (e.target ?? doc).dispatchEvent(escape);
        },
        true,
      );
    }
  }
}

/** The app's console warnings and errors, and uncaught errors, sent to the TV core's log
 * (`GET http://<TV>:47392/logs`, "app (web UI)"): the TV has no console to read. */
export function forwardConsole() {
  const g = globalThis as unknown as {
    console: Record<string, (...a: unknown[]) => void>;
    addEventListener?: (t: string, f: (e: { message?: string; reason?: unknown }) => void) => void;
    fetch?: (url: string, init: Record<string, unknown>) => Promise<unknown>;
  };
  const send = g.fetch;
  if (!send) return;
  let queue: string[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    timer = null;
    const body = queue.join("\n");
    queue = [];
    // text/plain: a simple request to the core's other port, no preflight.
    send("http://127.0.0.1:47392/app-log", { method: "POST", headers: { "Content-Type": "text/plain" }, body }).catch(() => {});
  };
  const note = (level: string, args: unknown[]) => {
    const text = args.map((a) => (a instanceof Error ? `${a.message} ${a.stack ?? ""}` : typeof a === "string" ? a : JSON.stringify(a))).join(" ");
    queue.push(`${new Date().toISOString()} ${level} ${text}`);
    if (!timer) timer = setTimeout(flush, 500);
  };
  for (const level of ["warn", "error", "log"]) {
    const original = g.console[level];
    g.console[level] = (...a: unknown[]) => {
      note(level, a);
      original?.apply(g.console, a);
    };
  }
  g.addEventListener?.("error", (e) => note("uncaught", [e.message]));
  g.addEventListener?.("unhandledrejection", (e) => note("unhandled", [e.reason]));
}

/** Tells the TV shell the app has drawn (its splash goes then, not while the page is
 * still white). A timer, not requestAnimationFrame: the app's code runs in a frame the
 * TV's browser does not draw, where animation frames never come. */
export function tellShellReady() {
  const g = globalThis as unknown as { top?: { postMessage(m: unknown, o: string): void } | null };
  setTimeout(() => {
    try {
      g.top?.postMessage({ reel: "ready" }, "*");
    } catch {
      // no shell above (a browser)
    }
  }, 150);
}
