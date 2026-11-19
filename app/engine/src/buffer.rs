//! The engine's ring-buffer cache: a librqbit storage that keeps at most the
//! user's buffer size of a torrent on disk, a window around where the player
//! reads (most of it ahead, `BEHIND_PERCENT` behind for short seeks back).
//!
//! Each piece is a file of its own under the cache dir (so what is on disk is
//! exactly the stored pieces, and dropping one is an unlink). Before a new
//! piece is written the ring makes room: it evicts the stored pieces farthest
//! behind the readers first, then the farthest ahead of them, and tells the
//! torrent to forget them (vendored librqbit's `forget_pieces`), so a seek
//! back downloads them again. Pieces in a live reader's window, pieces being
//! written and pinned pieces (a seek's place, until the player has read it) are
//! never evicted.
//!
//! Only the pieces readers want are downloaded: the engine adds torrents with
//! no files selected, so librqbit fetches just the streams' readahead, which
//! the ring sizes to fit the budget (`Window`), split among the readers.

use std::{
    collections::BTreeMap,
    fs::{File, OpenOptions},
    io,
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex, Weak,
        atomic::{AtomicU64, AtomicUsize, Ordering},
    },
    time::{Duration, Instant},
};

use anyhow::Context;
use librqbit::{
    ManagedTorrent, ManagedTorrentShared, TorrentMetadata,
    storage::{BoxStorageFactory, StorageFactory, StorageFactoryExt, TorrentStorage},
};
use librqbit_core::lengths::ValidPieceIndex;

/// Share of the budget kept behind a reader, for short seeks back.
pub const BEHIND_PERCENT: u64 = 12;
pub use reel_domain::play::PLAYER_CACHE;
/// A reader not seen for this long is forgotten (unless it is the last one).
const FORGET_READER_AFTER: Duration = Duration::from_secs(60);
/// At most this many readers are remembered.
const MAX_READERS: usize = 4;
/// A partly written piece is left alone while it was written this recently
/// (it is being downloaded or hash-checked); older, its download was dropped.
const PARTIAL_IDLE: Duration = Duration::from_secs(30);

/// How a budget is split around one reader: bytes kept behind its position
/// and bytes downloaded ahead of it. Both windows round out to whole pieces,
/// one piece at each end, so `behind + ahead + 2 pieces` fits the budget.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Window {
    pub behind: u64,
    pub ahead: u64,
}

impl Window {
    /// `player_cache`: how far the player reads ahead of the picture (see `PLAYER_CACHE`).
    pub fn for_budget(budget: u64, piece_len: u64, player_cache: u64) -> Window {
        // Never more than half the budget behind: the reader must keep room ahead.
        let floor = if player_cache > 0 { player_cache + piece_len } else { 0 };
        let behind = (budget * BEHIND_PERCENT / 100).max(floor).min(budget / 2);
        // At least one piece ahead, or the reader could never move on: a
        // budget under ~3 pieces is exceeded rather than stalling playback.
        let ahead = budget.saturating_sub(behind + 2 * piece_len).max(piece_len);
        Window { behind, ahead }
    }

