//! The built-in torrent server: a librqbit session plus its HTTP API on
//! 127.0.0.1, which streams files with Range requests
//! (`/torrents/{id}/stream/{file}`), so any player can open them by URL.

use std::{
    collections::HashMap,
    net::SocketAddr,
    path::PathBuf,
    sync::{
        Arc, Mutex, OnceLock,
        atomic::{AtomicU32, AtomicU64, Ordering},
    },
};

use crate::{catalog, disk, timeline};

use anyhow::Context;
use librqbit::{
    AddTorrent, AddTorrentOptions, Api, Session,
    http_api::HttpApi,
};
use librqbit_dualstack_sockets::{BindOpts, TcpListener};
use serde_json::{Value, json};
use tokio::runtime::Runtime;

struct Core {
    rt: Runtime,
    session: Arc<Session>,
    api: Api,
    port: u16,
    next_job: AtomicU32,
    jobs: Arc<Mutex<HashMap<u32, Job>>>,
}

#[derive(Clone)]
enum Job {
    /// The film has no source to play.
    NoSource,
    /// Not enough free space to start: the buffer plus the reserve (bytes).
    NoSpace { needed: u64, free: Option<u64> },
    /// Fetching the metadata (magnet links need peers for it).
    Resolving,
    Ready(Arc<librqbit::ManagedTorrent>),
    Failed(String),
}

static CORE: OnceLock<Core> = OnceLock::new();

/// The playback buffer the user chose (Settings), MiB. The UI keeps it across
/// launches and sets it at start. Until the ring buffer exists it is the free
/// space needed to start a film; the cache itself is wiped after each film.
static BUFFER_MB: AtomicU64 = AtomicU64::new(DEFAULT_BUFFER_MB);
pub const DEFAULT_BUFFER_MB: u64 = 256;
/// Kept free on top of the buffer so the device itself never runs out.
pub const RESERVE_MB: u64 = 50;
const MIB: u64 = 1024 * 1024;

pub fn set_buffer_mb(mb: u64) {
    BUFFER_MB.store(mb.clamp(64, 16 * 1024), Ordering::Relaxed);
}

pub fn buffer_mb() -> u64 {
    BUFFER_MB.load(Ordering::Relaxed)
}

/// Whether there is room to start playing: `{"ok","free","needed","buffer"}`
/// (bytes; `buffer` in MiB). `free` is null when it cannot be measured, and
/// then `ok` is true: better to try than to block on a failed measurement.
pub fn check_space() -> Value {
    let needed = (buffer_mb() + RESERVE_MB) * MIB;
    let dir = cache_dir();
    let _ = std::fs::create_dir_all(&dir);
    match disk::free_bytes(&dir) {
        Ok(free) => json!({ "ok": free >= needed, "free": free, "needed": needed, "buffer": buffer_mb() }),
        Err(e) => {
            eprintln!("reel engine: free space of {}: {e}", dir.display());
            json!({ "ok": true, "free": null, "needed": needed, "buffer": buffer_mb() })
        }
    }
}

/// Free space fell under the reserve while playing.
fn low_space() -> bool {
    disk::free_bytes(&cache_dir()).is_ok_and(|free| free < RESERVE_MB * MIB)
}

fn core() -> anyhow::Result<&'static Core> {
    if let Some(core) = CORE.get() {
        return Ok(core);
    }
    let rt = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .thread_name("reel-engine")
        .build()
        .context("starting the engine runtime")?;
    let dir = cache_dir();
    // A cache, not a library: whatever a previous run left is stale.
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).with_context(|| format!("creating {}", dir.display()))?;
    let (session, port, api) = rt.block_on(async {
        let session = Session::new(dir).await.context("creating the torrent session")?;
        let listener = TcpListener::bind_tcp(SocketAddr::from(([127, 0, 0, 1], 0)), BindOpts::default())
            .context("binding the stream server")?;
        let port = listener.bind_addr().port();
        let api = Api::new(session.clone(), None, None);
        tokio::spawn(HttpApi::new(api.clone(), None).make_http_api_and_run(listener, None));
        anyhow::Ok((session, port, api))
    })?;
    let _ = CORE.set(Core {
        rt,
        session,
        api,
        port,
        next_job: AtomicU32::new(1),
        jobs: Default::default(),
    });
    Ok(CORE.get().expect("just set"))
}

/// The engine's cache: pieces of what is playing. Only reel writes here, and
/// it is wiped when the engine starts and after each film.
pub fn cache_dir() -> PathBuf {
    std::env::temp_dir().join("reel-cache")
}

