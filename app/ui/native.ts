// The Rust crate's modules, as the UI uses them. The only file that imports `app/native`
// (VideoSurface.tsx excepted: VideoEngine is registered everywhere).
//
// Native hosts run the crate in-process. The web build (the Samsung TV) compiles it to
// wasm32, where only the pure modules (Fmt, VideoEngine) exist; the others come over HTTP
// from the core that serves the page (`native-http.ts`, docs/tizen.md). On the web
// `app/native` only exports what the wasm crate registered, so it is imported as a namespace:
// a named import of a module it lacks would not resolve there.
import { platform } from "nsh";
import process from "process";
import * as local from "app/native";
import * as http from "./native-http";

/** The web build: the modules come from the core over HTTP. */
export const remote = platform.os === "web";

// Fails at startup with a clear message when the page was not opened by the TV shell (no
// token) or the core does not answer, instead of on the first call.
if (remote) http.connect();

export const Engine = remote ? http.Engine : local.Engine;
export const Catalog = remote ? http.Catalog : local.Catalog;
export const Settings = remote ? http.Settings : local.Settings;
export const Sources = remote ? http.Sources : local.Sources;
export const Meta = remote ? http.Meta : local.Meta;
export const Fmt = local.Fmt;
export const VideoEngine = local.VideoEngine;

/** The data dir to pass to `Settings.load` and `Meta.init`: the core's on the web (the
 * page's `process.dataDir` is not a path on the core's machine), else the app's. */
export function dataDir(): string {
  return remote ? http.coreDataDir() : (process.dataDir ?? "");
}
