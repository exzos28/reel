# ui/platform

The platform layer: what differs between the Samsung TV's web build, Android (TV), macOS,
Windows, Linux, iOS and iPadOS, behind one API per concern.

**Rule: screens never check the platform. They ask a capability (`caps`) or a module.**
Only this folder reads `nsh`'s `platform` (`runtime.ts`) and `Settings.device()` (`index.ts`).

## Where the choice is made

- `runtime.ts`: NSH's facts, read once: `os`, `idiom`, `desktop`, `web` (the TV's web build).
  `native.ts` uses `runtime.web` to reach the core over HTTP.
- `index.ts`: `family` (`tv`, `mac`, `windows`, `linux`, `tablet`, `phone`) and `caps`:
  - `windowBar`: a desktop window with reel's own window bar;
  - `shortcuts`: ⌘ / Ctrl shortcuts;
  - `touch`: a touch screen (system headers and stacks, swipes);
  - `remote`: a TV remote (arrows, OK, Back; one focus line the page moves under);
  - `fullscreen`: the window can fill the screen (the player's button and F).
- Each module's `x.ts` picks its implementation (`x.<impl>.ts`) from these, once.

Layout per family (where the nav, panels and Add to list go) is `layout/chrome.ts`'s
`frame`; per-family sizes read `chrome` there. Density is `theme.ts`'s.

## Modules

| Module | API | Implementations |
| --- | --- | --- |
| `scroll` | `scrollDriver(host)`: `to`, `stop`, `moving`, `at`, `sync` | `steps` (native apps: the offset stepped per frame), `slide` (TV web: a CSS transform transition) |
| `remote` | `mapPlatformKeys()`, `bindPlatformInput({ back, systemBack, go })`, `appDrawn()` | `tizen` (Back 10009 → Escape, the shell told when drawn), `desktop` (menu bar, shortcuts), `android` (system back) |
| `window` | `setupWindow()`, `<WindowFrame playing />`, `useFullscreen()` | `desktop` (hidden title bar, window bar or the player's drag strips, the window's full screen), none |
| `look` | `look.blurShadows`, `look.system` | one file: rendering that differs for performance or the system's look |
| `diagnostics` | `startDiagnostics()`, `perf.on` | `tizen` (console to the core's log, the perf probe with `reelPerf=1`), none |

The video view stays in `ui/VideoSurface.tsx`: the core chooses it (`VideoEngine.kind`).