/// Stops a job and deletes what it downloaded.
pub fn close(job: u32) {
    let Some(core) = CORE.get() else { return };
    let Some(state) = core.jobs.lock().unwrap().remove(&job) else { return };
    if let Job::Ready(handle) = state {
        let session = core.session.clone();
        core.rt.spawn(async move {
            if let Err(e) = session.delete(handle.id().into(), true).await {
                eprintln!("reel engine: deleting torrent {}: {e:#}", handle.id());
            }
        });
    }
}

/// The file to play: the largest one with a video extension.
fn pick_video(files: &[(usize, String, u64)]) -> Option<usize> {
    const VIDEO: [&str; 6] = ["mp4", "m4v", "mov", "mkv", "webm", "avi"];
    files
        .iter()
        .filter(|(_, name, _)| {
            name.rsplit_once('.').is_some_and(|(_, ext)| VIDEO.iter().any(|v| ext.eq_ignore_ascii_case(v)))
        })
        .max_by_key(|(_, _, len)| *len)
        .map(|(index, _, _)| *index)
}

/// Starts the engine if needed; the port of its stream server.
#[cfg(test)]
pub fn start() -> anyhow::Result<u16> {
    Ok(core()?.port)
}

/// Starts playing a catalog film: checks the free space, starts the engine
/// and adds the film's torrent. A job id to poll with `status` (which says
/// when there is no source or no room).
pub fn open(film_id: &str) -> anyhow::Result<u32> {
    let Some(magnet) = catalog::film(film_id).and_then(|f| f.magnet) else {
        return Ok(new_job(Job::NoSource));
    };
    let space = check_space();
    if space["ok"] == false {
        let needed = space["needed"].as_u64().unwrap_or_default();
        return Ok(new_job(Job::NoSpace { needed, free: space["free"].as_u64() }));
    }
    add(magnet)
}

/// A job that is already settled (no engine needed).
fn new_job(state: Job) -> u32 {
    // Settled jobs live in the same table, so the engine is started for them
    // too: it is cheap and the next film needs it anyway.
    match core() {
        Ok(core) => {
            let job = core.next_job.fetch_add(1, Ordering::Relaxed);
            core.jobs.lock().unwrap().insert(job, state);
            job
        }
        Err(e) => {
            eprintln!("reel engine: {e:#}");
            0
        }
    }
}

/// Adds a magnet link or torrent URL; returns a job id to poll with `status`.
pub fn add(url: &str) -> anyhow::Result<u32> {
    let core = core()?;
    let job = core.next_job.fetch_add(1, Ordering::Relaxed);
    core.jobs.lock().unwrap().insert(job, Job::Resolving);
    let (session, jobs, url) = (core.session.clone(), core.jobs.clone(), url.to_owned());
    core.rt.spawn(async move {
        let result = session
            .add_torrent(
                AddTorrent::from_url(&url),
                Some(AddTorrentOptions { overwrite: true, ..Default::default() }),
            )
            .await;
        let state = match result {
            Ok(response) => match response.into_handle() {
                Some(handle) => Job::Ready(handle),
                None => Job::Failed("the torrent was only listed".into()),
            },
            Err(e) => Job::Failed(format!("{e:#}")),
        };
        jobs.lock().unwrap().insert(job, state);
    });
    Ok(job)
}

/// What the player shows for the job, as JSON with a `phase`:
/// - `"no_source"`, `"no_space"` (`needed`, `free` bytes, `free` may be null),
///   `"resolving"`, `"failed"` (`message`);
/// - `"ready"`: `stream_url` (where the player opens the video), `file`,
///   `name`, `low_space` (the device ran out of room while playing),
///   `speed` (MiB/s), `peers` (null when unknown), `progress` (0..1 of the torrent).
pub fn status(job: u32) -> Value {
    let Some(core) = CORE.get() else {
        return json!({ "phase": "failed", "message": "the engine is not started" });
    };
    let Some(state) = core.jobs.lock().unwrap().get(&job).cloned() else {
        return json!({ "phase": "failed", "message": format!("no job {job}") });
    };
    match state {
        Job::NoSource => json!({ "phase": "no_source" }),
        Job::NoSpace { needed, free } => json!({ "phase": "no_space", "needed": needed, "free": free }),
        Job::Resolving => json!({ "phase": "resolving" }),
        Job::Failed(message) => json!({ "phase": "failed", "message": message }),
        Job::Ready(handle) => {
            let Some(file) = video_file(&handle) else {
                return json!({ "phase": "failed", "message": "no video in this torrent" });
            };
            let stats = handle.stats();
            let live = stats.live.as_ref();
            let peers = live.map(|l| l.snapshot.peer_stats.live);
            json!({
                "phase": "ready",
                "name": handle.name(),
                "file": file,
                "stream_url": format!("http://127.0.0.1:{}/torrents/{}/stream/{file}", core.port, handle.id()),
                "low_space": low_space(),
                "speed": live.map(|l| l.download_speed.mbps).unwrap_or(0.0),
                "peers": peers,
                "progress": if stats.total_bytes > 0 { stats.progress_bytes as f64 / stats.total_bytes as f64 } else { 0.0 },
            })
        }
    }
}

