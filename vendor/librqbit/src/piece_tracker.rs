//! Coordinates piece download state by wrapping ChunkTracker with inflight piece tracking.
//!
//! This module provides the [`PieceTracker`] type which encapsulates the relationship between
//! queued pieces (in ChunkTracker) and in-flight pieces (being downloaded by a peer).
//!
//! The key invariant maintained is: a piece is in exactly one state at any time:
//! - HAVE (completed)
//! - QUEUED (available to download)
//! - IN_FLIGHT (currently being downloaded)
//! - NOT_NEEDED (not selected for download)

use std::{
    collections::{HashMap, HashSet},
    time::{Duration, Instant},
};

use buffers::ByteBuf;
use librqbit_core::{
    constants::CHUNK_SIZE,
    lengths::{ChunkInfo, ValidPieceIndex},
};
use peer_binary_protocol::Piece;

use crate::{
    chunk_tracker::{ChunkMarkingResult, ChunkTracker},
    file_info::FileInfo,
    type_aliases::{FileInfos, FilePriorities, PeerHandle},
};

/// Tracks a piece currently being downloaded.
#[derive(Debug, Clone)]
pub struct InflightPiece {
    pub peer: PeerHandle,
    pub started: Instant,
    /// reel: the peers whose chunks of it were written so far (measurement:
    /// how many peers a piece came from).
    writers: Vec<PeerHandle>,
    /// reel: the next chunk `peer` requests, while the piece is not shared.
    next_chunk: u32,
    /// reel: Some once the piece is shared (see [`SharedChunks`]).
    shared: Option<SharedChunks>,
}

/// reel: a piece the streams need next is shared: any peer that has it takes
/// its chunks one at a time, as it has a free request slot, instead of one
/// peer downloading the whole piece. With big pieces (16-32 MiB in 4K
/// releases) and slow peers, a stream would otherwise wait for a whole piece
/// at one peer's speed.
///
/// Each peer has at most about `chunks / live peers` of its chunks requested
/// and not written (at least [`MIN_SHARE`]): peers pipeline up to 128
/// requests, and without a cap the first one or two peers would take the
/// whole piece and the rest would go to the next pieces.
#[derive(Debug, Clone)]
struct SharedChunks {
    /// Per chunk: who requested it last, and when.
    claims: Vec<Option<(PeerHandle, Instant)>>,
    /// Per chunk: being written now (one peer writes a chunk; a copy that
    /// arrives meanwhile or later is dropped).
    writing: Vec<bool>,
    /// Every chunk below this one is requested or written (a search hint).
    unclaimed_from: usize,
    /// Per peer: its requested chunks of this piece not written yet.
    outstanding: Vec<(PeerHandle, u32)>,
}

/// reel: a chunk of a shared piece requested this long ago and still missing
/// may be requested from another peer (its peer is slow, choked us or went
/// quiet). Whichever copy arrives first is written.
const STALE_CLAIM: Duration = Duration::from_secs(2);

/// reel: a peer may have at least this many chunks of a shared piece
/// requested at once.
const MIN_SHARE: u32 = 4;

impl SharedChunks {
    fn new(n: usize) -> Self {
        Self {
            claims: vec![None; n],
            writing: vec![false; n],
            unclaimed_from: 0,
            outstanding: Vec::new(),
        }
    }

    fn outstanding(&self, peer: PeerHandle) -> u32 {
        self.outstanding
            .iter()
            .find(|(p, _)| *p == peer)
            .map_or(0, |(_, n)| *n)
    }

    fn add_outstanding(&mut self, peer: PeerHandle, delta: i32) {
        match self.outstanding.iter_mut().find(|(p, _)| *p == peer) {
            Some((_, n)) => *n = n.saturating_add_signed(delta),
            None if delta > 0 => self.outstanding.push((peer, delta as u32)),
            None => {}
        }
    }

    /// The chunk `peer` should request next: the first missing one nobody
    /// requested, else the first missing one another peer requested more
    /// than [`STALE_CLAIM`] ago; None when there is none or the peer has its
    /// share (`cap`) requested. `missing(i)`: chunk i is not written.
    fn free(&self, peer: PeerHandle, cap: u32, missing: impl Fn(usize) -> bool) -> Option<usize> {
        if self.outstanding(peer) >= cap {
            return None;
        }
        let missing = |i: usize| !self.writing[i] && missing(i);
        let n = self.claims.len();
        (self.unclaimed_from..n)
            .find(|&i| self.claims[i].is_none() && missing(i))
            .or_else(|| {
                (0..n).find(|&i| {
                    matches!(self.claims[i], Some((p, at)) if p != peer && at.elapsed() >= STALE_CLAIM)
                        && missing(i)
                })
            })
    }

    fn claim(&mut self, i: usize, peer: PeerHandle, now: Instant) {
        if let Some((old, _)) = self.claims[i] {
            self.add_outstanding(old, -1);
        }
        self.claims[i] = Some((peer, now));
        self.add_outstanding(peer, 1);
        while self.unclaimed_from < self.claims.len() && self.claims[self.unclaimed_from].is_some()
        {
            self.unclaimed_from += 1;
        }
    }

    /// Chunk i is written: it no longer counts for the peer that requested it.
    fn written(&mut self, i: usize) {
        self.writing[i] = false;
        if let Some((p, _)) = self.claims[i] {
            self.add_outstanding(p, -1);
        }
    }

    /// The peer is gone: its requests are free for others.
    fn drop_peer(&mut self, peer: PeerHandle) {
        for (i, c) in self.claims.iter_mut().enumerate() {
            if matches!(c, Some((p, _)) if *p == peer) {
                *c = None;
                self.unclaimed_from = self.unclaimed_from.min(i);
            }
        }
        self.outstanding.retain(|(p, _)| *p != peer);
    }
}

