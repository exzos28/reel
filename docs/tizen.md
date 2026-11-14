# reel on Samsung TVs (Tizen)

First target: Samsung S90D (2024, Tizen 9). Installed through Apps2Samsung, which re-signs packages for the user's TV.
The host lives in `hosts/tizen/`.

## Shape

```
one hybrid .wgt (package ReelTizen1)
├── TV app (web, ReelTizen1.ui)        hosts/tizen/ui
│     shell.js: starts the service, waits for the core, then loads the UI in an iframe
│     from http://127.0.0.1:47391/ui/, plays video with AVPlay
└── core service (.NET, ReelTizen1.Core) hosts/tizen/service
      ReelCore.dll loads lib/libreel_tizen_core.so (Rust: app/ crate + JSON RPC server)
      127.0.0.1:47391   /health, /rpc (token), /ui/* (the NSH web build)
      127.0.0.1:<random> librqbit's stream server (/torrents/{id}/stream/{file})
```

The pattern comes from [tizen-os-ambilight](https://github.com/exzos28/tizen-os-ambilight), which already works on the same TV generation:

| | ambilight (proven) | reel |
|---|---|---|
| Package | hybrid `.wgt`: web launcher + .NET service `.tpk`, packed with `tz pack -t wgt -k <tpk> -b <web.wgt>` | same command, same layout |
| Service | .NET 6 `ServiceApplication` (`net6.0-tizen9.0`) | same, as a thin host for a Rust `.so` |
| Native code | the service `dlopen`s `libvideoenhance.so` from P/Invoke | the service P/Invokes `libreel_tizen_core.so` from the package's `lib/` |
| Sockets | the service sends UDP/TCP; the web app makes HTTP calls to the LAN | the core listens on 127.0.0.1; the web app calls it over HTTP |
| Start | `on-boot="true"` + AppControl `command=start` from the launcher | AppControl `command=start` + `token` only. No `on-boot`: Apps2Samsung treats `on-boot`/`auto-restart` as Partner-only, and the core only has to run while the app is open |
| App ↔ service | Tizen MessagePort | HTTP on 127.0.0.1 (the player needs an HTTP URL for the stream anyway) |
| Signing | SDK default cert in CI; Apps2Samsung re-signs per TV | same |

Privileges: the service needs `internet`. The app needs `internet`, `application.launch` (to start the service) and `tv.inputdevice` (media keys).
None of these is Partner-level, so a Public certificate is enough.

### What the prototype answers

| Question | Status |
|---|---|
| Can a sideloaded package run native code with sockets? | Mostly proven by ambilight: a .NET service loads a native `.so` and uses sockets. Still to check on the TV: loading a `.so` shipped in our own package (the usual way .NET apps ship native libraries), and listening on 127.0.0.1. |
| How does the web UI talk to the core? | A JSON RPC on 127.0.0.1 (below). Works on the desktop: all 38 methods, a torrent opened, the stream answers Range requests with 206. On the TV it's still to check. |
| Which player? | AVPlay in the web app (see [Player](#player)). |
| Can the web build load from `file://`? | Probably not: NSH's web runtime `fetch()`es its wasm and chunks. So the core serves the web build at `/ui/`, which also makes the UI's RPC calls same-origin. |

`build.sh package --shell-only` produces a package without the UI. The app then shows a diagnostics screen that checks each step on the TV:
1. the service starts;
2. `/health` answers;
3. an RPC call works;
4. `Engine.checkSpace` answers;
5. the web build is served;
6. *Play Sintel*: `Engine.open` → stream URL → AVPlay.

## Bridge: app/native over HTTP

NSH's web target compiles the crate to wasm32, where librqbit, tokio networking and sqlite don't build. On the TV the crate therefore runs natively, and the web UI reaches its modules over HTTP.

```
POST /rpc    X-Reel-Token: <token>     body (text/plain): {"module":"Engine","method":"open","args":["sintel"]}
  200 {"ok":true,"value":7}    400 bad args    401 token    404 no such method    500 failed or panicked
GET /health  X-Reel-Token: <token>   → {"ok":true,"info":{"core","dataDir","cacheDir","profile","methods":[…],"ui":{"dir","index"}}}
GET /ui/…    the web build (no token), precompressed .br/.gz served as is
```

- **Names and arguments.** Method names are the camelCase ones NSH generates in `.nsh/types/app/native.d.ts`, and arguments are positional. `hosts/tizen/core/src/table.rs` maps them to `reel_app::Engine::open` and so on. Its test `matches_the_declarations` fails when the table and the declarations drift apart; any app/ change to a `#[module]` needs a line there.
- **Threads.** Sync methods run on blocking threads, because the engine calls `block_on` on its own runtime. `async` methods (`Meta.*`) run on the server's runtime.
- **Token.** The shell generates a token on every launch and passes it to the service in the AppControl. A service that is already running gets the new token. Other apps and web pages on the TV can reach 127.0.0.1 as well, but without the token they get 401. The UI receives the token in its URL (`/ui/index.html?reelToken=…`).
- **Data dir.** `Settings.load(dataDir)` and `Meta.init(dataDir)` accept only the core's own data dir (`info.dataDir`) or `""`. Any other path is a path on a different machine, so the call fails with 400 instead of the core silently swapping in its own dir.
- **Player profile.** The service starts the core with profile `tizen` (`TIZEN_PROFILE`, applied through `Sources::set_profile` before the server starts). That means no DTS, no TrueHD, no Dolby-Vision-only releases; MKV and MP4 are fine. `info.profile` shows the active profile. The UI must not call `Sources.setProfile` on the TV. The desktop binary takes `--profile tizen` to filter releases the same way.
- **Cache.** The engine puts its cache under `temp_dir()`. On the TV that may be a small RAM disk, so the core sets `TMPDIR` to the app's `cache/` before the engine starts. Change 6 below replaces this with a parameter.
- **Desktop.** `cargo run -p reel-tizen-core --bin reel-core -- --ui-dir out/web --profile tizen` serves the same API and UI on a Mac (from `hosts/tizen`), for testing in a browser.

## Changes in app/ (for the main session)

1–3 were tried on a copy of app/: `nsh package . --target web` then succeeded (7.4 MB; the first build of the web runtime takes about 2 min).

1. **Cargo.toml: native-only dependencies, and rustls for librqbit.** The second part drops OpenSSL. Today librqbit's default `sha1-crypto-hash` links OpenSSL on Linux, and `hosts/tizen/core` builds a vendored copy to compensate; remove that dependency there once this lands.
   ```toml
   [dependencies]
   nsh-core = "0.5.0"
   serde_json = "1"
   serde = { version = "1", features = ["derive"] }

   [target.'cfg(not(target_arch = "wasm32"))'.dependencies]
   librqbit = { version = "9.1.0", default-features = false, features = ["http-api", "http-api-client", "rust-tls", "tracing-subscriber-utils"] }
   anyhow = "1"
   librqbit-dualstack-sockets = "0.7"
   tokio = { version = "1", features = ["rt-multi-thread", "time", "sync"] }
   libc = "0.2"
   reqwest = …   # and rusqlite, quick-xml, regex: everything except nsh-core/serde/serde_json
   ```
2. **src/lib.rs: put every `mod`, the `pub use`s and the `Engine`/`Settings`/`Sources` structs and impls under `#[cfg(not(target_arch = "wasm32"))]`.** On wasm32, only `Fmt` is registered:
   ```rust
   registry.module::<Fmt>();
   #[cfg(not(target_arch = "wasm32"))]
   registry.module::<Engine>().module::<Catalog>().module::<Settings>().module::<Sources>().module::<Meta>();
   ```
   New native modules follow the same rule.
3. **Building the web runtime needs a clang that targets wasm32.** The runtime depends on `zstd-sys`, which compiles C. Apple's clang has no wasm32 backend, so use `CC_wasm32_unknown_unknown=/opt/homebrew/opt/llvm/bin/clang` (`hosts/tizen/build.sh` sets this). On Linux CI, use a clang with the wasm32 target.
4. **`ui/native.ts`, the only place that imports `app/native`.** On the web, `app/native` resolves (through an import map) to a facade that exports only what the wasm crate registered. A named import such as `import { Engine } from "app/native"` would fail to link there, so use a namespace import:
   ```ts
   import * as local from "app/native";
   import * as http from "./native-http";        // hosts/tizen/bridge/native-http.ts, moved here
   const tv = http.onTv();
   export const Engine = tv ? http.Engine : local.Engine;
   // … Catalog, Settings, Sources, Meta the same; Fmt can stay local.Fmt
   ```
   Then replace `from "app/native"` with `from "./native"` in App.tsx and ui/* (playback.ts, catalog.ts, preferences.ts, Player.tsx, Settings.tsx, testEngine.ts …).
   Sync methods use a synchronous XHR, so call sites stay as they are. This works because NSH's web runtime runs the app's JS in a same-origin browser iframe (`browser/realm.js`), which has `XMLHttpRequest`.
5. **Startup on the TV.** Call `await http.connect()` before the first module call. Wherever `process.dataDir` is passed to `Settings.load` and `Meta.init`, pass `http.coreDataDir()` instead when `tv` is set.
6. *(Optional, cleaner)* Add `engine::set_cache_dir(path)` (or a `Settings` method) so the host passes the cache dir explicitly instead of the core setting `TMPDIR`.
7. **Player:** see the next section.

## Player

**Decision: AVPlay (`webapis.avplay`) in the TV app.** Alternatives:
- HTML5 `<video>` on Tizen can't select tracks, and its MKV/HEVC/HDR support is unreliable.
- `Tizen.Multimedia.Player` (.NET) needs a .NET UI app with its own window; our UI is a web app and the .NET side is a background service, so the two would fight over windows.

AVPlay is the player Samsung documents for web apps:
- it plays MKV/MP4 from an HTTP URL with hardware HEVC and HDR10;
- it reports and selects audio and subtitle tracks (`getTotalTrackInfo`, `setSelectTrack`), which reel's tracks panel needs;
- it needs no Partner privilege.

Ambilight has no player, so this part is new and has to be tried on the TV; the diagnostics screen's *Play Sintel* button does exactly that.

How the pieces fit:
- AVPlay exists only in the shell's top-level document (`<object type="application/avplayer">`) and draws on the video plane under the whole web layer.
- The UI (served from 127.0.0.1) is cross-origin to the shell, so it drives AVPlay with `window.top.postMessage({reel:"avplay", op:"open"|"play"|"pause"|"seek"|"track"|"stop", …})`.
- The shell checks the sender's origin and replies to the sender with `{reel:"avplay-event", type:"loaded"|"time"|"buffering"|"seeked"|"ended"|"error"|"event", …}`.
- The client lives in `app/ui/avplay.ts` (`hosts/tizen/bridge/avplay.ts` was its first sketch).

Integration in app/:
- The core says what draws the video: `VideoEngine.kind()` answers `"avplay"` under the `tizen` profile, which the TV's core sets at start (`Profile::host_video`, app/src/sources/compat.rs).
- `ui/VideoSurface.tsx` then mounts `ui/AvplaySurface.tsx`: the same props, events and `seek` as the mpv and `<Video>` views, driving AVPlay through `ui/avplay.ts`. It maps `loaded` to `onLoad` and `onTracks`, `time` to `onProgress`, `buffering` to `onBuffer`, `ended` and `error`; pause, seek and the audio track go back as ops (ops wait for `loaded`). Volume is the TV's.
- Tracks: the surface hands AVPlay's tracks to the core as `{"avplay": [...]}` and the core reads them (`tracks::from_avplay`): audio tracks with language, codec and channels; AVPlay's text tracks are left out, since the shell does not pass on their text (`onsubtitlechange`). The release's subtitle files show in the UI's own overlay as everywhere.
- While a video plays, the app's root, the player screen and the page's `html`/`body` (this frame's and the NSH page's) are transparent; the stage and the overlays keep their backgrounds.
- The core's `tizen` profile already filters out releases AVPlay can't play.

## Build

```sh
hosts/tizen/build.sh check                      # toolchain report
hosts/tizen/build.sh core                       # out/libreel_tizen_core.so (armv7, softfp-compatible)
hosts/tizen/build.sh package --shell-only       # out/reel-tv-v<version>.wgt with the diagnostics screen
hosts/tizen/build.sh package                    # with the NSH web build (needs changes 1–4)
```

What `package` does:
1. Cross-compiles the core with `cargo zigbuild --target armv7-unknown-linux-gnueabi.2.28`. That target needs glibc ≥ 2.28; Tizen 9's glibc is newer. With `REEL_TIZEN_CC=arm-linux-gnueabi-gcc` it uses that toolchain instead (Debian, as CI).
2. Runs `nsh package . --target web` in app/.
3. Builds `service/` with `dotnet build` (Tizen workload) into a `.tpk` with `lib/libreel_tizen_core.so`.
4. Zips `ui/` together with `web/`, then runs `tz pack -t wgt -k <tpk> -b <web.wgt>`.
5. Writes `out/reel-tv-v<version>.wgt` and `SHA256SUMS-tizen.txt`.

Missing on this Mac (sizes measured from the download servers):

| Tool | For | Install | Size |
|---|---|---|---|
| rust-std `armv7-unknown-linux-gnueabi` | core | `rustup target add armv7-unknown-linux-gnueabi` | 27 MB |
| zig + cargo-zigbuild | core (C parts: sqlite, aws-lc, OpenSSL) | `brew install zig`, `cargo install --locked cargo-zigbuild` | 48 MB download, ~300 MB installed; zigbuild builds from source |
| .NET SDK 8 + Tizen workload | service `.tpk` | dot.net, then Samsung's `workload-install.sh` | SDK 200 MB download (~600 MB installed); workload not measured |
| Tizen-Core CLI `tz` (+ certificate-generator) | hybrid `.wgt` | as ambilight CI: `tizen-core_10.0.18_macos-64.zip` and `certificate-generator_0.1.4_macos-64.zip` from download.tizen.org/sdk/tizenstudio/official/binary into `$TIZEN_SDK`, plus `sdk.info` | 15 MB + 4 MB |

`~/.zshrc` still sets `TIZEN_SDK=~/tizen-studio/server/sdktools/data`, but that directory no longer exists. Install `tz` there, or point `TIZEN_SDK` elsewhere.

### CI

- Call `hosts/tizen/build.sh package --shell-only` now; drop `--shell-only` once changes 1–4 are in.
- Linux runner setup can copy ambilight's `tv-package.yml`:
  - `actions/setup-dotnet` 8.0.x;
  - Samsung's `workload-install.sh -d $DOTNET_ROOT`;
  - the `tizen-core_10.0.18_ubuntu-64.zip`, `web-privilege-checker_0.0.2_ubuntu-64.zip` and `certificate-generator_0.1.4_ubuntu-64.zip` packages with their SHA256s, and `sdk.info`;
  - `rustup target add armv7-unknown-linux-gnueabi`;
  - either zig + cargo-zigbuild, or `REEL_TIZEN_CC=arm-linux-gnueabi-gcc` from `scripts/setup-armv7-deps.sh`.
- With Debian's gcc, the `.so` links against that distribution's glibc version. The `core` step prints the newest `GLIBC_x.y` the library needs; it must not be newer than the TV's. zig with a pinned 2.28 avoids the question.
- The current `scripts/build.sh armv7` builds `libreel_app.so` from app/ directly. That library has no C API, so the service can't use it. The `.so` for the TV is `hosts/tizen/build.sh core` (`libreel_tizen_core.so`, exports `reel_core_start`, `reel_core_set_token`, `reel_core_last_error`).
- Release asset: `reel-tv-v<version>.wgt` (a hybrid package; Apps2Samsung installs `.wgt` and `.tpk` from GitHub Releases).

## Install on the TV (Apps2Samsung)

1. **Developer Mode on the TV.** Open **Apps**, press **1 2 3 4 5** on the remote, switch *Developer mode* on, and enter the IP of the machine running Apps2Samsung as *Host PC IP*. Restart the TV by holding the power button for about 5 s.
2. **Pick the TV.** Open Apps2Samsung on that machine (same network as the TV) and pick the TV.
3. **Install.** Install `reel-tv-v<version>.wgt`: either from a GitHub Release of this repo (*Add source* → the repo or a direct link to the asset), or from the local file `hosts/tizen/out/reel-tv-v<version>.wgt`. The first install asks you to sign in to Samsung once, to create a certificate for the TV. Apps2Samsung re-signs the package and should pick Public signing, because the package declares no Partner privilege and no `on-boot`.
   - If an earlier build signed with another certificate is installed, delete it on the TV first.
4. **Check.** Open **reel**. The shell starts the core service and, after `/health` answers, shows the UI. A `--shell-only` build shows the diagnostics screen instead; press OK on *Play Sintel*, and the film should play through AVPlay within about 30 s.
5. **If something fails.** On the rooted TV (`sdb shell`), the service writes to `/opt/usr/home/owner/apps_rw/ReelTizen1/data/`:
   - `core.log`: the core's stderr;
   - `startup-error.txt`: the library failed to load or start (ABI, missing glibc symbols, port taken).

   The diagnostics screen shows which step failed and the core's `info`, including `ui.dir` and whether `index.html` was found.

## Open risks to check on the TV

- **Web build path.** The web app's files in a hybrid package are expected at `res/wgt/` of the package (the service passes `DirectoryInfo.Resource/wgt/web` as the UI dir). `info.ui` shows whether that holds.
- **Native library loading.** The `.so` in the `.tpk`'s `lib/` must load from `DirectoryInfo.Lib`. The `TizenTpkUserIncludeFiles` item in `ReelCore.csproj` is unverified: `build.sh` fails if the `.so` is not in the `.tpk`.
- **Mixed content.** Tizen's WebView must allow an iframe at `http://127.0.0.1` inside the packaged app (`<access origin="*">`), and AVPlay must accept a `127.0.0.1` URL.
- **Memory.** The service stays resident while the TV is on, and the .NET runtime adds roughly 30–40 MB on top of the core. If that matters, a native (C) service app could host the `.so` instead; it needs a Tizen native rootstrap, which ambilight does not use.
- **Float ABI.** The core is built soft-float (`gnueabi`) with no NEON or VFP; that is ABI-compatible with Tizen's softfp. Flags such as `+vfp3,+neon` are a later speed-up.