    /// This window split among `readers` (at least a piece ahead each).
    fn share(self, readers: usize, piece_len: u64) -> Window {
        let n = readers.max(1) as u64;
        Window { behind: self.behind / n, ahead: (self.ahead / n).max(piece_len) }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum State {
    /// Being written (or its download was dropped half way).
    Partial,
    /// Downloaded and verified.
    Complete,
    /// Chosen to be evicted; deleted once the torrent has forgotten it.
    Evicting,
}

#[derive(Clone, Copy, Debug)]
struct Slot {
    state: State,
    written: Instant,
}

/// Where a reader was last seen, as a byte offset in the torrent.
#[derive(Clone, Copy, Debug)]
struct Reader {
    at: u64,
    seen: Instant,
    /// Its stream is open now (it was in the last positions seen).
    live: bool,
}

/// The eviction policy, without the I/O: which pieces are stored, where the
/// readers are, and what to drop to fit a new piece in the budget.
#[derive(Debug)]
pub struct Policy {
    piece_len: u64,
    total_len: u64,
    budget: u64,
    window: Window,
    pieces: BTreeMap<u32, Slot>,
    /// Bytes of the stored pieces (not counting those being evicted).
    stored: u64,
    readers: Vec<Reader>,
    /// Pieces kept whatever the readers do, `(id, from, to)`: a seek's place until the
    /// player reads it (`pin`).
    pins: Vec<(u64, u32, u32)>,
    next_pin: u64,
}

impl Policy {
    #[cfg(test)]
    pub fn new(piece_len: u64, total_len: u64, budget: u64) -> Policy {
        Policy::with_player_cache(piece_len, total_len, budget, 0)
    }

    /// A policy for a player that reads `player_cache` ahead of the picture.
    pub fn with_player_cache(piece_len: u64, total_len: u64, budget: u64, player_cache: u64) -> Policy {
        Policy {
            piece_len,
            total_len,
            budget,
            window: Window::for_budget(budget, piece_len, player_cache),
            pieces: BTreeMap::new(),
            stored: 0,
            readers: Vec::new(),
            pins: Vec::new(),
            next_pin: 1,
        }
    }

    /// Keeps pieces `from..=to` until `unpin`; an id for it.
    pub fn pin(&mut self, from: u32, to: u32) -> u64 {
        let id = self.next_pin;
        self.next_pin += 1;
        self.pins.push((id, from, to));
        id
    }

    pub fn unpin(&mut self, id: u64) {
        self.pins.retain(|p| p.0 != id);
    }

    fn pinned(&self, piece: u32) -> bool {
        self.pins.iter().any(|&(_, from, to)| (from..=to).contains(&piece))
    }

    #[cfg(test)]
    pub fn stored_bytes(&self) -> u64 {
        self.stored
    }

    fn len_of(&self, piece: u32) -> u64 {
        let start = piece as u64 * self.piece_len;
        self.piece_len.min(self.total_len.saturating_sub(start))
    }

    fn piece_of(&self, offset: u64) -> u32 {
        (offset / self.piece_len) as u32
    }

    /// Whether the piece has a file on disk (complete, partial or about to go).
    pub fn has(&self, piece: u32) -> bool {
        self.pieces.contains_key(&piece)
    }

    /// The readers whose streams are open, or the last one seen when none is
    /// (a player paused between requests keeps its window).
    fn live_readers(&self) -> Vec<Reader> {
        let live: Vec<Reader> = self.readers.iter().copied().filter(|r| r.live).collect();
        if !live.is_empty() {
            return live;
        }
        self.readers.iter().copied().max_by_key(|r| r.seen).into_iter().collect()
    }

    /// The window each live reader gets now.
    pub fn share(&self) -> Window {
        self.window.share(self.live_readers().len(), self.piece_len)
    }

    /// Readahead librqbit should use for each stream now.
    pub fn readahead(&self) -> u64 {
        self.share().ahead
    }

    /// Records where the readers are (byte offsets in the torrent). A position
    /// inside a known reader's window is that reader moving on; any other is a
    /// new reader (a seek, or a second request).
    pub fn see(&mut self, positions: &[u64], now: Instant) {
        let w = self.window;
        let mut matched = vec![false; self.readers.len()];
        for &at in positions {
            let near = self
                .readers
                .iter()
                .enumerate()
                .filter(|(i, r)| !matched[*i] && at + w.behind >= r.at && at <= r.at + w.ahead)
                .min_by_key(|(_, r)| r.at.abs_diff(at))
                .map(|(i, _)| i);
            match near {
                Some(i) => {
                    matched[i] = true;
                    self.readers[i] = Reader { at, seen: now, live: true };
                }
                None => {
                    self.readers.push(Reader { at, seen: now, live: true });
                    matched.push(true);
                }
            }
        }
        for (r, m) in self.readers.iter_mut().zip(&matched) {
            r.live = *m;
        }
        let last = self.readers.iter().map(|r| r.seen).max();
        self.readers.retain(|r| Some(r.seen) == last || now.duration_since(r.seen) <= FORGET_READER_AFTER);
        self.readers.sort_by_key(|r| std::cmp::Reverse(r.seen));
        self.readers.truncate(MAX_READERS);
    }

    /// Pieces `[from, to]` a reader at `at` keeps with window `w`.
    fn kept(&self, at: u64, w: Window) -> (u32, u32) {
        let from = self.piece_of(at.saturating_sub(w.behind));
        let to = self.piece_of((at + w.ahead).saturating_sub(1).max(at));
        (from, to)
    }

    /// How eager we are to evict `piece`; None when it must stay. Bigger goes
    /// first: outside every live window before inside an old reader's, behind
    /// a reader before ahead of it, farther before nearer.
    fn eviction_rank(&self, piece: u32, slot: &Slot, live: &[Reader], share: Window, now: Instant) -> Option<(u8, u8, u64)> {
        match slot.state {
            State::Evicting => return None,
            State::Partial if now.duration_since(slot.written) < PARTIAL_IDLE => return None,
            _ => {}
        }
        let in_window = |readers: &[Reader]| {
            readers.iter().any(|r| {
                let (from, to) = self.kept(r.at, share);
                (from..=to).contains(&piece)
            })
        };
        if in_window(live) || self.pinned(piece) {
            return None;
        }
        let class = if in_window(&self.readers) { 0 } else { 1 };
        // Distance to the nearest live reader (any reader, if none is live).
        let start = piece as u64 * self.piece_len;
        let end = start + self.len_of(piece);
        let refs: &[Reader] = if live.is_empty() { &self.readers } else { live };
        let nearest = refs
            .iter()
            .map(|r| if end <= r.at { (1u8, r.at - end) } else { (0u8, start.saturating_sub(r.at)) })
            .min_by_key(|(_, d)| *d);
        Some(match nearest {
            Some((behind, distance)) => (class, behind, distance),
            // No reader ever: drop the oldest written first.
            None => (class, 0, now.duration_since(slot.written).as_millis() as u64),
        })
    }

    /// Makes room for `piece`, about to be written, and records it as stored.
    /// Returns the pieces to evict (now marked so); empty when it fits, or when
    /// it was already stored. When nothing may be evicted the budget is
    /// exceeded rather than failing the write (librqbit treats a failed write
    /// as fatal for the torrent): see `over_budget`.
    pub fn admit(&mut self, piece: u32, now: Instant) -> Vec<u32> {
        if self.touch(piece, now) {
            return Vec::new();
        }
        let len = self.len_of(piece);
        let live = self.live_readers();
        let share = self.share();
        let mut ranked: Vec<((u8, u8, u64), u32)> = self
            .pieces
            .iter()
            .filter(|(p, _)| **p != piece)
            .filter_map(|(p, s)| Some((self.eviction_rank(*p, s, &live, share, now)?, *p)))
            .collect();
        ranked.sort_unstable_by_key(|r| std::cmp::Reverse(r.0));
        let mut victims = Vec::new();
        for (_, victim) in ranked {
            if self.stored + len <= self.budget {
                break;
            }
            self.stored -= self.len_of(victim);
            if let Some(slot) = self.pieces.get_mut(&victim) {
                slot.state = State::Evicting;
            }
            victims.push(victim);
        }
        // A piece being evicted and wanted again keeps its file (the bytes are
        // the same); it is simply counted again.
        self.pieces.insert(piece, Slot { state: State::Partial, written: now });
        self.stored += len;
        victims
    }

    /// Notes a write to a stored piece; false when it is not stored (or is
    /// being evicted), so it needs `admit`.
    pub fn touch(&mut self, piece: u32, now: Instant) -> bool {
        match self.pieces.get_mut(&piece) {
            Some(slot) if slot.state != State::Evicting => {
                slot.written = now;
                true
            }
            _ => false,
        }
    }

    /// The piece passed its hash check.
    pub fn completed(&mut self, piece: u32) {
        if let Some(slot) = self.pieces.get_mut(&piece)
            && slot.state == State::Partial
        {
            slot.state = State::Complete;
        }
    }

    /// The torrent has forgotten `victims`: those still marked are dropped and
    /// returned, to delete their files (one wanted again meanwhile stays).
    pub fn evicted(&mut self, victims: &[u32]) -> Vec<u32> {
        victims
            .iter()
            .copied()
            .filter(|p| {
                let gone = self.pieces.get(p).is_some_and(|s| s.state == State::Evicting);
                if gone {
                    self.pieces.remove(p);
                }
                gone
            })
            .collect()
    }

    /// Drops pieces outright (their file is being removed); returns them.
    pub fn remove_range(&mut self, from: u32, to: u32) -> Vec<u32> {
        let gone: Vec<u32> = self.pieces.range(from..=to).map(|(p, _)| *p).collect();
        for p in &gone {
            if let Some(slot) = self.pieces.remove(p)
                && slot.state != State::Evicting
            {
                self.stored -= self.len_of(*p);
            }
        }
        gone
    }

    /// Whether more than the budget is stored now.
    pub fn over_budget(&self) -> bool {
        self.stored > self.budget
    }
}

/// What the ring needs from its torrent. Implemented for librqbit's torrent;
/// faked in tests.
pub trait Torrent: Send + Sync {
    /// The open streams as (file index, byte position in the file).
    fn positions(&self) -> Vec<(usize, u64)>;
    /// Stop treating these pieces as downloaded (they are about to be deleted).
    fn forget(&self, pieces: &[u32]);
    /// Download this many bytes ahead of each stream.
    fn set_readahead(&self, bytes: u64);
}

/// librqbit's torrent, held weakly: the torrent owns its storage, which owns
/// the ring, so a strong handle here would keep it alive forever.
struct Managed(Weak<ManagedTorrent>);

impl Torrent for Managed {
    fn positions(&self) -> Vec<(usize, u64)> {
        self.0.upgrade().map(|t| t.stream_positions()).unwrap_or_default()
    }

    fn forget(&self, pieces: &[u32]) {
        let Some(t) = self.0.upgrade() else { return };
        let valid: Vec<ValidPieceIndex> = t
            .with_metadata(|m| pieces.iter().filter_map(|p| m.lengths().validate_piece_index(*p)).collect())
            .unwrap_or_default();
        if let Err(e) = t.forget_pieces(valid) {
            eprintln!("reel engine: forgetting evicted pieces: {e:#}");
        }
    }

    fn set_readahead(&self, bytes: u64) {
        if let Some(t) = self.0.upgrade() {
            // Fails only before the torrent is initialized; the engine sets it then.
            let _ = t.set_stream_readahead(bytes);
        }
    }
}

#[derive(Default)]
struct LinkInner {
    torrent: Option<Arc<dyn Torrent>>,
    ring: Weak<Ring>,
}

/// Joins the engine's torrent handle and the ring its storage created (the
/// storage is created inside librqbit, before the engine gets the handle).
#[derive(Clone, Default)]
pub struct Link(Arc<Mutex<LinkInner>>);

impl Link {
    /// The torrent is known: the ring can read its streams and evict.
    pub fn attach(&self, torrent: &Arc<ManagedTorrent>) {
        self.attach_torrent(Arc::new(Managed(Arc::downgrade(torrent))));
    }

    pub fn attach_torrent(&self, torrent: Arc<dyn Torrent>) {
        self.0.lock().unwrap().torrent = Some(torrent);
    }

    fn torrent(&self) -> Option<Arc<dyn Torrent>> {
        self.0.lock().unwrap().torrent.clone()
    }

    fn ring(&self) -> Option<Arc<Ring>> {
        self.0.lock().unwrap().ring.upgrade()
    }

    /// Re-reads where the streams are and resizes the readahead to match.
    /// Called when the torrent is initialized (streams exist from then on)
    /// and from the engine's status poll.
    pub fn sync(&self) {
        if let Some(ring) = self.ring() {
            ring.sync();
        }
    }

    /// Keeps pieces `from..=to` of the torrent until `unpin` (None before the torrent has
    /// metadata: nothing is stored yet to keep).
    pub fn pin(&self, from: u32, to: u32) -> Option<u64> {
        self.ring().map(|r| r.policy.lock().unwrap().pin(from, to))
    }

    pub fn unpin(&self, id: u64) {
        if let Some(r) = self.ring() {
            r.policy.lock().unwrap().unpin(id);
        }
    }

    /// Bytes of pieces on disk now (None before the torrent has metadata).
    #[cfg(test)]
    pub fn stored_bytes(&self) -> Option<u64> {
        self.ring().map(|r| r.policy.lock().unwrap().stored_bytes())
    }
}

/// Creates a `RingStorage` per torrent under `dir`, of `budget` bytes.
#[derive(Clone)]
pub struct RingFactory {
    dir: PathBuf,
    budget: u64,
    link: Link,
}

impl RingFactory {
    pub fn new(dir: PathBuf, budget: u64, link: Link) -> RingFactory {
        RingFactory { dir, budget, link }
    }

    pub fn boxed(self) -> BoxStorageFactory {
        StorageFactoryExt::boxed(self)
    }
}

/// Tells apart the rings of one torrent created one after another (after an
/// error librqbit creates the storage again): each has a directory of its own.
static NEXT_RING: AtomicUsize = AtomicUsize::new(0);

impl StorageFactory for RingFactory {
    type Storage = RingStorage;

    fn create(&self, shared: &ManagedTorrentShared, metadata: &TorrentMetadata) -> anyhow::Result<RingStorage> {
        let dir = self
            .dir
            .join(format!("{}-{}", shared.info_hash.as_string(), NEXT_RING.fetch_add(1, Ordering::Relaxed)));
        let files = metadata.file_infos.iter().map(|f| (f.offset_in_torrent, f.len)).collect();
        let l = metadata.lengths();
        let ring = Arc::new(Ring::new(dir, l.default_piece_length() as u64, l.total_length(), files, self.budget, self.link.clone())?);
        self.link.0.lock().unwrap().ring = Arc::downgrade(&ring);
        Ok(RingStorage(ring))
    }

    fn clone_box(&self) -> BoxStorageFactory {
        self.clone().boxed()
    }
}

/// One torrent's cache: the policy plus the piece files.
pub struct Ring {
    dir: PathBuf,
    piece_len: u64,
    /// (offset in the torrent, length) of each file.
    files: Vec<(u64, u64)>,
    policy: Mutex<Policy>,
    link: Link,
    /// The readahead last handed to the torrent (0: none yet).
    readahead: AtomicU64,
    /// Times a piece was stored over the budget (nothing could be evicted).
    overflows: AtomicU64,
}

impl Ring {
    fn new(dir: PathBuf, piece_len: u64, total_len: u64, files: Vec<(u64, u64)>, budget: u64, link: Link) -> anyhow::Result<Ring> {
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).with_context(|| format!("creating {}", dir.display()))?;
        anyhow::ensure!(piece_len > 0, "pieces of 0 bytes");
        Ok(Ring {
            dir,
            piece_len,
            files,
            policy: Mutex::new(Policy::with_player_cache(piece_len, total_len, budget, PLAYER_CACHE)),
            link,
            readahead: AtomicU64::new(0),
            overflows: AtomicU64::new(0),
        })
    }

    fn path(&self, piece: u32) -> PathBuf {
        self.dir.join(piece.to_string())
    }

    /// The pieces a byte range of file `file_id` falls in, as (piece, offset
    /// in the piece, offset in the range, length).
    fn split(&self, file_id: usize, offset: u64, len: usize) -> anyhow::Result<Vec<(u32, u64, usize, usize)>> {
        let &(file_start, file_len) = self.files.get(file_id).context("no such file")?;
        anyhow::ensure!(offset + len as u64 <= file_len, "past the end of file {file_id}");
        let mut out = Vec::new();
        let mut done = 0usize;
        while done < len {
            let abs = file_start + offset + done as u64;
            let piece = (abs / self.piece_len) as u32;
            let in_piece = abs % self.piece_len;
            let n = ((self.piece_len - in_piece) as usize).min(len - done);
            out.push((piece, in_piece, done, n));
            done += n;
        }
        Ok(out)
    }

    /// Feeds the streams' positions to the policy and the policy's readahead
    /// back to the torrent. Never called with the policy locked: the torrent
    /// takes its own locks, and a stream read holds one of them while it
    /// waits for ours.
    fn sync(&self) -> Option<Arc<dyn Torrent>> {
        let torrent = self.link.torrent()?;
        let positions: Vec<u64> = torrent
            .positions()
            .into_iter()
            .filter_map(|(file, pos)| Some(self.files.get(file)?.0 + pos))
            .collect();
        let readahead = {
            let mut p = self.policy.lock().unwrap();
            let now = Instant::now();
            p.see(&positions, now);
            p.readahead()
        };
        if self.readahead.swap(readahead, Ordering::Relaxed) != readahead {
            torrent.set_readahead(readahead);
        }
        Some(torrent)
    }

    /// Makes room for a piece about to be written.
    fn admit(&self, piece: u32) {
        // Already stored: just note the write (keeps a partial piece fresh).
        if self.policy.lock().unwrap().touch(piece, Instant::now()) {
            return;
        }
        let torrent = self.sync();
        let (victims, over) = {
            let mut p = self.policy.lock().unwrap();
            let victims = p.admit(piece, Instant::now());
            (victims, p.over_budget())
        };
        if over && self.overflows.fetch_add(1, Ordering::Relaxed) == 0 {
            eprintln!(
                "reel engine: the buffer is smaller than what the readers need now ({} B pieces); storing over it",
                self.piece_len
            );
        }
        if victims.is_empty() {
            return;
        }
        // Forget first, so nothing reads a piece while its file goes away.
        if let Some(t) = &torrent {
            t.forget(&victims);
        }
        let gone = self.policy.lock().unwrap().evicted(&victims);
        for piece in gone {
            if let Err(e) = std::fs::remove_file(self.path(piece))
                && e.kind() != io::ErrorKind::NotFound
            {
                eprintln!("reel engine: evicting piece {piece}: {e}");
            }
        }
    }
}

impl Drop for Ring {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

/// The storage librqbit holds; all its clones share the ring.
pub struct RingStorage(Arc<Ring>);

impl TorrentStorage for RingStorage {
    fn init(&mut self, _shared: &ManagedTorrentShared, _metadata: &TorrentMetadata) -> anyhow::Result<()> {
        Ok(())
    }