/// Result of attempting to acquire a piece.
#[derive(Debug)]
pub enum AcquireResult {
    /// A new piece was reserved from the queue.
    Reserved(ValidPieceIndex),
    /// A piece was stolen from a slower peer.
    Stolen {
        piece: ValidPieceIndex,
        from_peer: PeerHandle,
    },
    /// reel: the peer joins a shared piece other peers are downloading too.
    Joined(ValidPieceIndex),
    /// No pieces are available for this peer.
    NoneAvailable,
}

/// Parameters for acquiring a piece.
pub struct AcquireRequest<'a, I, P, S>
where
    I: Iterator<Item = ValidPieceIndex>,
    P: Fn(ValidPieceIndex) -> bool,
    S: Fn(ValidPieceIndex) -> bool,
{
    /// The peer requesting a piece.
    pub peer: PeerHandle,
    /// The peer's average piece download time (for steal calculations).
    pub peer_avg_time: Option<Duration>,
    /// Priority pieces to check first (e.g., for streaming).
    pub priority_pieces: I,
    /// File download priority ordering.
    pub file_priorities: &'a FilePriorities,
    /// File metadata for iterating pieces.
    pub file_infos: &'a FileInfos,
    /// Returns true if the peer has the given piece.
    pub peer_has_piece: P,
    /// Returns true if the piece can be stolen (e.g., not locked for writing).
    pub can_steal: S,
}

/// Coordinates piece download state.
///
/// Wraps a [`ChunkTracker`] with tracking of which pieces are currently being downloaded
/// (in-flight) and by which peer. This ensures that:
///
/// - A piece is only assigned to one peer at a time (unless stolen)
/// - Pieces are properly requeued when a peer dies
/// - State transitions maintain invariants
pub struct PieceTracker {
    chunks: ChunkTracker,
    inflight: HashMap<ValidPieceIndex, InflightPiece>,
    /// reel: live peers, which split a shared piece (see [`SharedChunks`]).
    sharing_peers: usize,
}

impl PieceTracker {
    // === CONSTRUCTION ===

    /// Create a new PieceTracker wrapping the given ChunkTracker.
    pub fn new(chunks: ChunkTracker) -> Self {
        Self {
            chunks,
            inflight: HashMap::new(),
            sharing_peers: 1,
        }
    }

    /// Read-only access to the underlying ChunkTracker.
    pub fn chunks(&self) -> &ChunkTracker {
        &self.chunks
    }

    /// Consume the PieceTracker, requeuing any in-flight pieces.
    ///
    /// This is used when pausing a torrent - any pieces that were being downloaded
    /// need to be put back in the queue so they can be re-downloaded on resume.
    pub fn into_chunks(mut self) -> ChunkTracker {
        // Requeue all in-flight pieces so they'll be re-downloaded on resume
        for piece in self.inflight.into_keys() {
            self.chunks.mark_piece_broken_if_not_have(piece);
        }
        self.chunks
    }

    // === PIECE ACQUISITION ===

    /// Attempt to acquire a piece for the requesting peer.
    ///
    /// The acquisition strategy is:
    /// 1. Try to steal a piece from a peer that's 10x slower
    /// 2. Try to reserve a piece from the queue (priority pieces first)
    /// 3. Try to steal a piece from a peer that's 3x slower
    ///
    /// If `Stolen` is returned, the caller MUST call `peers.on_steal()` to notify
    /// the old peer and update counters.
    pub fn acquire_piece<I, P, S>(&mut self, mut req: AcquireRequest<I, P, S>) -> AcquireResult
    where
        I: Iterator<Item = ValidPieceIndex>,
        P: Fn(ValidPieceIndex) -> bool,
        S: Fn(ValidPieceIndex) -> bool,
    {
        // 1. Try steal with 10x threshold (very slow peer)
        if let Some(result) = self.try_steal(&req, 10.0) {
            return result;
        }

        // 2. Try reserve from priority_pieces then queued pieces
        // reel: priority pieces (what the streams need next) are shared. In
        // order, the first one the peer has that is not downloaded: a new one
        // is reserved and shared, one in flight is joined if it has a chunk
        // to request.
        for piece in &mut req.priority_pieces {
            if self.chunks.is_piece_have(piece) || !(req.peer_has_piece)(piece) {
                continue;
            }
            if !self.inflight.contains_key(&piece) {
                let result = self.reserve_piece(piece, req.peer);
                self.share(piece);
                return result;
            }
            self.share(piece);
            if self.free_chunk(piece, req.peer).is_some() {
                return AcquireResult::Joined(piece);
            }
        }

        // reel: a shared piece that is no longer a priority (the stream moved
        // on) and has chunks nobody is fetching: finish it before new pieces,
        // or it would stay in flight forever.
        let orphan = self
            .inflight
            .iter()
            .filter(|(p, i)| i.shared.is_some() && (req.peer_has_piece)(**p))
            .map(|(p, _)| *p)
            .find(|p| self.free_chunk(*p, req.peer).is_some());
        if let Some(piece) = orphan {
            return AcquireResult::Joined(piece);
        }

        // Then check naturally ordered queued pieces
        // Note: iter_queued_pieces only returns pieces in queue_pieces (not in-flight)
        let queued: Vec<_> = self
            .chunks
            .iter_queued_pieces(req.file_priorities, req.file_infos)
            .collect();

        for piece in queued {
            if (req.peer_has_piece)(piece) {
                return self.reserve_piece(piece, req.peer);
            }
        }

        // 3. Try steal with 3x threshold (moderately slow peer)
        if let Some(result) = self.try_steal(&req, 3.0) {
            return result;
        }

        AcquireResult::NoneAvailable
    }

    /// Reserve a piece: remove from queue, add to inflight.
    fn reserve_piece(&mut self, piece: ValidPieceIndex, peer: PeerHandle) -> AcquireResult {
        self.chunks.reserve_needed_piece(piece);
        self.inflight.insert(
            piece,
            InflightPiece {
                peer,
                started: Instant::now(),
                writers: Vec::new(),
                next_chunk: 0,
                shared: None,
            },
        );
        AcquireResult::Reserved(piece)
    }