fn video_file(handle: &librqbit::ManagedTorrent) -> Option<usize> {
    let files: Vec<(usize, String, u64)> = handle
        .with_metadata(|m| {
            m.file_infos
                .iter()
                .enumerate()
                .map(|(index, f)| (index, f.relative_filename.to_string_lossy().into_owned(), f.len))
                .collect()
        })
        .ok()?;
    pick_video(&files)
}

/// Buckets the scrubber is cut into.
const TIMELINE_BUCKETS: usize = 200;

/// What the scrubber draws for the job's video at `position` of `duration`
/// seconds: `{"ranges": [[from, to], …] (0..1 of the film, ready), "ahead":
/// seconds ready without a gap from the position}`; empty until known.
pub fn timeline(job: u32, position: f64, duration: f64) -> Value {
    let empty = json!({ "ranges": [], "ahead": 0 });
    let Some(core) = CORE.get() else { return empty };
    let Some(Job::Ready(handle)) = core.jobs.lock().unwrap().get(&job).cloned() else { return empty };
    let Some(file) = video_file(&handle) else { return empty };
    let Some(buckets) = file_buckets(core, &handle, file, TIMELINE_BUCKETS) else { return empty };
    let ranges: Vec<[f64; 2]> = timeline::ready_ranges(&buckets).into_iter().map(|(a, b)| [a, b]).collect();
    json!({ "ranges": ranges, "ahead": timeline::ready_ahead(&buckets, position, duration) })
}

/// File `file` of the torrent cut into `n` equal byte ranges, each the
/// fraction downloaded (whole verified pieces only). None when unknown.
fn file_buckets(core: &Core, handle: &Arc<librqbit::ManagedTorrent>, file: usize, n: usize) -> Option<Vec<f64>> {
    let layout = handle
        .with_metadata(|m| {
            let l = m.lengths();
            m.file_infos.get(file).map(|f| Layout {
                piece_length: l.default_piece_length() as u64,
                total_length: l.total_length(),
                file_offset: f.offset_in_torrent,
                file_length: f.len,
            })
        })
        .ok()??;
    // Not live yet (still checking the files on disk): nothing downloaded.
    let Ok((have, _)) = core.api.api_dump_haves(handle.id().into()) else {
        return Some(vec![0.0; n.max(1)]);
    };
    Some(layout.buckets(|piece| have.get(piece as usize).is_some_and(|b| *b), n))
}

/// Where a file lies in its torrent's pieces.
#[derive(Clone, Copy)]
struct Layout {
    piece_length: u64,
    total_length: u64,
    file_offset: u64,
    file_length: u64,
}