    fn pread_exact(&self, file_id: usize, offset: u64, buf: &mut [u8]) -> anyhow::Result<()> {
        let ring = &self.0;
        for (piece, in_piece, at, n) in ring.split(file_id, offset, buf.len())? {
            anyhow::ensure!(ring.policy.lock().unwrap().has(piece), "piece {piece} is not in the cache");
            File::open(ring.path(piece))
                .and_then(|f| read_exact_at(&f, &mut buf[at..at + n], in_piece))
                .with_context(|| format!("reading piece {piece}"))?;
        }
        Ok(())
    }

    fn pwrite_all(&self, file_id: usize, offset: u64, buf: &[u8]) -> anyhow::Result<()> {
        let ring = &self.0;
        for (piece, in_piece, at, n) in ring.split(file_id, offset, buf.len())? {
            ring.admit(piece);
            OpenOptions::new()
                .write(true)
                .create(true)
                .truncate(false)
                .open(ring.path(piece))
                .and_then(|f| write_all_at(&f, &buf[at..at + n], in_piece))
                .with_context(|| format!("writing piece {piece}"))?;
        }
        Ok(())
    }

    fn remove_file(&self, file_id: usize, _filename: &Path) -> anyhow::Result<()> {
        let ring = &self.0;
        let Some(&(start, len)) = ring.files.get(file_id) else { return Ok(()) };
        if len == 0 {
            return Ok(());
        }
        let (from, to) = ((start / ring.piece_len) as u32, ((start + len - 1) / ring.piece_len) as u32);
        let gone = ring.policy.lock().unwrap().remove_range(from, to);
        for piece in gone {
            let _ = std::fs::remove_file(ring.path(piece));
        }
        Ok(())
    }