    /// reel: shares an in-flight piece (see [`SharedChunks`]). The chunks its
    /// peer requested so far stay its own.
    fn share(&mut self, piece: ValidPieceIndex) {
        let n = self.chunks.get_lengths().chunks_per_piece(piece) as usize;
        let Some(info) = self.inflight.get(&piece) else {
            return;
        };
        if info.shared.is_some() {
            return;
        }
        let (owner, requested) = (info.peer, info.next_chunk as usize);
        let mut shared = SharedChunks::new(n);
        let now = Instant::now();
        for i in 0..requested.min(n) {
            if !self.chunks.is_chunk_downloaded(piece, i as u32) {
                shared.claim(i, owner, now);
            }
        }
        if let Some(info) = self.inflight.get_mut(&piece) {
            info.shared = Some(shared);
        }
    }

    /// reel: how many peers share pieces now (the live peers).
    pub fn set_sharing_peers(&mut self, peers: usize) {
        self.sharing_peers = peers;
    }

    /// reel: the chunk of shared `piece` that `peer` should request next
    /// (see [`SharedChunks::free`]).
    fn free_chunk(&self, piece: ValidPieceIndex, peer: PeerHandle) -> Option<u32> {
        let shared = self.inflight.get(&piece)?.shared.as_ref()?;
        let n = shared.claims.len() as u32;
        let cap = n.div_ceil(self.sharing_peers.max(1) as u32).max(MIN_SHARE);
        shared
            .free(peer, cap, |i| !self.chunks.is_chunk_downloaded(piece, i as u32))
            .map(|i| i as u32)
    }

    /// reel: the next chunk of `piece` for `peer` to request; None when it
    /// has none left there (the piece is done or was taken by another peer,
    /// or the peer has its share of a shared piece requested). Peers request
    /// a piece's chunks through this one at a time, so a piece can be shared
    /// while it is being downloaded.
    pub fn next_chunk(&mut self, piece: ValidPieceIndex, peer: PeerHandle) -> Option<ChunkInfo> {
        let info = self.inflight.get(&piece)?;
        let index = if info.shared.is_some() {
            let i = self.free_chunk(piece, peer)?;
            let shared = self.inflight.get_mut(&piece)?.shared.as_mut()?;
            shared.claim(i as usize, peer, Instant::now());
            i
        } else {
            if info.peer != peer {
                return None;
            }
            let n = self.chunks.get_lengths().chunks_per_piece(piece);
            let mut i = info.next_chunk;
            while i < n && self.chunks.is_chunk_downloaded(piece, i) {
                i += 1;
            }
            if i >= n {
                return None;
            }
            self.inflight.get_mut(&piece)?.next_chunk = i + 1;
            i
        };
        let lengths = self.chunks.get_lengths();
        lengths.chunk_info_from_received_data(
            piece,
            index * CHUNK_SIZE,
            lengths.chunk_size(piece, index)?,
        )
    }

    /// reel: whether `peer`, which requested `chunk`, may write it now. A
    /// piece one peer downloads takes chunks only from that peer (as
    /// upstream). A shared one takes a chunk from whichever peer sends it
    /// first, once: the chunk is marked as being written until
    /// [`Self::mark_chunk_downloaded`].
    pub fn start_writing_chunk(&mut self, chunk: &ChunkInfo, peer: PeerHandle) -> bool {
        let downloaded = self
            .chunks
            .is_chunk_downloaded(chunk.piece_index, chunk.chunk_index);
        let Some(info) = self.inflight.get_mut(&chunk.piece_index) else {
            return false;
        };
        let Some(shared) = info.shared.as_mut() else {
            return info.peer == peer;
        };
        match shared.writing.get_mut(chunk.chunk_index as usize) {
            Some(w) if !*w && !downloaded => {
                *w = true;
                true
            }
            _ => false,
        }
    }

    /// Try to steal a piece from a slower peer.
    fn try_steal<I, P, S>(
        &mut self,
        req: &AcquireRequest<I, P, S>,
        threshold: f64,
    ) -> Option<AcquireResult>
    where
        I: Iterator<Item = ValidPieceIndex>,
        P: Fn(ValidPieceIndex) -> bool,
        S: Fn(ValidPieceIndex) -> bool,
    {
        let my_avg = req.peer_avg_time?;
        let min_elapsed = Duration::from_secs_f64(my_avg.as_secs_f64() * threshold);

        // Find the slowest piece from another peer that exceeds threshold
        // and that the stealing peer actually has (can download)
        let (piece, old_peer, _) = self
            .inflight
            .iter()
            // reel: shared pieces are never stolen, peers join them instead.
            .filter(|(_, info)| info.shared.is_none())
            .filter(|(_, info)| info.peer != req.peer)
            .filter(|(p, _)| (req.peer_has_piece)(**p))
            .map(|(p, info)| (*p, info.peer, info.started.elapsed()))
            .filter(|(_, _, elapsed)| *elapsed >= min_elapsed)
            .max_by_key(|(_, _, elapsed)| *elapsed)?;

        // Check can_steal (e.g., per_piece_lock)
        if !(req.can_steal)(piece) {
            return None;
        }

        // Update ownership (piece stays in inflight, just changes owner)
        let info = self.inflight.get_mut(&piece)?;
        info.peer = req.peer;
        info.started = Instant::now();
        info.next_chunk = 0;

        Some(AcquireResult::Stolen {
            piece,
            from_peer: old_peer,
        })
    }

    // === PIECE COMPLETION ===

