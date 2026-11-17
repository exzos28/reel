# app

The app itself: a TSX app on [NSH](https://nsh.dev) whose directory is also a Rust crate
(`nsh.json` `"rust": "."`).

- `App.tsx`, `ui/`: the screens, focus, keys and pointer (UI only).
- `src/`: the core's application layer and its NSH modules (`src/lib.rs`), which the UI calls
  through `app/native`.
- `domain/`, `engine/`: the core's crates: pure logic, and the torrent engine with the search
  source (see `docs/architecture.md`).
- `android/`: reel's own Android views (the mpv player), Java.
- `locales/`: the texts; `icon/`, `fonts/`: assets.
- `*.test.tsx`, `testEngine.ts`: the UI's headless tests.

```sh
nsh run            # this machine; --target ios, android, macos, linux, windows, web
nsh check          # cargo check of the crate, then the TSX's types
nsh test           # cargo test, then the *.test.tsx files, headless
```

Packages are made by `../build/build.sh <target>` (see the repository's README).