    fn remove_directory_if_empty(&self, _path: &Path) -> anyhow::Result<()> {
        // The ring's own directory goes when the ring does (Drop).
        Ok(())
    }

    fn ensure_file_length(&self, _file_id: usize, _length: u64) -> anyhow::Result<()> {
        Ok(())
    }

    fn take(&self) -> anyhow::Result<Box<dyn TorrentStorage>> {
        Ok(Box::new(RingStorage(self.0.clone())))
    }

    fn on_piece_completed(&self, piece: ValidPieceIndex) -> anyhow::Result<()> {
        self.0.policy.lock().unwrap().completed(piece.get());
        Ok(())
    }
}

/// `buf.len()` bytes of `f` from `offset` (Unix's `read_exact_at`; Windows reads with
/// `seek_read`, which may return fewer bytes).
#[cfg(unix)]
fn read_exact_at(f: &File, buf: &mut [u8], offset: u64) -> io::Result<()> {
    std::os::unix::fs::FileExt::read_exact_at(f, buf, offset)
}

#[cfg(windows)]
fn read_exact_at(f: &File, buf: &mut [u8], offset: u64) -> io::Result<()> {
    let mut done = 0;
    while done < buf.len() {
        match std::os::windows::fs::FileExt::seek_read(f, &mut buf[done..], offset + done as u64)? {
            0 => return Err(io::ErrorKind::UnexpectedEof.into()),
            n => done += n,
        }
    }
    Ok(())
}

/// All of `buf` into `f` at `offset` (Unix's `write_all_at`; Windows writes with `seek_write`).
#[cfg(unix)]
fn write_all_at(f: &File, buf: &[u8], offset: u64) -> io::Result<()> {
    std::os::unix::fs::FileExt::write_all_at(f, buf, offset)
}

#[cfg(windows)]
fn write_all_at(f: &File, buf: &[u8], offset: u64) -> io::Result<()> {
    let mut done = 0;
    while done < buf.len() {
        match std::os::windows::fs::FileExt::seek_write(f, &buf[done..], offset + done as u64)? {
            0 => return Err(io::ErrorKind::WriteZero.into()),
            n => done += n,
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const P: u64 = 100;

    fn complete(p: &mut Policy, piece: u32, now: Instant) -> Vec<u32> {
        let victims = p.admit(piece, now);
        p.completed(piece);
        let gone = p.evicted(&victims);
        assert_eq!(gone, victims);
        victims
    }

    #[test]
    fn window_fits_the_budget() {
        let w = Window::for_budget(1000, P, 0);
        assert_eq!(w, Window { behind: 120, ahead: 680 });
        // Rounded out to whole pieces at both ends, the window still fits.
        assert!(w.behind + w.ahead + 2 * P <= 1000);
        // Too small a budget still lets the reader move on, a piece at a time.
        assert_eq!(Window::for_budget(150, P, 0).ahead, P);
        // Split between readers.
        assert_eq!(w.share(2, P), Window { behind: 60, ahead: 340 });
        assert_eq!(w.share(20, P).ahead, P);
    }

    #[test]
    fn kept_pieces_of_a_reader() {
        let p = Policy::new(P, 100 * P, 1000);
        let w = p.window;
        // At byte 1050: from (1050-120)/100 = 9 to (1050+680-1)/100 = 17.
        assert_eq!(p.kept(1050, w), (9, 17));
        assert_eq!(p.kept(0, w), (0, 6));
        // Never more pieces than the budget holds.
        for at in (0..5000).step_by(7) {
            let (from, to) = p.kept(at, w);
            assert!((to - from + 1) as u64 * P <= 1000, "{at}: {from}..={to}");
        }
    }

    /// A reader plays through, downloading its readahead as librqbit would.
    fn play(p: &mut Policy, from: u64, to: u64, now: &mut Instant) {
        let mut at = from;
        while at < to {
            p.see(&[at], *now);
            let (_, last) = p.kept(at, p.share());
            for piece in p.piece_of(at)..=last.min(p.piece_of(p.total_len - 1)) {
                if !p.has(piece) {
                    complete(p, piece, *now);
                }
                assert!(p.stored_bytes() <= p.budget, "over budget at {at}: {}", p.stored_bytes());
            }
            at += 37;
            *now += Duration::from_millis(10);
        }
    }

    #[test]
    fn budget_never_exceeded_while_playing_and_seeking() {
        let mut p = Policy::new(P, 200 * P, 1000);
        let mut now = Instant::now();
        play(&mut p, 0, 3000, &mut now);
        // Seek forward far, then back to a place long evicted.
        play(&mut p, 16000, 17000, &mut now);
        play(&mut p, 500, 1500, &mut now);
        assert!(p.stored_bytes() <= 1000);
        // The reader's window is all there.
        let at = p.readers[0].at;
        let (from, to) = (p.piece_of(at), p.kept(at, p.share()).1);
        assert!((from..=to).all(|k| p.has(k)), "{from}..={to} around {at}: {:?}", p.pieces.keys());
    }

    #[test]
    fn evicts_farthest_behind_first_then_farthest_ahead() {
        // Window: behind 48, ahead 400-48-200 = 152; a reader at 2000 keeps 19..=21.
        let mut p = Policy::new(P, 100 * P, 400);
        let now = Instant::now();
        for piece in [0, 1, 50, 51] {
            complete(&mut p, piece, now);
        }
        p.see(&[2000], now);
        assert_eq!(p.kept(2000, p.share()), (19, 21));
        assert_eq!(complete(&mut p, 20, now), vec![0]);
        assert_eq!(complete(&mut p, 21, now), vec![1]);
        assert_eq!(complete(&mut p, 19, now), vec![51]);
        assert_eq!(complete(&mut p, 22, now), vec![50]);
        assert!(p.stored_bytes() <= 400);
    }

    #[test]
    fn window_of_a_live_reader_is_never_evicted() {
        let mut p = Policy::new(P, 100 * P, 400);
        let now = Instant::now();
        p.see(&[1000], now);
        // Window: behind 48, ahead 152 -> pieces 9..=11.
        assert_eq!(p.kept(1000, p.share()), (9, 11));
        for piece in [10, 11, 12, 13] {
            complete(&mut p, piece, now);
        }
        // 12 and 13 are past the window, 13 the farthest.
        assert_eq!(complete(&mut p, 9, now), vec![13]);
        assert_eq!(complete(&mut p, 50, now), vec![12]);
        assert_eq!(complete(&mut p, 51, now), vec![50]);
        // 52 being written, 9..=11 in the window: nothing may go, so the
        // budget is exceeded instead of failing the write.
        p.admit(52, now);
        assert!(p.admit(53, now).is_empty());
        assert!(p.over_budget());
        assert!((9..=11).all(|k| p.has(k)));
    }

    #[test]
    fn pinned_pieces_stay_until_unpinned() {
        let now = Instant::now();
        // Pieces of 100 bytes, a budget of 500: pieces 0..3 stored, 0..=1 pinned.
        let mut p = Policy::new(100, 10_000, 500);
        p.see(&[0], now);
        for piece in 0..3 {
            complete(&mut p, piece, now);
        }
        let pin = p.pin(0, 1);
        // The reader moves far on and fills the budget: what is behind it goes, the pin stays.
        p.see(&[5000], now);
        for piece in 50..55 {
            complete(&mut p, piece, now);
        }
        assert!(p.has(0) && p.has(1), "a pinned piece was evicted");
        assert!(!p.has(2), "an unpinned piece far behind stays");
        p.unpin(pin);
        // Unpinned, they go like any other once the reader that was there is forgotten.
        let later = now + FORGET_READER_AFTER + Duration::from_secs(1);
        p.see(&[5000], later);
        for piece in 55..60 {
            complete(&mut p, piece, later);
        }
        assert!(!p.has(0) && !p.has(1), "unpinned pieces far behind stay");
    }

    #[test]
    fn partial_pieces_stay_while_written() {
        let mut p = Policy::new(P, 100 * P, 200);
        let now = Instant::now();
        p.see(&[9000], now);
        p.admit(0, now); // partial, being written
        complete(&mut p, 1, now);
        assert_eq!(p.admit(2, now), vec![1]);
        // A partial piece idle for long is a dropped download: it can go.
        let later = now + PARTIAL_IDLE + Duration::from_secs(1);
        p.see(&[9000], later);
        p.completed(2);
        assert_eq!(p.admit(3, later), vec![0]);
    }

    #[test]
    fn a_piece_wanted_again_while_evicted_keeps_its_file() {
        let mut p = Policy::new(P, 100 * P, 200);
        let now = Instant::now();
        complete(&mut p, 0, now);
        complete(&mut p, 1, now + Duration::from_secs(1));
        // No reader yet: the oldest written goes.
        let victims = p.admit(2, now + Duration::from_secs(2));
        assert_eq!(victims, vec![0]);
        // Before the eviction finishes, the victim is written again.
        p.admit(0, now + Duration::from_secs(3));
        assert!(p.evicted(&victims).is_empty());
        assert!(p.has(0));
        assert!(p.stored_bytes() <= 200);
    }

    #[test]
    fn readers_seek_and_expire() {
        let mut p = Policy::new(P, 1000 * P, 1000);
        let t0 = Instant::now();
        p.see(&[0], t0);
        p.see(&[300], t0 + Duration::from_secs(1));
        assert_eq!(p.readers.len(), 1, "moving within the window is the same reader");
        // Two streams open: they share the window.
        p.see(&[300, 50_000], t0 + Duration::from_secs(2));
        assert_eq!(p.readers.len(), 2, "a far position is a new reader");
        assert_eq!(p.share(), p.window.share(2, P));
        // The old stream closes: the other gets the whole window.
        p.see(&[50_100], t0 + Duration::from_secs(3));
        assert_eq!(p.live_readers().len(), 1);
        assert_eq!(p.readahead(), p.window.ahead);
        // No stream open (paused): the last reader keeps its window.
        p.see(&[], t0 + Duration::from_secs(4));
        assert_eq!(p.live_readers()[0].at, 50_100);
        // Long gone readers are forgotten, the last one never.
        p.see(&[], t0 + FORGET_READER_AFTER + Duration::from_secs(10));
        assert_eq!(p.readers.len(), 1);
        assert_eq!(p.readers[0].at, 50_100);
    }

    struct Fake {
        positions: Mutex<Vec<(usize, u64)>>,
        forgotten: Mutex<Vec<u32>>,
        readahead: AtomicU64,
    }

    impl Torrent for Fake {
        fn positions(&self) -> Vec<(usize, u64)> {
            self.positions.lock().unwrap().clone()
        }
        fn forget(&self, pieces: &[u32]) {
            self.forgotten.lock().unwrap().extend_from_slice(pieces);
        }
        fn set_readahead(&self, bytes: u64) {
            self.readahead.store(bytes, Ordering::Relaxed);
        }
    }

    fn piece(i: u32) -> ValidPieceIndex {
        librqbit_core::lengths::Lengths::new(300, P as u32).unwrap().validate_piece_index(i).unwrap()
    }

    fn dir_bytes(dir: &Path) -> u64 {
        std::fs::read_dir(dir).unwrap().map(|e| e.unwrap().metadata().unwrap().len()).sum()
    }

    /// Pieces span files: two files of 150 bytes, pieces of 100. Reads and
    /// writes cross file and piece edges; eviction deletes files and tells
    /// the torrent; the directory never holds more than the budget.
    #[test]
    fn ring_storage_with_pieces_spanning_files() {
        let dir = std::env::temp_dir().join(format!("reel-ring-test-{}", std::process::id()));
        let link = Link::default();
        let ring = Arc::new(Ring::new(dir.clone(), P, 300, vec![(0, 150), (150, 150)], 200, link.clone()).unwrap());
        link.0.lock().unwrap().ring = Arc::downgrade(&ring);
        let fake = Arc::new(Fake { positions: Mutex::new(vec![(0, 0)]), forgotten: Mutex::default(), readahead: AtomicU64::new(0) });
        link.attach_torrent(fake.clone());
        let s = RingStorage(ring.clone());
        let data: Vec<u8> = (0..300u32).map(|i| (i % 251) as u8).collect();

        // Piece 1 is bytes 100..200: 50 bytes of file 0 and 50 of file 1.
        s.pwrite_all(0, 0, &data[0..150]).unwrap();
        s.pwrite_all(1, 0, &data[150..200]).unwrap();
        s.on_piece_completed(piece(0)).unwrap();
        let mut buf = vec![0; 100];
        s.pread_exact(0, 50, &mut buf).unwrap();
        assert_eq!(buf, data[50..150]);
        s.pread_exact(1, 0, &mut buf[..50]).unwrap();
        assert_eq!(buf[..50], data[150..200]);
        assert_eq!(link.stored_bytes(), Some(200));
        assert!(fake.readahead.load(Ordering::Relaxed) > 0, "readahead handed to the torrent");

        // The reader moves to file 1; writing piece 2 evicts piece 0, behind.
        *fake.positions.lock().unwrap() = vec![(1, 60)];
        s.on_piece_completed(piece(1)).unwrap();
        s.pwrite_all(1, 50, &data[200..300]).unwrap();
        assert_eq!(*fake.forgotten.lock().unwrap(), vec![0]);
        assert!(s.pread_exact(0, 0, &mut buf).is_err(), "evicted");
        assert!(dir_bytes(&dir) <= 200);
        s.pread_exact(1, 50, &mut buf).unwrap();
        assert_eq!(buf, data[200..300]);

        // Removing a file drops its pieces; dropping the ring its directory.
        s.remove_file(1, Path::new("b")).unwrap();
        assert_eq!(link.stored_bytes(), Some(0));
        drop(s);
        drop(ring);
        assert!(!dir.exists());
    }

    #[test]
    fn what_is_watched_stays_behind_a_reader_ahead_of_the_picture() {
        // 256 MiB budget, 16 MiB pieces, the player reading 64 MiB ahead of the picture.
        const MIB: u64 = 1024 * 1024;
        let w = Window::for_budget(256 * MIB, 16 * MIB, 64 * MIB);
        assert_eq!(w.behind, 80 * MIB, "the player's cache and a piece, not 12% (30 MiB)");
        assert_eq!(w.ahead, 256 * MIB - 80 * MIB - 32 * MIB);
        // A small budget keeps half behind at most.
        assert_eq!(Window::for_budget(100 * MIB, 16 * MIB, 64 * MIB).behind, 50 * MIB);
    }
}
