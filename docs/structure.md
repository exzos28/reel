# Repository layout

```
app/              the app: what runs on the devices
  App.tsx, ui/      the screens (TSX on NSH): layout, focus, keys, pointer
  src/              the core's application layer and the modules the UI calls (Rust)
  domain/           pure logic shared by every layer (Rust crate reel-domain)
  engine/           the torrent engine and the search source (Rust crate reel-engine)
  android/          reel's own Android views (the mpv player, Java)
  locales/          the texts, English first
platforms/tizen/  the Samsung TV app around it: shell, .NET service, the core as a library
build/            how it is built and shipped; nothing here runs on a device
  build.sh          one entry point per platform: macos, android, windows, linux, ios…
  tizen.sh          the Samsung TV package
  docker/           the images that build Linux, Windows and the TV package
  …                 libmpv, packaging, the package check, the release, the site's deploy
dev/              tools for development: UI rules, local TV installs, samples
site/             the website, and its deploy (site/deploy)
design/           the design: directions, mockups, feature plans
docs/             these documents
vendor/           third-party code with reel's patches (librqbit)
out/              (git-ignored) the packages a build makes, out/<platform>/
```

The core's layers inside `app/` are in [architecture.md](architecture.md).
