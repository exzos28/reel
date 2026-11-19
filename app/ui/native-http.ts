// app/native over HTTP: the modules of the Rust crate as the web build on a Samsung TV sees
// them, served by the core (platforms/tizen/core) on 127.0.0.1. Only `ui/native.ts` imports this.
//
// The core serves the web build itself (http://127.0.0.1:47391/ui/), so the calls are
// same-origin. The TV shell (platforms/tizen/ui/shell.js) opens it as
// /ui/index.html?reelToken=<token>; NSH runs the app in a same-origin frame below that page,
// so the token is looked for up the frame chain.
//
// Synchronous methods stay synchronous: they use a synchronous XMLHttpRequest, so the
// generated declarations and every call site (e.g. `Catalog.home()` inside a `computed`) stay
// as they are. On the web NSH runs the app's JS in the browser's own engine (a same-origin
// iframe, browser/realm.js of the web runtime), which has it. Chromium 120 (Tizen 9) still
// allows a synchronous XHR outside page dismissal; it only logs a deprecation warning. The
// core answers on 127.0.0.1 in about a millisecond (the first Engine.open, which starts the
// engine, up to a second), so the frames it blocks are few. The Promise-returning methods
// (Meta's data calls, which may wait for the network) use an asynchronous request.
import type {
  CatalogModule, EngineModule, FmtModule, HostedModule, MetaModule, LibraryModule, SettingsModule, SourcesModule, VideoEngineModule,
} from "app/native";

// NSH's typings (nsh/globals.d.ts) do not declare these browser globals; on the web they exist.
interface Xhr {
  open(method: string, url: string, async: boolean): void;
  setRequestHeader(name: string, value: string): void;
  send(body?: string): void;
  onload: (() => void) | null;
  onerror: (() => void) | null;
  readonly status: number;
  readonly responseText: string;
}
declare const XMLHttpRequest: { new (): Xhr };
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
      return null; // a cross-origin frame (the TV shell, above the core's pages), or no window
    }
    if (!w.parent || w.parent === w) return null;
    w = w.parent;
  }
}

function request(method: string, url: string, token: string, async: boolean, body?: string): Xhr {
  const xhr = new XMLHttpRequest();
  xhr.open(method, url, async);
  if (body !== undefined) xhr.setRequestHeader("Content-Type", "text/plain");
  xhr.setRequestHeader("X-Reel-Token", token);
  return xhr;
}

/** Asks the core for its data dir (synchronously, so the modules work as soon as this
 * module is loaded). Throws when the page was not opened with a token or the core is down. */
export function connect(): Core {
  if (core) return core;
  const found = findToken();
  if (!found) throw new Error("native-http: no reelToken in the URL (the TV shell opens /ui/index.html?reelToken=…)");
  const xhr = request("GET", `${found.origin}/health`, found.token, false);
  xhr.send();
  if (xhr.status !== 200) throw new Error(`native-http: core /health answered HTTP ${xhr.status}`);
  const { info } = JSON.parse(xhr.responseText);
  core = { base: found.origin, token: found.token, dataDir: info.dataDir };
  return core;
}

/** The core's data dir, for `Settings.load` and `Meta.init` (it replaces `process.dataDir`,
 * which is not a path on the core's file system). */
export function coreDataDir(): string {
  return connect().dataDir;
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
  const c = connect();
  const xhr = request("POST", `${c.base}/rpc`, c.token, false, "");
  xhr.send(body(module, method, args));
  return unwrap(module, method, xhr.status, xhr.responseText);
}

/** An asynchronous call. */
export function callAsync(module: string, method: string, args: unknown[]): Promise<unknown> {
  const c = connect();
  return new Promise((resolve, reject) => {
    const xhr = request("POST", `${c.base}/rpc`, c.token, true, "");
    xhr.onload = () => {
      try {
        resolve(unwrap(module, method, xhr.status, xhr.responseText));
      } catch (e) {
        reject(e);
      }
    };
    xhr.onerror = () => reject(new Error(`${module}.${method}: the core did not answer`));
    xhr.send(body(module, method, args));
  });
}

// Typed with the generated interfaces, so `nsh check` fails when a method is added to the
// crate and not here (the core's table has the same guard: `matches_the_declarations`).
const s = <T>(m: string, f: string) => (...args: unknown[]) => callSync(m, f, args) as T;
const a = <T>(m: string, f: string) => (...args: unknown[]) => callAsync(m, f, args) as Promise<T>;

