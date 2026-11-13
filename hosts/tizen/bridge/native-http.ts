// app/native over HTTP: the modules of app/'s Rust crate as the web build on a Samsung TV
// sees them, served by the core (hosts/tizen/core) on 127.0.0.1. Reference implementation
// for app/ (docs/tizen.md, "Changes in app/"): the main session moves it to
// app/ui/native-http.ts; it is not compiled in hosts/tizen.
//
// The core serves the web build itself (http://127.0.0.1:47391/ui/), so the calls are
// same-origin. The TV shell (hosts/tizen/ui/shell.js) opens it as
// /ui/index.html?reelToken=<token>; NSH runs the app in a same-origin frame below that page,
// so `connect()` looks for the token up the frame chain.
//
// Synchronous methods use a synchronous XMLHttpRequest, so the generated declarations (and
// every call site) stay as they are: on the web NSH runs the app's JS in the browser's own
// engine (a same-origin iframe, browser/realm.js of the web runtime), which has it. The core
// answers in about a millisecond on 127.0.0.1, except the first Engine.open, which starts the
// engine (up to a second).
import type {
  CatalogModule, EngineModule, FmtModule, MetaModule, SettingsModule, SourcesModule,
} from "app/native";

// NSH's typings (nsh/globals.d.ts) do not declare these browser globals; on the web they exist.
declare const XMLHttpRequest: {
  new (): {
    open(method: string, url: string, async: boolean): void;
    setRequestHeader(name: string, value: string): void;
    send(body: string): void;
    readonly status: number;
    readonly responseText: string;
  };
};
interface FrameWindow { location: { search: string; origin: string }; parent: FrameWindow }

interface Core {
  base: string;
  token: string;
  dataDir: string;
}

let core: Core | null = null;

/** The `reelToken` query parameter of this frame or the nearest same-origin frame above it. */
function findToken(): { token: string; origin: string } | null {
  let w = globalThis as unknown as FrameWindow;
  for (;;) {
    try {
      const token = new URLSearchParams(w.location.search).get("reelToken");
      if (token) return { token, origin: w.location.origin };
    } catch {
      return null; // a cross-origin frame: the TV shell, above the core's pages
    }
    if (w.parent === w) return null;
    w = w.parent;
  }
}

/** Whether the app runs as the TV build (opened by the TV shell with a token). */
export function onTv(): boolean {
  return findToken() !== null;
}

/** Asks the core for its data dir; call once at startup, before any module call. */
export async function connect(): Promise<Core> {
  const found = findToken();
  if (!found) throw new Error("no reelToken in the URL: not opened by the TV shell");
  const r = await fetch(`${found.origin}/health`, { headers: { "X-Reel-Token": found.token } });
  if (!r.ok) throw new Error(`core /health: HTTP ${r.status}`);
  const { info } = await r.json();
  core = { base: found.origin, token: found.token, dataDir: info.dataDir };
  return core;
}

/** The core's data dir, for `Settings.load` and `Meta.init` (it replaces `process.dataDir`,
 * which is not a path on the core's file system). */
export function coreDataDir(): string {
  return connected().dataDir;
}

function connected(): Core {
  if (!core) throw new Error("native-http: connect() first");
  return core;
}

function unwrap(module: string, method: string, status: number, text: string): unknown {
  let reply: { ok: boolean; value?: unknown; error?: string };
  try {
    reply = JSON.parse(text);
  } catch {
    throw new Error(`${module}.${method}: HTTP ${status}, not JSON`);
  }
  if (!reply.ok) throw new Error(`${module}.${method}: ${reply.error}`);
  return reply.value;
}

function body(module: string, method: string, args: unknown[]): string {
  return JSON.stringify({ module, method, args });
}

/** A synchronous call (blocks until the core answers). */
export function callSync(module: string, method: string, args: unknown[]): unknown {
  const c = connected();
  const xhr = new XMLHttpRequest();
  xhr.open("POST", `${c.base}/rpc`, false);
  xhr.setRequestHeader("Content-Type", "text/plain");
  xhr.setRequestHeader("X-Reel-Token", c.token);
  xhr.send(body(module, method, args));
  return unwrap(module, method, xhr.status, xhr.responseText);
}

/** An asynchronous call. */
export async function callAsync(module: string, method: string, args: unknown[]): Promise<unknown> {
  const c = connected();
  const r = await fetch(`${c.base}/rpc`, {
    method: "POST",
    headers: { "Content-Type": "text/plain", "X-Reel-Token": c.token },
    body: body(module, method, args),
  });
  return unwrap(module, method, r.status, await r.text());
}

const s = <T>(m: string, f: string) => (...args: unknown[]) => callSync(m, f, args) as T;
const a = <T>(m: string, f: string) => (...args: unknown[]) => callAsync(m, f, args) as Promise<T>;

export const Engine: EngineModule = {
  open: s("Engine", "open"),
  status: s("Engine", "status"),
  timeline: s("Engine", "timeline"),
  checkSpace: s("Engine", "checkSpace"),
  openRelease: s("Engine", "openRelease"),
  close: s("Engine", "close"),
};

export const Catalog: CatalogModule = {
  revision: s("Catalog", "revision"),
  home: s("Catalog", "home"),
  episode: s("Catalog", "episode"),
  startAt: s("Catalog", "startAt"),
  saveProgress: s("Catalog", "saveProgress"),
  browse: s("Catalog", "browse"),
  title: s("Catalog", "title"),
  episodes: s("Catalog", "episodes"),
  upNext: s("Catalog", "upNext"),
  tracks: s("Catalog", "tracks"),
  toggleList: s("Catalog", "toggleList"),
  chooseRelease: s("Catalog", "chooseRelease"),
};

export const Settings: SettingsModule = {
  load: s("Settings", "load"),
  setBufferMb: s("Settings", "setBufferMb"),
  setSource: s("Settings", "setSource"),
  setLanguage: s("Settings", "setLanguage"),
};

export const Sources: SourcesModule = {
  search: s("Sources", "search"),
  // The core on the TV already runs with the "tizen" profile (set by the service at start).
  setProfile: s("Sources", "setProfile"),
  check: s("Sources", "check"),
  result: s("Sources", "result"),
};

export const Meta: MetaModule = {
  init: s("Meta", "init"),
  setTmdbKey: s("Meta", "setTmdbKey"),
  status: s("Meta", "status"),
  revision: s("Meta", "revision"),
  attribution: s("Meta", "attribution"),
  trending: a("Meta", "trending"),
  title: a("Meta", "title"),
  season: a("Meta", "season"),
  search: a("Meta", "search"),
};

// Fmt is pure: on the web it can also stay in the crate (compiled to wasm32, see
// docs/tizen.md); over HTTP it is here for completeness.
export const Fmt: FmtModule = {
  position: s("Fmt", "position"),
  size: s("Fmt", "size"),
  hoursMinutes: s("Fmt", "hoursMinutes"),
};
