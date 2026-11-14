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

# Patch 2: several peers per streamed piece

## Why

4K releases have 16-32 MiB pieces. A stream read waits for a whole
verified piece, and librqbit gives a piece to one peer at a time (stealing
needs the stealer's average piece time, which new peers lack, and restarts
the piece). So the piece at the play position came at one peer's speed:
in reel's log of a 4K start the first 8 MB took 12 s with 60-100 peers
and 20-40 MB/s in total. A seek waited the same way, and also behind each
peer's 128 queued requests for the old position.

## What

- Pieces the streams need next (`TorrentStreams::iter_next_pieces`) are
  shared: any peer that has one takes its chunks one at a time when it has
  a free request slot (`PieceTracker::next_chunk`), and a peer joins an
  in-flight priority piece (`AcquireResult::Joined`) before reserving the
  next one. Each peer holds at most about `chunks / live peers` requested
  chunks of a shared piece (at least 4), so a piece spreads over the swarm
  instead of filling the first peer's pipeline. A chunk requested over 2 s
  ago and still missing may be requested from another peer; whichever copy
  arrives first is written, once (`start_writing_chunk` marks it as being
  written); later copies are dropped. A piece one peer was downloading when
  it became a priority is shared from then on; the chunks it requested stay
  its own.
- Shared pieces are never stolen. When a peer dies, a shared piece keeps
  its written chunks and stays in flight, and the peer's requests are free
  for others. Shared pieces that are no longer a priority but have chunks
  nobody fetches are finished before new pieces are reserved (the "orphan"
  pass), so none stays in flight forever.
- Every piece's chunks are requested through `next_chunk` (one state lock
  per chunk request, as the write path already takes per chunk). For a
  piece one peer downloads the order is as before, but written chunks are
  skipped and requests stop once the piece is stolen (upstream kept
  requesting a stolen piece's chunks and dropped them on arrival).
- While streams are open, a peer's request window is about 1 s of its
  measured rate (8 to 128 chunks) instead of a fixed 128, so the chunks a
  seek needs wait about 1 s behind older requests, not 2-4 s. After a seek
  or a new stream, a peer on a shared piece goes back to acquiring, so it
  moves to the new position at once.
- Pieces that are not stream priorities are downloaded as before.
- Measurement: `ManagedTorrent::take_stream_waits()` returns the stream
  reads at a new position (start, seek) and the waits for pieces: how long
  the read waited and how many peers the piece came from. reel writes them
  to its timing log.

## Measured

`tests::e2e_stream_swarm` (6 local seeders at 1 MiB/s each, 4 MiB pieces,
only the stream's readahead fetched, debug build):

| | before | after |
|---|---|---|
| first bytes at the start | 3.0 s (1 peer) | 0.01-0.06 s (6 peers) |
| first bytes after a seek to 80% | 8.0 s (1 peer) | 0.73-1.1 s (6 peers) |

The start is flattered by the upload limiter's 1 s burst; without it,
6 peers need about 0.7 s for the 4 MiB.

## Known limits

- A hash failure of a shared piece blames (disconnects) the peer that wrote
  its last chunk, as upstream blames the owner; with several writers the
  bad chunk may have come from another peer. The piece is downloaded again.
- Duplicate requests for stale chunks cost some bandwidth at the tail of a
  shared piece when peers are slow.
- Requests queued for the old position before a seek are not cancelled
  (librqbit's own seeding ignores Cancel); they still arrive and are
  written.

Tests: `piece_tracker::tests::test_peers_share_a_priority_piece_chunk_by_chunk`,
`test_shared_piece_survives_its_peer`,
`test_a_piece_becomes_shared_when_it_turns_priority`,
`tests::e2e_stream_swarm::test_stream_swarm_first_bytes`.
