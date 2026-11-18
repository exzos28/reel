# librqbit-dualstack-sockets 0.7.0, patched for reel

This is librqbit-dualstack-sockets 0.7.0 from crates.io (https://github.com/ikatson/librqbit-dualstack-sockets,
Copyright Igor Katson and contributors, see `LICENSE`), with the small patch below. reel uses it
through `[patch.crates-io]` in `app/.cargo/config.toml`. The unmodified copy is the commit
"Vendor librqbit-dualstack-sockets 0.7.0 unmodified"; `git diff` against it shows the patch.

## Why and what

Binding a socket to an interface takes the interface's index on macOS
(`bind_device_by_index_v4/v6`) and its name elsewhere (`bind_device`). The crate picks the first
for `target_os = "macos"` only, so iOS (and the iOS simulator) took the second, which socket2 has
for Linux and Android only, and did not compile. The patch uses the index for every Apple
platform (`target_vendor = "apple"`), in `src/bind_device.rs` and its tests; socket2 has the
index methods on iOS, tvOS, watchOS and visionOS too.