    /// Remove piece from inflight tracking (e.g., after all chunks received).
    ///
    /// Returns download duration if piece was in-flight.
    /// Note: Does NOT mark the piece as downloaded - caller should do hash check
    /// and then call `mark_piece_hash_ok` or `mark_piece_hash_failed`.
    pub fn take_inflight(&mut self, piece: ValidPieceIndex) -> Option<Duration> {
        let inflight = self.inflight.remove(&piece)?;
        Some(inflight.started.elapsed())
    }

    /// Mark piece as downloaded after successful hash verification.
    pub fn mark_piece_hash_ok(&mut self, piece: ValidPieceIndex) {
        self.chunks.mark_piece_downloaded(piece);
    }

    /// Forget a piece we have (its data is gone from the storage). See
    /// [`ChunkTracker::mark_piece_forgotten`]. A piece we have is never in-flight.
    pub fn forget_piece(&mut self, piece: ValidPieceIndex, file_infos: &FileInfos) -> bool {
        self.chunks.mark_piece_forgotten(piece, file_infos)
    }

    /// Mark piece as failed after hash verification failure - requeues the piece.
    pub fn mark_piece_hash_failed(&mut self, piece: ValidPieceIndex) {
        self.chunks.mark_piece_broken_if_not_have(piece);
    }

    /// Release all pieces owned by a peer (on peer death).
    ///
    /// Moves all pieces owned by the peer from IN_FLIGHT back to QUEUED.
    /// Returns the number of pieces released.
    pub fn release_pieces_owned_by(&mut self, peer: PeerHandle) -> usize {
        // reel: a shared piece stays in flight with what it has; the peer's
        // requested chunks are free for others (or the orphan pass in
        // acquire_piece).
        for info in self.inflight.values_mut() {
            if let Some(shared) = info.shared.as_mut() {
                shared.drop_peer(peer);
            }
        }
        // Collect pieces to release (can't modify while iterating)
        let pieces_to_release: Vec<_> = self
            .inflight
            .iter()
            .filter(|(_, info)| info.peer == peer && info.shared.is_none())
            .map(|(p, _)| *p)
            .collect();

        let count = pieces_to_release.len();
        for piece in pieces_to_release {
            self.inflight.remove(&piece);
            self.chunks.mark_piece_broken_if_not_have(piece);
        }
        count
    }

    // === QUERIES ===

    /// Get the inflight info for a piece, if it's currently being downloaded.
    pub fn get_inflight(&self, piece: ValidPieceIndex) -> Option<&InflightPiece> {
        self.inflight.get(&piece)
    }

    /// Check if a piece is currently in-flight.
    #[allow(dead_code)]
    pub fn is_inflight(&self, piece: ValidPieceIndex) -> bool {
        self.inflight.contains_key(&piece)
    }

    /// Get the number of pieces currently in-flight.
    #[allow(dead_code)]
    pub fn inflight_count(&self) -> usize {
        self.inflight.len()
    }

    /// reel: whether the in-flight `piece` is shared.
    pub fn is_shared(&self, piece: ValidPieceIndex) -> bool {
        self.inflight.get(&piece).is_some_and(|i| i.shared.is_some())
    }

    /// reel: notes that `peer` wrote a chunk of the in-flight `piece`.
    pub fn note_writer(&mut self, piece: ValidPieceIndex, peer: PeerHandle) {
        if let Some(info) = self.inflight.get_mut(&piece)
            && !info.writers.contains(&peer)
        {
            info.writers.push(peer);
        }
    }

    /// reel: how many peers wrote chunks of the in-flight `piece`.
    pub fn writers(&self, piece: ValidPieceIndex) -> usize {
        self.inflight.get(&piece).map_or(0, |i| i.writers.len())
    }

    // === PASS-THROUGH METHODS ===

    /// Mark a chunk as downloaded. Returns the result indicating if the piece is complete.
    pub fn mark_chunk_downloaded(
        &mut self,
        piece: &Piece<ByteBuf<'_>>,
    ) -> Option<ChunkMarkingResult> {
        // reel: the chunk is no longer being written.
        if let Some(info) = self
            .chunks
            .get_lengths()
            .validate_piece_index(piece.index)
            .and_then(|p| self.inflight.get_mut(&p))
            && let Some(shared) = info.shared.as_mut()
            && ((piece.begin / CHUNK_SIZE) as usize) < shared.claims.len()
        {
            shared.written((piece.begin / CHUNK_SIZE) as usize);
        }
        self.chunks.mark_chunk_downloaded(piece)
    }

    /// Update which files are selected for download.
    pub fn update_only_files(
        &mut self,
        file_infos: &FileInfos,
        new_only_files: &HashSet<usize>,
    ) -> anyhow::Result<crate::chunk_tracker::HaveNeededSelected> {
        self.chunks.update_only_files(file_infos, new_only_files)
    }

    /// Update per-file have bytes when a piece completes. Returns remaining bytes for the file.
    pub fn update_file_have_on_piece_completed(
        &mut self,
        piece_id: ValidPieceIndex,
        file_id: usize,
        file_info: &FileInfo,
    ) -> u64 {
        self.chunks
            .update_file_have_on_piece_completed(piece_id, file_id, file_info)
    }