export const Engine: EngineModule = {
  open: s("Engine", "open"),
  status: s("Engine", "status"),
  timeline: s("Engine", "timeline"),
  checkSpace: s("Engine", "checkSpace"),
  openRelease: s("Engine", "openRelease"),
  firstFrame: s("Engine", "firstFrame"),
  prepareSeek: s("Engine", "prepareSeek"),
  seekReady: a("Engine", "seekReady"),
  seeked: s("Engine", "seeked"),
  close: s("Engine", "close"),
  subtitles: s("Engine", "subtitles"),
  cues: s("Engine", "cues"),
  tracks: s("Engine", "tracks"),
  chooseTrack: s("Engine", "chooseTrack"),
};

export const Catalog: CatalogModule = {
  revision: s("Catalog", "revision"),
  changed: a("Catalog", "changed"),
  home: s("Catalog", "home"),
  browse: s("Catalog", "browse"),
  browseMore: s("Catalog", "browseMore"),
  chooseFilter: s("Catalog", "chooseFilter"),
  title: s("Catalog", "title"),
  episodes: s("Catalog", "episodes"),
  episode: s("Catalog", "episode"),
  upNext: s("Catalog", "upNext"),
  tracks: s("Catalog", "tracks"),
  toggleList: s("Catalog", "toggleList"),
  chooseRelease: s("Catalog", "chooseRelease"),
  episodeReleases: s("Catalog", "episodeReleases"),
  startAt: s("Catalog", "startAt"),
  saveProgress: s("Catalog", "saveProgress"),
  search: s("Catalog", "search"),
  rememberSearch: s("Catalog", "rememberSearch"),
  forgetSearches: s("Catalog", "forgetSearches"),
};

export const Settings: SettingsModule = {
  load: s("Settings", "load"),
  device: s("Settings", "device"),
  setBufferMb: s("Settings", "setBufferMb"),
  setStreamDetails: s("Settings", "setStreamDetails"),
  setNavPosition: s("Settings", "setNavPosition"),
  setLoader: s("Settings", "setLoader"),
  setSource: s("Settings", "setSource"),
  setContentLanguage: s("Settings", "setContentLanguage"),
  setLanguage: s("Settings", "setLanguage"),
  finishSetup: s("Settings", "finishSetup"),
  current: s("Settings", "current"),
  revision: s("Settings", "revision"),
  changed: a("Settings", "changed"),
};

export const Sources: SourcesModule = {
  search: s("Sources", "search"),
  setPictureCap: s("Sources", "setPictureCap"),
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

export const VideoEngine: VideoEngineModule = {
  kind: s("VideoEngine", "kind"),
  // A TV's web view has no native views of reel's.
  views: () => false,
  fullscreen: () => {},
};

export const Hosted: HostedModule = {
  address: s("Hosted", "address"),
  pairing: s("Hosted", "pairing"),
  cancelPairing: s("Hosted", "cancelPairing"),
  link: s("Hosted", "link"),
  partner: s("Hosted", "partner"),
  offered: s("Hosted", "offered"),
  answerOffer: s("Hosted", "answerOffer"),
  linkSource: s("Hosted", "linkSource"),
};

// A TV saves no films (design/offline-downloads.md): no call goes to the core for it.
export const Library: LibraryModule = {
  supported: () => false,
  save: () => false,
  item: () => '{"state":"none","progress":0}',
  title: () => '{"state":"none","saved":0,"saving":0,"progress":0}',
  plan: () => '{"episodes":[],"saved":0,"total":0,"size":null}',
  list: () => '{"saving":[],"ready":[],"failed":[],"space":{"saved":0,"free":null,"folder":null}}',
  pause: () => {},
  resume: () => {},
  remove: () => {},
  setFolder: () => "",
  openFolder: () => false,
  revision: () => 0,
};

// Fmt is pure and also registered in the wasm32 build, which `ui/native.ts` uses. Over HTTP
// it is here for completeness (the core serves it too).
export const Fmt: FmtModule = {
  position: s("Fmt", "position"),
  size: s("Fmt", "size"),
  speed: s("Fmt", "speed"),
  hoursMinutes: s("Fmt", "hoursMinutes"),
};