impl Layout {
    /// The file cut into `n` equal byte ranges (at least 1), each the fraction
    /// of its bytes that lie in pieces `have` says are downloaded.
    fn buckets(&self, have: impl Fn(u32) -> bool, n: usize) -> Vec<f64> {
        let n = n.max(1);
        if self.file_length == 0 || self.piece_length == 0 {
            return vec![0.0; n];
        }
        (0..n)
            .map(|i| {
                let start = self.file_offset + self.file_length * i as u64 / n as u64;
                let end = self.file_offset + self.file_length * (i as u64 + 1) / n as u64;
                if end <= start {
                    // More buckets than bytes: the bucket is as full as the piece its byte is in.
                    return if have((start / self.piece_length) as u32) { 1.0 } else { 0.0 };
                }
                let mut got = 0;
                let mut piece = start / self.piece_length;
                while piece * self.piece_length < end {
                    let p_start = piece * self.piece_length;
                    let p_end = (p_start + self.piece_length).min(self.total_length);
                    if have(piece as u32) {
                        got += p_end.min(end).saturating_sub(p_start.max(start));
                    }
                    piece += 1;
                }
                got as f64 / (end - start) as f64
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use std::io::{Read, Write};
    use std::time::{Duration, Instant};

    use super::{Layout, pick_video};

    #[test]
    fn picks_the_largest_video() {
        let files = vec![
            (0, "Sintel/poster.jpg".into(), 900_000_000),
            (1, "Sintel/sintel.mp4".into(), 129_000_000),
            (2, "Sintel/sample.MKV".into(), 10_000_000),
            (3, "Sintel/sintel.en.srt".into(), 2_000),
        ];
        assert_eq!(pick_video(&files), Some(1));
        assert_eq!(pick_video(&files[3..]), None);
    }

    #[test]
    fn buffer_is_clamped_and_space_is_checked() {
        super::set_buffer_mb(1);
        assert_eq!(super::buffer_mb(), 64);
        super::set_buffer_mb(256);
        let s = super::check_space();
        assert_eq!(s["needed"], (256 + super::RESERVE_MB) * super::MIB);
        assert!(s["free"].as_u64().unwrap() > 0);
        // A buffer bigger than any disk cannot fit.
        super::set_buffer_mb(16 * 1024);
        if s["free"].as_u64().unwrap() < (16 * 1024 + 50) * super::MIB {
            assert_eq!(super::check_space()["ok"], false);
        }
        super::set_buffer_mb(super::DEFAULT_BUFFER_MB);
    }

    #[test]
    fn buckets_of_a_file_inside_the_torrent() {
        // Pieces of 100 bytes; the file is bytes 50..450 (pieces 0..=4).
        let l = Layout { piece_length: 100, total_length: 500, file_offset: 50, file_length: 400 };
        // Pieces 1 and 2 (bytes 100..300) downloaded.
        let b = l.buckets(|p| p == 1 || p == 2, 4);
        // Buckets: 50..150 (half), 150..250 (full), 250..350 (half), 350..450 (none).
        assert_eq!(b, vec![0.5, 1.0, 0.5, 0.0]);
    }

    #[test]
    fn buckets_all_and_nothing() {
        let l = Layout { piece_length: 16, total_length: 1000, file_offset: 0, file_length: 1000 };
        assert!(l.buckets(|_| true, 200).iter().all(|f| (*f - 1.0).abs() < 1e-9));
        assert!(l.buckets(|_| false, 200).iter().all(|f| *f == 0.0));
        assert_eq!(l.buckets(|_| true, 0).len(), 1);
    }

    #[test]
    fn buckets_short_last_piece_and_more_buckets_than_bytes() {
        // The last piece (bytes 200..250) is shorter than the others.
        let l = Layout { piece_length: 100, total_length: 250, file_offset: 0, file_length: 250 };
        assert_eq!(l.buckets(|p| p == 2, 5), vec![0.0, 0.0, 0.0, 0.0, 1.0]);
        let tiny = Layout { piece_length: 1, total_length: 2, file_offset: 0, file_length: 2 };
        assert_eq!(tiny.buckets(|p| p == 1, 4), vec![0.0, 0.0, 1.0, 1.0]);
    }

    /// Sintel (Blender Foundation, CC BY 3.0): the open test torrent WebTorrent uses.
    pub const SINTEL: &str = "magnet:?xt=urn:btih:08ada5a7a6183aae1e09d831df6748d566095a10&dn=Sintel&tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337&tr=udp%3A%2F%2Fexplodie.org%3A6969&tr=udp%3A%2F%2Ftracker.leechers-paradise.org%3A6969&xs=https%3A%2F%2Fwebtorrent.io%2Ftorrents%2Fsintel.torrent";

    /// Needs the network: `cargo test -- --ignored smoke --nocapture`.
    #[test]
    #[ignore]
    fn smoke_streams_sintel() {
        let port = super::start().expect("engine starts");
        let job = super::add(SINTEL).expect("added");
        let started = Instant::now();
        let status = loop {
            let s = super::status(job);
            if s["phase"] == "ready" || s["phase"] == "failed" || started.elapsed() > Duration::from_secs(120) {
                break s;
            }
            std::thread::sleep(Duration::from_millis(500));
        };
        println!("metadata after {:?}: {}", started.elapsed(), status["name"]);
        assert_eq!(status["phase"], "ready", "{status}");
        let url = status["stream_url"].as_str().unwrap();
        let path = &url[url.find("/torrents").unwrap()..];

        let t = Instant::now();
        let mut conn = std::net::TcpStream::connect(("127.0.0.1", port)).unwrap();
        conn.set_read_timeout(Some(Duration::from_secs(120))).unwrap();
        write!(conn, "GET {path} HTTP/1.1\r\nHost: 127.0.0.1\r\nRange: bytes=0-1048575\r\nConnection: close\r\n\r\n").unwrap();
        let mut body = Vec::new();
        conn.read_to_end(&mut body).unwrap();
        let head = String::from_utf8_lossy(&body[..body.len().min(300)]);
        println!("first MiB in {:?}; {} bytes; head:\n{}", t.elapsed(), body.len(), head.lines().take(6).collect::<Vec<_>>().join("\n"));
        assert!(head.starts_with("HTTP/1.1 206"), "{head}");
        assert!(body.len() > 1_000_000);
    }
}