    /// Flush the have pieces bitfield to disk.
    pub fn flush_have_pieces(&mut self, flush_async: bool) -> anyhow::Result<()> {
        self.chunks.get_have_pieces_mut().flush(flush_async)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{bitv::BitV as BitVTrait, type_aliases::BF};
    use librqbit_core::lengths::Lengths;
    use std::net::{IpAddr, Ipv4Addr, SocketAddr};

    fn peer(id: u8) -> PeerHandle {
        SocketAddr::new(IpAddr::V4(Ipv4Addr::new(127, 0, 0, id)), 6881)
    }

    /// Create a simple ChunkTracker for testing.
    /// Creates a torrent with the specified number of pieces, all selected.
    fn make_test_chunk_tracker(num_pieces: u32) -> ChunkTracker {
        // Create a simple single-file torrent
        let piece_length = 16384u32; // 16KB pieces
        let total_length = piece_length as u64 * num_pieces as u64;

        let lengths = Lengths::new(total_length, piece_length).unwrap();

        let bf_len = lengths.piece_bitfield_bytes();

        // No pieces downloaded yet (empty have)
        let have = BF::from_boxed_slice(vec![0u8; bf_len].into_boxed_slice());

        // All pieces selected
        let mut selected = BF::from_boxed_slice(vec![0u8; bf_len].into_boxed_slice());
        for i in 0..num_pieces as usize {
            selected.set(i, true);
        }

        // Single file spanning all pieces
        let file_infos = vec![crate::file_info::FileInfo {
            relative_filename: "test.dat".into(),
            offset_in_torrent: 0,
            len: total_length,
            piece_range: 0..num_pieces,
            attrs: Default::default(),
        }];

        ChunkTracker::new(have.into_dyn(), selected, lengths, &file_infos).unwrap()
    }

    fn make_test_file_infos(num_pieces: u32) -> FileInfos {
        let piece_length = 16384u64;
        vec![crate::file_info::FileInfo {
            relative_filename: "test.dat".into(),
            offset_in_torrent: 0,
            len: piece_length * num_pieces as u64,
            piece_range: 0..num_pieces,
            attrs: Default::default(),
        }]
    }

    fn make_default_file_priorities(file_infos: &FileInfos) -> FilePriorities {
        (0..file_infos.len()).collect()
    }

    #[test]
    fn test_new_piece_tracker() {
        let chunks = make_test_chunk_tracker(10);
        let tracker = PieceTracker::new(chunks);
        assert_eq!(tracker.inflight_count(), 0);
    }

    #[test]
    fn test_reserve_piece_from_queue() {
        let chunks = make_test_chunk_tracker(5);
        let mut tracker = PieceTracker::new(chunks);

        let file_infos = make_test_file_infos(5);
        let file_priorities = make_default_file_priorities(&file_infos);

        let result = tracker.acquire_piece(AcquireRequest {
            peer: peer(1),
            peer_avg_time: None,
            priority_pieces: std::iter::empty(),
            file_priorities: &file_priorities,
            file_infos: &file_infos,
            peer_has_piece: |_| true, // Peer has all pieces
            can_steal: |_| true,
        });

        // Should reserve piece 0 (first in queue)
        match result {
            AcquireResult::Reserved(piece) => {
                assert_eq!(piece.get(), 0);
                assert!(tracker.is_inflight(piece));
                assert_eq!(tracker.inflight_count(), 1);
            }
            _ => panic!("Expected Reserved, got {:?}", result),
        }
    }

    #[test]
    fn test_reserve_filters_by_peer_has_piece() {
        let chunks = make_test_chunk_tracker(5);
        let mut tracker = PieceTracker::new(chunks);

        let file_infos = make_test_file_infos(5);
        let file_priorities = make_default_file_priorities(&file_infos);

        // Peer only has piece 2 and later
        // Note: iter_queued_pieces iterates in order: first, last, middle
        // So for 0..5: 0, 4, 1, 2, 3
        // With filter >= 2, we get 4 first (skips 0, takes 4)
        let result = tracker.acquire_piece(AcquireRequest {
            peer: peer(1),
            peer_avg_time: None,
            priority_pieces: std::iter::empty(),
            file_priorities: &file_priorities,
            file_infos: &file_infos,
            peer_has_piece: |p| p.get() >= 2,
            can_steal: |_| true,
        });

        match result {
            AcquireResult::Reserved(piece) => {
                // Got piece 4 (first one peer has in iteration order)
                assert!(piece.get() >= 2, "Should have gotten a piece >= 2");
            }
            _ => panic!("Expected Reserved, got {:?}", result),
        }
    }

    #[test]
    fn test_complete_piece() {
        let chunks = make_test_chunk_tracker(5);
        let mut tracker = PieceTracker::new(chunks);

        let file_infos = make_test_file_infos(5);
        let file_priorities = make_default_file_priorities(&file_infos);

        // Reserve a piece first
        let result = tracker.acquire_piece(AcquireRequest {
            peer: peer(1),
            peer_avg_time: None,
            priority_pieces: std::iter::empty(),
            file_priorities: &file_priorities,
            file_infos: &file_infos,
            peer_has_piece: |_| true,
            can_steal: |_| true,
        });

        let piece = match result {
            AcquireResult::Reserved(p) => p,
            _ => panic!("Expected Reserved"),
        };

        // Complete the piece (take_inflight + hash check + mark_piece_hash_ok)
        let duration = tracker.take_inflight(piece);
        assert!(duration.is_some());
        assert!(!tracker.is_inflight(piece));
        // Simulate successful hash check
        tracker.mark_piece_hash_ok(piece);
        assert!(tracker.chunks().is_piece_have(piece));
    }

    #[test]
    fn test_fail_piece_requeues() {
        let chunks = make_test_chunk_tracker(5);
        let mut tracker = PieceTracker::new(chunks);

        let file_infos = make_test_file_infos(5);
        let file_priorities = make_default_file_priorities(&file_infos);

        // Reserve piece 0
        let result = tracker.acquire_piece(AcquireRequest {
            peer: peer(1),
            peer_avg_time: None,
            priority_pieces: std::iter::empty(),
            file_priorities: &file_priorities,
            file_infos: &file_infos,
            peer_has_piece: |_| true,
            can_steal: |_| true,
        });

        let piece = match result {
            AcquireResult::Reserved(p) => p,
            _ => panic!("Expected Reserved"),
        };

        assert!(tracker.is_inflight(piece));

        // Fail the piece (take_inflight + hash check fails + mark_piece_hash_failed)
        let duration = tracker.take_inflight(piece);
        assert!(duration.is_some());
        // Simulate failed hash check
        tracker.mark_piece_hash_failed(piece);

        // Should no longer be in-flight
        assert!(!tracker.is_inflight(piece));
        // Should not be in have
        assert!(!tracker.chunks().is_piece_have(piece));
        // Should be back in queue - verify by trying to reserve it again
        let result2 = tracker.acquire_piece(AcquireRequest {
            peer: peer(2),
            peer_avg_time: None,
            priority_pieces: std::iter::empty(),
            file_priorities: &file_priorities,
            file_infos: &file_infos,
            peer_has_piece: |p| p == piece, // Only has the failed piece
            can_steal: |_| true,
        });

        match result2 {
            AcquireResult::Reserved(p) => assert_eq!(p, piece),
            _ => panic!("Expected piece to be re-reservable after fail"),
        }
    }

    #[test]
    fn test_release_pieces_owned_by_peer() {
        let chunks = make_test_chunk_tracker(5);
        let mut tracker = PieceTracker::new(chunks);

        let file_infos = make_test_file_infos(5);
        let file_priorities = make_default_file_priorities(&file_infos);

        let peer_a = peer(1);
        let peer_b = peer(2);

        // Peer A reserves first two pieces (order: 0, 4, 1, 2, 3)
        // So peer A gets pieces 0 and 4
        let piece_a1 = match tracker.acquire_piece(AcquireRequest {
            peer: peer_a,
            peer_avg_time: None,
            priority_pieces: std::iter::empty(),
            file_priorities: &file_priorities,
            file_infos: &file_infos,
            peer_has_piece: |_| true,
            can_steal: |_| true,
        }) {
            AcquireResult::Reserved(p) => p,
            _ => panic!("Expected Reserved"),
        };
        let piece_a2 = match tracker.acquire_piece(AcquireRequest {
            peer: peer_a,
            peer_avg_time: None,
            priority_pieces: std::iter::empty(),
            file_priorities: &file_priorities,
            file_infos: &file_infos,
            peer_has_piece: |_| true,
            can_steal: |_| true,
        }) {
            AcquireResult::Reserved(p) => p,
            _ => panic!("Expected Reserved"),
        };

        // Peer B reserves next piece
        let piece_b = match tracker.acquire_piece(AcquireRequest {
            peer: peer_b,
            peer_avg_time: None,
            priority_pieces: std::iter::empty(),
            file_priorities: &file_priorities,
            file_infos: &file_infos,
            peer_has_piece: |_| true,
            can_steal: |_| true,
        }) {
            AcquireResult::Reserved(p) => p,
            _ => panic!("Expected Reserved"),
        };

        assert_eq!(tracker.inflight_count(), 3);
        assert!(tracker.is_inflight(piece_a1));
        assert!(tracker.is_inflight(piece_a2));
        assert!(tracker.is_inflight(piece_b));

        // Peer A dies
        let released = tracker.release_pieces_owned_by(peer_a);
        assert_eq!(released, 2);
        assert_eq!(tracker.inflight_count(), 1); // Only peer B's piece remains

        // Verify peer B's piece is still in-flight
        assert!(tracker.is_inflight(piece_b));
        // Verify peer A's pieces are no longer in-flight
        assert!(!tracker.is_inflight(piece_a1));
        assert!(!tracker.is_inflight(piece_a2));
    }

    #[test]
    fn test_into_chunks_requeues_inflight() {
        let chunks = make_test_chunk_tracker(5);
        let mut tracker = PieceTracker::new(chunks);

        let file_infos = make_test_file_infos(5);
        let file_priorities = make_default_file_priorities(&file_infos);

        // Reserve pieces 0 and 1
        tracker.acquire_piece(AcquireRequest {
            peer: peer(1),
            peer_avg_time: None,
            priority_pieces: std::iter::empty(),
            file_priorities: &file_priorities,
            file_infos: &file_infos,
            peer_has_piece: |_| true,
            can_steal: |_| true,
        });
        tracker.acquire_piece(AcquireRequest {
            peer: peer(1),
            peer_avg_time: None,
            priority_pieces: std::iter::empty(),
            file_priorities: &file_priorities,
            file_infos: &file_infos,
            peer_has_piece: |_| true,
            can_steal: |_| true,
        });

        assert_eq!(tracker.inflight_count(), 2);

        // Convert back to chunks (simulates pause)
        let chunks = tracker.into_chunks();

        // Create a new tracker and verify pieces are back in queue
        let mut new_tracker = PieceTracker::new(chunks);
        let result = new_tracker.acquire_piece(AcquireRequest {
            peer: peer(2),
            peer_avg_time: None,
            priority_pieces: std::iter::empty(),
            file_priorities: &file_priorities,
            file_infos: &file_infos,
            peer_has_piece: |_| true,
            can_steal: |_| true,
        });

        // Should get piece 0 again (was requeued)
        match result {
            AcquireResult::Reserved(p) => assert_eq!(p.get(), 0),
            _ => panic!("Expected to reserve piece 0 after into_chunks"),
        }
    }

    #[test]
    fn test_priority_pieces_checked_first() {
        let chunks = make_test_chunk_tracker(5);
        let mut tracker = PieceTracker::new(chunks);

        let file_infos = make_test_file_infos(5);
        let file_priorities = make_default_file_priorities(&file_infos);

        // Priority pieces: piece 3, then piece 2
        let piece3 = tracker
            .chunks()
            .get_lengths()
            .validate_piece_index(3)
            .unwrap();
        let piece2 = tracker
            .chunks()
            .get_lengths()
            .validate_piece_index(2)
            .unwrap();
        let priority = vec![piece3, piece2];

        let result = tracker.acquire_piece(AcquireRequest {
            peer: peer(1),
            peer_avg_time: None,
            priority_pieces: priority.into_iter(),
            file_priorities: &file_priorities,
            file_infos: &file_infos,
            peer_has_piece: |_| true,
            can_steal: |_| true,
        });

        // Should get piece 3 (first priority piece)
        match result {
            AcquireResult::Reserved(p) => assert_eq!(p.get(), 3),
            _ => panic!("Expected Reserved(3), got {:?}", result),
        }
    }

    #[test]
    fn test_none_available_when_no_pieces() {
        let chunks = make_test_chunk_tracker(5);
        let mut tracker = PieceTracker::new(chunks);

        let file_infos = make_test_file_infos(5);
        let file_priorities = make_default_file_priorities(&file_infos);

        // Peer has no pieces
        let result = tracker.acquire_piece(AcquireRequest {
            peer: peer(1),
            peer_avg_time: None,
            priority_pieces: std::iter::empty(),
            file_priorities: &file_priorities,
            file_infos: &file_infos,
            peer_has_piece: |_| false, // Peer has nothing
            can_steal: |_| true,
        });

        match result {
            AcquireResult::NoneAvailable => {}
            _ => panic!("Expected NoneAvailable, got {:?}", result),
        }
    }

    #[test]
    fn test_take_inflight_nonexistent_piece_returns_none() {
        let chunks = make_test_chunk_tracker(5);
        let mut tracker = PieceTracker::new(chunks);
        let piece = tracker
            .chunks()
            .get_lengths()
            .validate_piece_index(0)
            .unwrap();

        // Try to take a piece that's not in-flight
        let result = tracker.take_inflight(piece);
        assert!(result.is_none());
    }

    #[test]
    fn test_steal_only_pieces_peer_has() {
        // This test verifies the fix for a bug where try_steal didn't check
        // if the stealing peer actually has the piece in their bitfield.
        // Without this check, a peer could "steal" a piece they can't download,
        // leaving it stuck in inflight forever.

        let chunks = make_test_chunk_tracker(5);
        let mut tracker = PieceTracker::new(chunks);

        let file_infos = make_test_file_infos(5);
        let file_priorities = make_default_file_priorities(&file_infos);

        let peer_a = peer(1);
        let peer_b = peer(2);

        // Peer A reserves pieces 0 and 4 (first two in iteration order)
        let piece_0 = match tracker.acquire_piece(AcquireRequest {
            peer: peer_a,
            peer_avg_time: None,
            priority_pieces: std::iter::empty(),
            file_priorities: &file_priorities,
            file_infos: &file_infos,
            peer_has_piece: |_| true,
            can_steal: |_| true,
        }) {
            AcquireResult::Reserved(p) => {
                assert_eq!(p.get(), 0);
                p
            }
            _ => panic!("Expected Reserved"),
        };

        let piece_4 = match tracker.acquire_piece(AcquireRequest {
            peer: peer_a,
            peer_avg_time: None,
            priority_pieces: std::iter::empty(),
            file_priorities: &file_priorities,
            file_infos: &file_infos,
            peer_has_piece: |_| true,
            can_steal: |_| true,
        }) {
            AcquireResult::Reserved(p) => {
                assert_eq!(p.get(), 4);
                p
            }
            _ => panic!("Expected Reserved"),
        };

        // Sleep briefly so pieces become stealable
        std::thread::sleep(Duration::from_millis(5));

        // Peer B tries to acquire with:
        // - Very short avg_time (1ms) so 3x threshold = 3ms < 5ms elapsed
        // - peer_has_piece returns true ONLY for piece 4, NOT piece 0
        let result = tracker.acquire_piece(AcquireRequest {
            peer: peer_b,
            peer_avg_time: Some(Duration::from_millis(1)),
            priority_pieces: std::iter::empty(),
            file_priorities: &file_priorities,
            file_infos: &file_infos,
            peer_has_piece: |p| p.get() == 4, // Peer B only has piece 4
            can_steal: |_| true,
        });

        // Should steal piece 4 (which peer B has), NOT piece 0 (which peer B doesn't have)
        match result {
            AcquireResult::Stolen { piece, from_peer } => {
                assert_eq!(piece, piece_4, "Should steal piece 4 (the one peer B has)");
                assert_eq!(from_peer, peer_a);
                // Verify piece 0 is still owned by peer A (wasn't stolen)
                assert_eq!(tracker.get_inflight(piece_0).unwrap().peer, peer_a);
            }
            _ => panic!("Expected Stolen, got {:?}", result),
        }
    }

    // reel: shared priority pieces.

    /// One file of `num_pieces` pieces of 8 chunks each.
    fn make_shared_test_tracker(num_pieces: u32) -> (PieceTracker, FileInfos) {
        let piece_length = CHUNK_SIZE * 8;
        let total_length = piece_length as u64 * num_pieces as u64;
        let lengths = Lengths::new(total_length, piece_length).unwrap();
        let bf_len = lengths.piece_bitfield_bytes();
        let have = BF::from_boxed_slice(vec![0u8; bf_len].into_boxed_slice());
        let selected = BF::from_boxed_slice(vec![0u8; bf_len].into_boxed_slice());
        let file_infos = vec![crate::file_info::FileInfo {
            relative_filename: "test.dat".into(),
            offset_in_torrent: 0,
            len: total_length,
            piece_range: 0..num_pieces,
            attrs: Default::default(),
        }];
        let chunks = ChunkTracker::new(have.into_dyn(), selected, lengths, &file_infos).unwrap();
        (PieceTracker::new(chunks), file_infos)
    }

    fn acquire_priority(
        tracker: &mut PieceTracker,
        file_infos: &FileInfos,
        who: PeerHandle,
        priority: &[u32],
    ) -> AcquireResult {
        let lengths = *tracker.chunks().get_lengths();
        let priority: Vec<_> = priority
            .iter()
            .map(|p| lengths.validate_piece_index(*p).unwrap())
            .collect();
        tracker.acquire_piece(AcquireRequest {
            peer: who,
            peer_avg_time: None,
            priority_pieces: priority.into_iter(),
            file_priorities: &make_default_file_priorities(file_infos),
            file_infos,
            peer_has_piece: |_| true,
            can_steal: |_| true,
        })
    }

    fn write(tracker: &mut PieceTracker, chunk: &ChunkInfo, who: PeerHandle) -> bool {
        if !tracker.start_writing_chunk(chunk, who) {
            return false;
        }
        let data = vec![0u8; chunk.size as usize];
        let piece = Piece::from_data(chunk.piece_index.get(), chunk.offset, &data);
        tracker.note_writer(chunk.piece_index, who);
        tracker.mark_chunk_downloaded(&piece);
        true
    }

    #[test]
    fn test_peers_share_a_priority_piece_chunk_by_chunk() {
        let (mut tracker, file_infos) = make_shared_test_tracker(4);
        tracker.set_sharing_peers(2);
        let (a, b) = (peer(1), peer(2));

        let p = match acquire_priority(&mut tracker, &file_infos, a, &[0, 1]) {
            AcquireResult::Reserved(p) => p,
            r => panic!("expected Reserved, got {r:?}"),
        };
        assert_eq!(p.get(), 0);
        // A takes its half (8 chunks, 2 peers) and no more.
        let a_chunks: Vec<_> = std::iter::from_fn(|| tracker.next_chunk(p, a)).collect();
        assert_eq!(a_chunks.iter().map(|c| c.chunk_index).collect::<Vec<_>>(), [0, 1, 2, 3]);

        // B joins the same piece rather than reserving piece 1, and gets the rest.
        match acquire_priority(&mut tracker, &file_infos, b, &[0, 1]) {
            AcquireResult::Joined(j) => assert_eq!(j, p),
            r => panic!("expected Joined, got {r:?}"),
        }
        let b_chunks: Vec<_> = std::iter::from_fn(|| tracker.next_chunk(p, b)).collect();
        assert_eq!(b_chunks.iter().map(|c| c.chunk_index).collect::<Vec<_>>(), [4, 5, 6, 7]);

        // A third peer finds nothing to join in piece 0 and reserves piece 1.
        match acquire_priority(&mut tracker, &file_infos, peer(3), &[0, 1]) {
            AcquireResult::Reserved(p1) => assert_eq!(p1.get(), 1),
            r => panic!("expected Reserved(1), got {r:?}"),
        }

        // A writes one chunk: it may request one more.
        assert!(write(&mut tracker, &a_chunks[0], a));
        assert!(tracker.next_chunk(p, a).is_none(), "no free chunk left in the piece");

        // Each chunk is written once, by whoever sends it first; then the piece completes.
        assert!(!write(&mut tracker, &a_chunks[0], b), "already written");
        for c in &a_chunks[1..] {
            assert!(write(&mut tracker, c, a));
        }
        for c in &b_chunks[..3] {
            assert!(write(&mut tracker, c, b));
        }
        let last = &b_chunks[3];
        assert!(tracker.start_writing_chunk(last, b));
        assert!(!tracker.start_writing_chunk(last, a), "being written by b");
        let data = vec![0u8; last.size as usize];
        let res = tracker.mark_chunk_downloaded(&Piece::from_data(0, last.offset, &data));
        assert!(matches!(res, Some(ChunkMarkingResult::Completed)));
        assert_eq!(tracker.writers(p), 2);
    }

    #[test]
    fn test_shared_piece_survives_its_peer() {
        let (mut tracker, file_infos) = make_shared_test_tracker(2);
        tracker.set_sharing_peers(1);
        let (a, b) = (peer(1), peer(2));
        let p = match acquire_priority(&mut tracker, &file_infos, a, &[0]) {
            AcquireResult::Reserved(p) => p,
            r => panic!("expected Reserved, got {r:?}"),
        };
        let chunks: Vec<_> = std::iter::from_fn(|| tracker.next_chunk(p, a)).collect();
        assert_eq!(chunks.len(), 8);
        assert!(write(&mut tracker, &chunks[0], a));

        // A dies: the piece keeps its written chunk and the rest are free for B,
        // even once it is no longer a priority.
        assert_eq!(tracker.release_pieces_owned_by(a), 0);
        assert!(tracker.is_inflight(p));
        match acquire_priority(&mut tracker, &file_infos, b, &[]) {
            AcquireResult::Joined(j) => assert_eq!(j, p),
            r => panic!("expected Joined, got {r:?}"),
        }
        let rest: Vec<_> = std::iter::from_fn(|| tracker.next_chunk(p, b))
            .map(|c| c.chunk_index)
            .collect();
        assert_eq!(rest, [1, 2, 3, 4, 5, 6, 7]);
    }

    #[test]
    fn test_a_piece_becomes_shared_when_it_turns_priority() {
        let (mut tracker, file_infos) = make_shared_test_tracker(2);
        tracker.set_sharing_peers(2);
        let (a, b) = (peer(1), peer(2));
        // Reserved as an ordinary piece (not a priority): A requests 3 chunks.
        let p = tracker.chunks().get_lengths().validate_piece_index(1).unwrap();
        tracker.reserve_piece(p, a);
        for want in 0..3 {
            assert_eq!(tracker.next_chunk(p, a).unwrap().chunk_index, want);
        }
        assert!(tracker.next_chunk(p, b).is_none(), "not B's piece");

        // The stream needs it now: B joins and takes the chunks A has not requested.
        match acquire_priority(&mut tracker, &file_infos, b, &[1]) {
            AcquireResult::Joined(j) => assert_eq!(j, p),
            r => panic!("expected Joined, got {r:?}"),
        }
        let b_chunks: Vec<_> = std::iter::from_fn(|| tracker.next_chunk(p, b))
            .map(|c| c.chunk_index)
            .collect();
        assert_eq!(b_chunks, [3, 4, 5, 6]);
        // A has 3 requested of its 4: one more.
        assert_eq!(tracker.next_chunk(p, a).unwrap().chunk_index, 7);
        assert!(tracker.next_chunk(p, a).is_none());
    }
}
