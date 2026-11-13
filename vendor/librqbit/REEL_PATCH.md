# librqbit 9.1.0, patched for reel

This is librqbit 9.1.0 from crates.io (https://github.com/ikatson/rqbit,
Copyright Igor Katson and contributors, Apache-2.0, see `LICENSE`), with the
small patch below. reel uses it through `[patch.crates-io]` in
`app/.cargo/config.toml`. The unmodified copy is the commit "Vendor librqbit
9.1.0 unmodified"; `git diff` against it shows the patch.

## Why

reel streams films on TVs, which have little flash. Its storage
(`TorrentStorage`) keeps only a window of the torrent around the player's
position, a fixed number of bytes, and drops the rest. librqbit has a
pluggable storage but no way for one to say "this piece is gone": the piece
stays "have", streams read missing data, and it is never downloaded again
when the viewer seeks back to it. A storage also cannot see where the
streams are, and the streams' readahead is a fixed 32 MiB.

## What

Three public methods on `ManagedTorrent`:

- `forget_pieces(&self, pieces: impl IntoIterator<Item = ValidPieceIndex>) -> anyhow::Result<u32>`:
  the pieces stop being "have". Streams wait for them again and fetch them
  with priority. A piece whose file is selected is queued again. Have,
  needed and per-file byte counts and the live `have_bytes` stat drop by
  the piece size. The bitfield is flushed again later. Pieces we don't have
  are skipped. Works on live and paused torrents, and returns how many
  pieces it forgot. The caller forgets a piece before removing its data.
- `set_stream_readahead(&self, bytes: u64) -> anyhow::Result<()>`: how far
  ahead of each stream to download first (default 32 MiB, 0 restores it).
- `stream_positions(&self) -> Vec<(usize, u64)>`: `(file_id, position)` of
  the open streams.

Underneath:

- `ChunkTracker::mark_piece_forgotten` does the bookkeeping, and a
  `forgotten` bitfield remembers forgotten pieces until they are downloaded
  again (cleared in `mark_piece_downloaded`).
- `on_download_request`: a request for a forgotten piece is ignored (debug
  log) instead of failing the peer connection. Peers saw our "have" for it,
  and BitTorrent has no way to take that back, so the request is not the
  peer's fault. Requests for pieces we never had still fail as before.
- `TorrentStreams` keeps the readahead in an `AtomicU64` and uses it in
  `iter_next_pieces`.
- `PieceTracker::forget_piece` and `TorrentStateLive::forget_pieces` pass
  the call through. The live one takes the state lock once, then notifies
  and reconnects peers with it released, as `update_only_files` does.

About 180 lines of code and comments plus 2 tests:
`chunk_tracker::tests::test_forget_piece` (a piece spanning two files,
selected and unselected pieces, counters, downloading it again) and
`torrent_state::streaming::tests::test_stream_readahead`.

## Known limits

- An upload request that passed the check and is waiting for the upload
  rate limiter can still fail to read a piece forgotten in between. The peer
  connection then ends with a read error, as it would for any storage read
  error. This is rare: storages evict pieces far from the readers.
- When the hash check of a piece is running (its chunks are written but it
  is not "have" yet), `forget_pieces` skips it. A storage should not drop
  the data of pieces it is still being written.

## Upstream

Written to be proposed as a PR to rqbit as is: the methods are additive,
the defaults are unchanged, and nothing changes for a torrent that never
calls them.
