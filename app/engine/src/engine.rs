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

use crate::{buffer, disk, leases};
use reel_domain::{
    compat, episode,
    play::PlaySource,
    ports::PlaybackHost,
    timeline,
};

use anyhow::Context;
use librqbit::{
    AddTorrent, AddTorrentOptions, Api, ConnectionOptions, ListenerMode, ListenerOptions,
    DhtSessionConfig, PeerConnectionOptions, Session, SessionOptions,
    http_api::HttpApi,
};
use librqbit_dualstack_sockets::{BindOpts, TcpListener};
use serde_json::{Value, json};
use tokio::runtime::Runtime;

pub(crate) struct Core {
    pub(crate) rt: Runtime,
    pub(crate) session: Arc<Session>,
    api: Api,
    port: u16,
    next_job: AtomicU32,
    jobs: Arc<Mutex<HashMap<u32, Job>>>,
}

#[derive(Clone)]
enum Job {
    /// The film has no source to play.
    NoSource,
    /// The episode is not in the release chosen for its season.
    NotInRelease,
    /// Not enough free space to start: the buffer plus the reserve (bytes).
    NoSpace { needed: u64, free: Option<u64> },
    /// The catalog still searches for a release to play.
    Searching,
    /// Fetching the metadata (magnet links need peers for it).
    Resolving,
    /// Playing; the link reaches the torrent's ring-buffer cache. None when the job reads a
    /// torrent someone else added (a film being saved, on files; or another job's ring).
    Ready(Arc<librqbit::ManagedTorrent>, Option<buffer::Link>),
    /// A saved film: its file on disk, played without the engine (`keep`).
    Local(PathBuf),
    Failed(String),
}

static CORE: OnceLock<Core> = OnceLock::new();

/// The application's side (the catalog's decisions, the watch progress): set once by
/// whoever builds the engine (`Local::new`).
static HOST: OnceLock<Arc<dyn PlaybackHost>> = OnceLock::new();

pub fn set_host(host: Arc<dyn PlaybackHost>) {
    let _ = HOST.set(host);
}

fn host() -> Option<&'static dyn PlaybackHost> {
    HOST.get().map(|h| h.as_ref())
}

/// The release `key` plays, as the application decides; none without one.
fn play_source(key: &str) -> PlaySource {
    host().map_or(PlaySource::None, |h| h.play_source(key))
}

/// The episode a job plays, (season, episode), when its torrent is a pack.
static EPISODES: Mutex<Option<HashMap<u32, (u16, u16)>>> = Mutex::new(None);

fn episode_of(job: u32) -> Option<(u16, u16)> {
    EPISODES.lock().unwrap().as_ref().and_then(|m| m.get(&job).copied())
}

/// The playback buffer the user chose (Settings), MiB. The UI keeps it across
/// launches and sets it at start. It is the most a film keeps in the cache
/// (`buffer::Ring`, read when the film starts), so with the reserve it is
/// the free space needed to start one; the cache is wiped after each film.
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
            tracing::warn!("reel engine: free space of {}: {e}", dir.display());
            json!({ "ok": true, "free": null, "needed": needed, "buffer": buffer_mb() })
        }
    }
}

/// Whether a buffer of `mb` fits on this device next to the reserve (true when the free
/// space cannot be read): a TV has about a gigabyte to spare, a computer far more.
pub fn buffer_fits(mb: u64) -> bool {
    let dir = cache_dir();
    let _ = std::fs::create_dir_all(&dir);
    disk::free_bytes(&dir).map_or(true, |free| (mb + RESERVE_MB) * MIB <= free)
}

/// Free space fell under the reserve while playing.
fn low_space() -> bool {
    disk::free_bytes(&cache_dir()).is_ok_and(|free| free < RESERVE_MB * MIB)
}

pub(crate) fn core() -> anyhow::Result<&'static Core> {
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
        let session = Session::new_with_opts(dir, session_options()).await.context("creating the torrent session")?;
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

/// Stops a job and lets go of its torrent: what it downloaded is deleted once nobody else
/// holds it (a film being saved stays, `leases`).
pub fn close(job: u32) {
    crate::subtitles::forget(job);
    let Some(core) = CORE.get() else { return };
    let Some(state) = core.jobs.lock().unwrap().remove(&job) else { return };
    if let Job::Ready(handle, _) = state {
        let release = leases::with(|l| l.release_stream(handle.id()));
        // Paused by the user before it played: paused again.
        if REPAUSE.lock().unwrap().remove(&job) && release == leases::Release::Held && crate::keep::paused_by_user(handle.id()) {
            let session = core.session.clone();
            core.rt.spawn(async move {
                let _ = session.pause(&handle).await;
            });
            return;
        }
        apply_release(core, handle.id(), release);
    }
}

/// Jobs that unpaused a saved film the user had paused (`add_to`): paused again on close.
static REPAUSE: Mutex<std::collections::BTreeSet<u32>> = Mutex::new(std::collections::BTreeSet::new());

/// Takes a torrent out of the session when its last lease is gone.
pub(crate) fn apply_release(core: &Core, id: usize, release: leases::Release) {
    let leases::Release::Delete { files } = release else { return };
    let session = core.session.clone();
    core.rt.spawn(async move {
        if let Err(e) = session.delete(id.into(), files).await {
            tracing::warn!("reel engine: deleting torrent {id}: {e:#}");
        }
    });
}


/// Starts the engine if needed; the port of its stream server.
#[cfg(test)]
pub fn start() -> anyhow::Result<u16> {
    Ok(core()?.port)
}

/// Starts playing what `key` names in the catalog (a title or an episode,
/// see `PlaybackHost::play_source`): the release the user chose or the catalog
/// picked. While the catalog still searches, the job stays `resolving` and
/// starts when a release is found (`no_source` when none is). A job id to
/// poll with `status` (which says when there is no source or no room).
pub fn open(key: &str) -> anyhow::Result<u32> {
    // A saved film plays from its file, before anything else: no search, no torrent, and
    // no room needed for the cache (a disk full of saved films still plays them).
    if let Some(path) = crate::keep::local_file(key) {
        let job = new_job(Job::Local(path));
        remember_key(job, key);
        return Ok(job);
    }
    let space = check_space();
    if space["ok"] == false {
        let needed = space["needed"].as_u64().unwrap_or_default();
        return Ok(new_job(Job::NoSpace { needed, free: space["free"].as_u64() }));
    }
    match play_source(key) {
        PlaySource::None => Ok(new_job(Job::NoSource)),
        PlaySource::NotInRelease => Ok(new_job(Job::NotInRelease)),
        PlaySource::Ready(source, episode) => {
            let job = open_release(&source, episode)?;
            remember_key(job, key);
            Ok(job)
        }
        PlaySource::Searching => {
            let job = new_job(Job::Searching);
            remember_key(job, key);
            time_start(job, "searching the source");
            if job == 0 {
                return Ok(0);
            }
            let key = key.to_owned();
            std::thread::spawn(move || {
                let started = std::time::Instant::now();
                loop {
                    std::thread::sleep(std::time::Duration::from_millis(300));
                    let Some(core) = CORE.get() else { return };
                    // Closed meanwhile (the viewer went back).
                    if !core.jobs.lock().unwrap().contains_key(&job) {
                        return;
                    }
                    match play_source(&key) {
                        PlaySource::Searching if started.elapsed() < std::time::Duration::from_secs(150) => {}
                        PlaySource::Ready(source, episode) => {
                            time_step(job, "release chosen");
                            if let Some(ep) = episode {
                                EPISODES.lock().unwrap().get_or_insert_with(HashMap::new).insert(job, ep);
                            }
                            add_to(core, job, &source);
                            return;
                        }
                        PlaySource::NotInRelease => {
                            core.jobs.lock().unwrap().insert(job, Job::NotInRelease);
                            return;
                        }
                        _ => {
                            core.jobs.lock().unwrap().insert(job, Job::NoSource);
                            return;
                        }
                    }
                }
            });
            Ok(job)
        }
    }
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

/// Starts playing a release found by a search: `source` is its magnet or
/// .torrent URL; `episode` (season, episode) picks that episode's file in a
/// pack. Checks the free space first, as `open`.
pub fn open_release(source: &str, episode: Option<(u16, u16)>) -> anyhow::Result<u32> {
    let space = check_space();
    if space["ok"] == false {
        let needed = space["needed"].as_u64().unwrap_or_default();
        return Ok(new_job(Job::NoSpace { needed, free: space["free"].as_u64() }));
    }
    let job = add(source)?;
    if let Some(ep) = episode {
        EPISODES.lock().unwrap().get_or_insert_with(HashMap::new).insert(job, ep);
    }
    Ok(job)
}

/// Adds a magnet link or torrent URL; returns a job id to poll with `status`.
pub fn add(url: &str) -> anyhow::Result<u32> {
    let core = core()?;
    let job = core.next_job.fetch_add(1, Ordering::Relaxed);
    add_to(core, job, url);
    Ok(job)
}

/// Adds a magnet link or torrent URL as job `job` (resolving until it is in).
/// Open public trackers added to every magnet, as torrent clients do
/// ("automatically add these trackers"): magnets from indexers often name one
/// tracker or none, and DHT alone finds peers slowly.
const OPEN_TRACKERS: [&str; 6] = [
    "udp://tracker.opentrackr.org:1337/announce",
    "udp://open.stealth.si:80/announce",
    "udp://tracker.torrent.eu.org:451/announce",
    "udp://exodus.desync.com:6969/announce",
    "udp://open.demonii.com:1337/announce",
    "udp://explodie.org:6969/announce",
];

/// A magnet with the open trackers it does not name yet; other URLs as they are.
pub(crate) fn with_open_trackers(url: &str) -> String {
    if !url.starts_with("magnet:") {
        return url.to_owned();
    }
    let mut out = url.to_owned();
    for tr in OPEN_TRACKERS {
        let encoded: String = tr.bytes().map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => (b as char).to_string(),
            _ => format!("%{b:02X}"),
        }).collect();
        if !out.contains(&encoded) && !out.contains(tr) {
            out.push_str("&tr=");
            out.push_str(&encoded);
        }
    }
    out
}

// ---- Timing log: how long each step from Play to the picture takes -------

/// When each job's Play was pressed, the steps logged so far, and when peers were last logged.
static TIMES: Mutex<Option<HashMap<u32, (std::time::Instant, Vec<&'static str>, std::time::Instant)>>> = Mutex::new(None);

/// `$TMPDIR/reel-timings.log`: one line per step, `+ms` since Play.
pub fn timing_log() -> PathBuf {
    std::env::temp_dir().join("reel-timings.log")
}

/// Tuned for starting fast from a big swarm: most addresses trackers give are
/// behind NAT or gone, so a short connect timeout frees slots for the ones
/// that answer; more slots; uTP too (many peers behind NAT only take uTP).
fn session_options() -> SessionOptions {
    SessionOptions {
        listen: Some(ListenerOptions {
            mode: ListenerMode::TcpAndUtp,
            ..Default::default()
        }),
        connect: Some(ConnectionOptions {
            peer_opts: Some(PeerConnectionOptions {
                connect_timeout: Some(std::time::Duration::from_secs(3)),
                ..Default::default()
            }),
            ..Default::default()
        }),
        peer_limit: Some(PEER_LIMIT),
        // librqbit's permits for blocking work (`runtime_worker_threads` sizes only that):
        // every open stream holds one while it is open (the player's, warming, subtitles) and
        // adding a torrent needs one, so with its 8 a film playing kept a saved one from
        // being added for minutes. Not threads: the runtime keeps its own.
        runtime_worker_threads: Some(BLOCKING_PERMITS),
        // The DHT's state in reel's own file: librqbit's default asks the OS for a project
        // directory, which Android has none of ("cannot determine project directory"), and
        // the session did not start. Beside the cache, not in it (the cache is wiped).
        dht: Some(DhtSessionConfig {
            persistence: Some(librqbit::dht::DhtPersistenceConfig {
                config_filename: Some(std::env::temp_dir().join("reel-dht.json")),
                ..Default::default()
            }),
            ..Default::default()
        }),
        ..Default::default()
    }
}

/// librqbit's permits for blocking work: one per open stream, one per torrent being added.
const BLOCKING_PERMITS: usize = 64;

/// Peers connected or being connected per torrent (librqbit's default is 128).
const PEER_LIMIT: usize = 300;

pub(crate) fn log_line(line: &str) {
    use std::io::Write;
    eprintln!("reel timing {line}");
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(timing_log()) {
        let _ = writeln!(f, "{line}");
    }
}

/// Starts timing a job (Play pressed).
fn time_start(job: u32, what: &str) {
    let now = std::time::Instant::now();
    TIMES.lock().unwrap().get_or_insert_with(HashMap::new).insert(job, (now, Vec::new(), now));
    log_line(&format!("job {job} +0 ms play ({what})"));
}

/// Logs a step the first time it happens.
pub fn time_step(job: u32, step: &'static str) {
    let line = {
        let mut times = TIMES.lock().unwrap();
        let Some((t0, done, _)) = times.get_or_insert_with(HashMap::new).get_mut(&job) else { return };
        if done.contains(&step) {
            return;
        }
        done.push(step);
        format!("job {job} +{} ms {step}", t0.elapsed().as_millis())
    };
    log_line(&line);
}

/// Logs a measurement for a job being timed (every time, unlike `time_step`).
fn time_note(job: u32, what: &str) {
    let line = {
        let times = TIMES.lock().unwrap();
        let Some((t0, _, _)) = times.as_ref().and_then(|t| t.get(&job)) else { return };
        format!("job {job} +{} ms {what}", t0.elapsed().as_millis())
    };
    log_line(&line);
}

/// Every 2 s while timing: the peers by state.
fn time_peers(job: u32, p: &Value, speed: f64) {
    let line = {
        let mut times = TIMES.lock().unwrap();
        let Some((t0, _, last)) = times.get_or_insert_with(HashMap::new).get_mut(&job) else { return };
        if last.elapsed() < std::time::Duration::from_secs(2) {
            return;
        }
        *last = std::time::Instant::now();
        format!(
            "job {job} +{} ms peers: seen {} queued {} connecting {} live {} (seeders {}, tcp {}, utp {}) not_needed {} dead {}; {:.2} MiB/s",
            t0.elapsed().as_millis(), p["seen"], p["queued"], p["connecting"], p["live"], p["live_seeders"], p["live_tcp"], p["live_utp"], p["not_needed"], p["dead"], speed
        )
    };
    log_line(&line);
}

// ---- Warming: the pieces the player will ask for next, asked for at once -------------

/// What each job plays (a catalog key), for where it resumes.
static JOB_KEYS: Mutex<Option<HashMap<u32, String>>> = Mutex::new(None);
/// Jobs whose first frame is on screen: their warming streams let go.
static FIRST_FRAMES: Mutex<Option<std::collections::HashSet<u32>>> = Mutex::new(None);
/// The end of the file the player reads before playing (an MKV's index sits there).
const TAIL_BYTES: u64 = 4 * MIB;
/// A warming stream lets go after this even without a first frame.
const WARM_FOR: std::time::Duration = std::time::Duration::from_secs(120);

fn remember_key(job: u32, key: &str) {
    JOB_KEYS.lock().unwrap().get_or_insert_with(HashMap::new).insert(job, key.to_owned());
}

/// The player shows its first frame: warming is over.
pub fn first_frame_shown(job: u32) {
    FIRST_FRAMES.lock().unwrap().get_or_insert_with(std::collections::HashSet::new).insert(job);
}

fn first_frame_seen(job: u32) -> bool {
    FIRST_FRAMES.lock().unwrap().as_ref().is_some_and(|s| s.contains(&job))
}

/// The player reads the file's start, then its end (the index), then seeks to where the
/// viewer stopped, one after the other, and each piece can take seconds: the end and the
/// resume point are asked for at once, by streams held until the first frame is on screen.
fn warm(job: u32, handle: Arc<librqbit::ManagedTorrent>) {
    let Some(file) = video_file(&handle, job) else { return };
    let Some(len) = handle.with_metadata(|m| m.file_infos.get(file).map(|f| f.len)).ok().flatten() else { return };
    let mut spots: Vec<(u64, &'static str)> = vec![(len.saturating_sub(TAIL_BYTES), "end of the file in")];
    let key = JOB_KEYS.lock().unwrap().as_ref().and_then(|k| k.get(&job).cloned());
    if let Some(e) = key.and_then(|k| host()?.resume(&k)).filter(|e| !e.watched && e.position > 0.0 && e.duration > 0.0) {
        // Bytes in proportion to time: near enough to fetch the right pieces first.
        let at = (len as f64 * (e.position / e.duration).clamp(0.0, 1.0)) as u64;
        spots.push((at, "resume point in"));
    }
    for (at, step) in spots {
        let h = handle.clone();
        tokio::spawn(async move {
            use tokio::io::{AsyncReadExt, AsyncSeekExt};
            let Ok(mut stream) = h.stream(file).await else { return };
            if stream.seek(std::io::SeekFrom::Start(at)).await.is_err() {
                return;
            }
            let started = std::time::Instant::now();
            let mut byte = [0u8; 1];
            if tokio::time::timeout(WARM_FOR, stream.read(&mut byte)).await.is_ok_and(|r| r.is_ok()) {
                time_step(job, step);
            }
            // Held, so the buffer keeps those pieces until the player has read them.
            while !first_frame_seen(job) && started.elapsed() < WARM_FOR {
                tokio::time::sleep(std::time::Duration::from_millis(500)).await;
            }
        });
    }
}

// ---- A release's files, read before it plays --------------------------------

type Files = Vec<(usize, String, u64)>;
/// The files of the releases asked about: None while reading (or when it failed).
static FILES: Mutex<Option<HashMap<String, Option<Files>>>> = Mutex::new(None);

/// The files of the torrent `url` (a source link or a magnet): None the first
/// time, while the engine reads its metadata (a .torrent at once, a magnet
/// from peers) without downloading any of it; the catalog is told when they are in.
pub fn torrent_files(url: &str) -> Option<Files> {
    {
        let mut all = FILES.lock().unwrap();
        let all = all.get_or_insert_with(HashMap::new);
        if let Some(known) = all.get(url) {
            return known.clone();
        }
        all.insert(url.to_owned(), None);
    }
    let Ok(core) = core() else { return None };
    let (session, url) = (core.session.clone(), url.to_owned());
    core.rt.spawn(async move {
        let add = if url.starts_with("http://") || url.starts_with("https://") {
            match fetch_once(&url).await {
                Ok(Fetched::Torrent(bytes)) => AddTorrent::from_bytes(bytes),
                Ok(Fetched::Magnet(magnet)) => AddTorrent::from_url(with_open_trackers(&magnet)),
                Err(_) => return,
            }
        } else {
            AddTorrent::from_url(with_open_trackers(&url))
        };
        let options = AddTorrentOptions { list_only: true, ..Default::default() };
        let listed = tokio::time::timeout(std::time::Duration::from_secs(90), session.add_torrent(add, Some(options))).await;
        if let Ok(Ok(librqbit::AddTorrentResponse::ListOnly(l))) = listed {
            let files: Files = l
                .info
                .iter_file_details()
                .enumerate()
                .map(|(i, d)| (i, d.filename.to_pathbuf().to_string_lossy().into_owned(), d.len))
                .collect();
            FILES.lock().unwrap().get_or_insert_with(HashMap::new).insert(url, Some(files));
            if let Some(host) = host() {
                host.files_known();
            }
        }
    });
    None
}

// ---- Prefetch: the source's link is opened while the title screen shows -----

/// A source link being opened, or opened: Play awaits it instead of asking the
/// source again (Jackett takes seconds per link, it opens the tracker's page).
type Prefetched = Arc<tokio::sync::OnceCell<Result<Fetched, String>>>;
/// The links prefetched, oldest first (a few: the titles last looked at).
static PREFETCHED: Mutex<Vec<(String, Prefetched)>> = Mutex::new(Vec::new());
const PREFETCH_KEEP: usize = 8;

fn prefetched(url: &str) -> (Prefetched, bool) {
    let mut all = PREFETCHED.lock().unwrap();
    if let Some((_, cell)) = all.iter().find(|(u, _)| u == url) {
        return (cell.clone(), false);
    }
    let cell = Prefetched::default();
    all.push((url.to_owned(), cell.clone()));
    if all.len() > PREFETCH_KEEP {
        all.remove(0);
    }
    (cell, true)
}

pub(crate) async fn fetch_once(url: &str) -> Result<Fetched, String> {
    let (cell, _) = prefetched(url);
    let r = cell.get_or_init(|| async { fetch_torrent(url).await.map_err(|e| format!("{e:#}")) }).await.clone();
    if r.is_err() {
        // A failure is not kept: Play asks again.
        PREFETCHED.lock().unwrap().retain(|(u, _)| u != url);
    }
    r
}

/// Opens `url` (a source's http(s) link) in the background, once.
pub fn prefetch(url: &str) {
    if !(url.starts_with("http://") || url.starts_with("https://")) || !prefetched(url).1 {
        return;
    }
    let Ok(core) = core() else { return };
    let url = url.to_owned();
    core.rt.spawn(async move {
        let _ = fetch_once(&url).await;
    });
}

/// What a source's http(s) link turned out to be.
#[derive(Clone)]
pub(crate) enum Fetched {
    /// A .torrent file.
    Torrent(Vec<u8>),
    /// A magnet the link redirects to (Jackett does so for trackers that only give magnets).
    Magnet(String),
}

/// Opens a source's link ourselves, so a redirect to a magnet works (the
/// torrent library's own HTTP fetch stops at it).
async fn fetch_torrent(url: &str) -> anyhow::Result<Fetched> {
    let client = crate::http_client::client_builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_secs(30))
        .build()?;
    let mut current = url.to_owned();
    for _ in 0..5 {
        let resp = client.get(&current).send().await?;
        let status = resp.status();
        if status.is_redirection() {
            let location = resp
                .headers()
                .get(reqwest::header::LOCATION)
                .and_then(|v| v.to_str().ok())
                .ok_or_else(|| anyhow::anyhow!("the source redirected without saying where"))?;
            if location.starts_with("magnet:") {
                return Ok(Fetched::Magnet(location.to_owned()));
            }
            current = reqwest::Url::parse(&current)?.join(location)?.to_string();
            continue;
        }
        if !status.is_success() {
            anyhow::bail!("the source answered HTTP {}", status.as_u16());
        }
        let body = resp.bytes().await?;
        if body.starts_with(b"magnet:") {
            return Ok(Fetched::Magnet(String::from_utf8_lossy(&body).trim().to_owned()));
        }
        return Ok(Fetched::Torrent(body.to_vec()));
    }
    anyhow::bail!("the source redirected too many times")
}

use reel_domain::redact::redact;

fn add_to(core: &Core, job: u32, url: &str) {
    if !TIMES.lock().unwrap().as_ref().is_some_and(|t| t.contains_key(&job)) {
        time_start(job, "release known");
    }
    core.jobs.lock().unwrap().insert(job, Job::Resolving);
    let (session, jobs, url) = (core.session.clone(), core.jobs.clone(), with_open_trackers(url));
    // The film's cache: at most the buffer, around where the player reads.
    let link = buffer::Link::default();
    let storage = buffer::RingFactory::new(cache_dir().join("ring"), buffer_mb() * MIB, link.clone());
    core.rt.spawn(async move {
        let options = AddTorrentOptions {
            overwrite: true,
            // No file is downloaded whole: only what the streams read ahead
            // (sized by the ring to fit the buffer) is fetched.
            only_files: Some(Vec::new()),
            storage_factory: Some(storage.boxed()),
            ..Default::default()
        };
        let add = if url.starts_with("http://") || url.starts_with("https://") {
            match fetch_once(&url).await.map_err(anyhow::Error::msg) {
                Ok(Fetched::Torrent(bytes)) => {
                    time_step(job, "source gave a .torrent");
                    Ok(AddTorrent::from_bytes(bytes))
                }
                Ok(Fetched::Magnet(magnet)) => {
                    time_step(job, "source gave a magnet");
                    Ok(AddTorrent::from_url(with_open_trackers(&magnet)))
                }
                Err(e) => Err(e),
            }
        } else {
            Ok(AddTorrent::from_url(url.clone()))
        };
        let result = match add {
            Ok(add) => session.add_torrent(add, Some(options)).await,
            Err(e) => Err(e),
        };
        let state = match result {
            Ok(librqbit::AddTorrentResponse::Added(id, handle)) => {
                leases::with(|l| l.take_stream(id));
                time_step(job, "torrent added, metadata known");
                if let Ok((piece, total)) = handle.with_metadata(|m| (m.lengths().default_piece_length(), m.lengths().total_length())) {
                    time_note(job, &format!("{} KiB pieces, {} MiB torrent", piece / 1024, total / MIB));
                }
                link.attach(&handle);
                // Streams exist once it is initialized: size their readahead.
                let (h, l) = (handle.clone(), link.clone());
                tokio::spawn(async move {
                    if h.wait_until_initialized().await.is_ok() {
                        l.sync();
                        warm(job, h);
                    }
                });
                Job::Ready(handle, Some(link))
            }
            // Already in the session (a film being saved, or another job): read it as it is.
            Ok(librqbit::AddTorrentResponse::AlreadyManaged(id, handle)) => {
                leases::with(|l| l.take_stream(id));
                time_step(job, "torrent already in the session");
                // A saved film the user paused: it downloads while it plays, and pauses again
                // when the player closes (`close`).
                if handle.is_paused() && crate::keep::paused_by_user(id) {
                    if let Err(e) = session.unpause(&handle).await {
                        tracing::warn!("reel engine: unpausing {id} to play it: {e:#}");
                    }
                    REPAUSE.lock().unwrap().insert(job);
                }
                let h = handle.clone();
                tokio::spawn(async move {
                    if h.wait_until_initialized().await.is_ok() {
                        warm(job, h);
                    }
                });
                Job::Ready(handle, None)
            }
            Ok(librqbit::AddTorrentResponse::ListOnly(_)) => Job::Failed("the torrent was only listed".into()),
            Err(e) => Job::Failed(redact(&format!("{e:#}"))),
        };
        // Closed while it was being added: let it go.
        let orphan = {
            let mut jobs = jobs.lock().unwrap();
            if jobs.contains_key(&job) {
                jobs.insert(job, state);
                None
            } else {
                Some(state)
            }
        };
        if let Some(Job::Ready(handle, _)) = orphan {
            if let leases::Release::Delete { files } = leases::with(|l| l.release_stream(handle.id())) {
                let _ = session.delete(handle.id().into(), files).await;
            }
        }
    });
}

/// How much of the file's start must be in before the player can open it
/// (headers and the first seconds): what the loading screen counts up to.
const START_BYTES: u64 = 8 * MIB;

/// What the player shows for the job, as JSON with a `phase`:
/// - `"no_source"`, `"not_in_release"` (the episode is not in its season's
///   release: the viewer picks another), `"no_space"` (`needed`, `free` bytes, `free` may be null),
///   `"failed"` (`message`);
/// - `"resolving"`: `stage` is `"searching"` (the catalog still looks for a
///   release) or `"finding"` (asking people for the torrent's metadata);
/// - `"ready"`: `stream_url` (where the player opens the video), `file`,
///   `name`, `low_space` (the device ran out of room while playing),
///   `speed` (MiB/s), `peers` (connected now) and `found` (people seen so
///   far), both null when unknown, `progress` (0..1 of the video in the
///   cache now: the buffer holds only a window of it), `start` (percent,
///   0..=100, of the file's first `START_BYTES` in without a gap) and
///   `stage`: `"connecting"` (no one connected yet), `"fetching"` (the start
///   is coming in) or `"starting"` (the start is in; the player opens it).
pub fn status(job: u32) -> Value {
    let Some(core) = CORE.get() else {
        return json!({ "phase": "failed", "message": "the engine is not started" });
    };
    let Some(state) = core.jobs.lock().unwrap().get(&job).cloned() else {
        return json!({ "phase": "failed", "message": format!("no job {job}") });
    };
    match state {
        Job::NoSource => json!({ "phase": "no_source" }),
        Job::NotInRelease => json!({ "phase": "not_in_release" }),
        Job::NoSpace { needed, free } => json!({ "phase": "no_space", "needed": needed, "free": free }),
        Job::Searching => json!({ "phase": "resolving", "stage": "searching" }),
        Job::Resolving => json!({ "phase": "resolving", "stage": "finding" }),
        Job::Failed(message) => json!({ "phase": "failed", "message": message }),
        Job::Local(path) => json!({
            "phase": "ready",
            "name": path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(),
            "file": 0,
            "stream_url": file_url(&path),
            "low_space": false,
            "speed": 0.0,
            "peers": null,
            "found": null,
            "start": 100,
            "stage": "starting",
            "progress": 1.0,
            "local": true,
        }),
        Job::Ready(handle, link) => {
            let Some(file) = video_file(&handle, job) else {
                // A pack whose name promised the episode, but its files lack it.
                if episode_of(job).is_some() {
                    return json!({ "phase": "not_in_release" });
                }
                return json!({ "phase": "failed", "message": "no video in this torrent" });
            };
            // The release name said nothing against it; the file itself may still
            // be in a container this device's player cannot open.
            let name = handle
                .with_metadata(|m| m.file_infos.get(file).map(|f| f.relative_filename.to_string_lossy().into_owned()))
                .ok()
                .flatten()
                .unwrap_or_default();
            if let Err(reason) = compat::file_ok(&name, compat::profile()) {
                return json!({ "phase": "unsupported", "reason": reason });
            }
            // The player polls this: keep the cache's idea of the readers fresh.
            if let Some(link) = &link {
                link.sync();
            }
            let stats = handle.stats();
            let file_len = handle.with_metadata(|m| m.file_infos.get(file).map(|f| f.len)).ok().flatten();
            let cached = stats.file_progress.get(file).copied().unwrap_or(0);
            let live = stats.live.as_ref();
            let peers = live.map(|l| l.snapshot.peer_stats.live);
            let found = live.map(|l| l.snapshot.peer_stats.seen);
            let start = start_percent(core, &handle, file);
            if let Some(l) = live {
                if l.snapshot.peer_stats.seen > 0 {
                    time_step(job, "first peer seen");
                }
                if l.snapshot.peer_stats.live > 0 {
                    time_step(job, "first peer connected");
                }
                let peers = serde_json::to_value(&l.snapshot.peer_stats).unwrap_or(Value::Null);
                time_peers(job, &peers, l.download_speed.mbps);
            }
            if start >= 100 {
                time_step(job, "start of the film downloaded");
            }
            for w in handle.take_stream_waits() {
                time_note(job, &format!(
                    "stream read at {} MiB{}: waited {} ms for piece {} (from {} peers in {} ms)",
                    w.position / MIB,
                    if w.new_position { " (new position)" } else { "" },
                    w.waited.as_millis(),
                    w.piece,
                    w.piece_peers.map_or("?".into(), |p| p.to_string()),
                    w.piece_download.map_or("?".into(), |d| d.as_millis().to_string()),
                ));
            }
            let stage = if start >= 100 {
                "starting"
            } else if peers.unwrap_or(0) == 0 {
                "connecting"
            } else {
                "fetching"
            };
            json!({
                "phase": "ready",
                "name": handle.name(),
                "file": file,
                "stream_url": format!("http://127.0.0.1:{}/torrents/{}/stream/{file}", core.port, handle.id()),
                "low_space": low_space(),
                "speed": live.map(|l| l.download_speed.mbps).unwrap_or(0.0),
                "peers": peers,
                "found": found,
                "start": start,
                "stage": stage,
                "progress": match file_len { Some(len) if len > 0 => cached as f64 / len as f64, _ => 0.0 },
            })
        }
    }
}

fn video_file(handle: &librqbit::ManagedTorrent, job: u32) -> Option<usize> {
    let files: Vec<(usize, String, u64)> = handle
        .with_metadata(|m| {
            m.file_infos
                .iter()
                .enumerate()
                .map(|(index, f)| (index, f.relative_filename.to_string_lossy().into_owned(), f.len))
                .collect()
        })
        .ok()?;
    episode::pick(&files, episode_of(job))
}

/// What a ready job plays, for the subtitles: its torrent, the video's
/// file index, and the torrent's files (index, path, length). None until the
/// torrent's metadata is in (or for a job that does not play).
pub(crate) fn playing_files(job: u32) -> Option<(Arc<librqbit::ManagedTorrent>, usize, Vec<(usize, String, u64)>)> {
    let core = CORE.get()?;
    let Some(Job::Ready(handle, _)) = core.jobs.lock().unwrap().get(&job).cloned() else { return None };
    let files: Vec<(usize, String, u64)> = handle
        .with_metadata(|m| {
            m.file_infos
                .iter()
                .enumerate()
                .map(|(index, f)| (index, f.relative_filename.to_string_lossy().into_owned(), f.len))
                .collect()
        })
        .ok()?;
    let video = episode::pick(&files, episode_of(job))?;
    Some((handle, video, files))
}

/// What a saved film's job plays, for its subtitles: the item's folder, the video's index and
/// its files (index, path in that folder, length).
pub(crate) fn local_files(job: u32) -> Option<(PathBuf, usize, Vec<(usize, String, u64)>)> {
    let core = CORE.get()?;
    let Some(Job::Local(_)) = core.jobs.lock().unwrap().get(&job).cloned() else { return None };
    let key = JOB_KEYS.lock().unwrap().as_ref()?.get(&job)?.clone();
    crate::keep::local_files(&key)
}

/// A `file://` URL for a path, its bytes percent-encoded except the unreserved ones and `/`.
pub(crate) fn file_url(path: &std::path::Path) -> String {
    let raw = path.to_string_lossy();
    let raw = raw.replace('\\', "/");
    let mut out = String::from("file://");
    if !raw.starts_with('/') {
        out.push('/'); // a Windows drive: file:///C:/…
    }
    for b in raw.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' | b'/' | b':' => out.push(b as char),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

/// Runs `task` on the engine's runtime (started by then: a job is ready).
pub(crate) fn spawn(task: impl std::future::Future<Output = ()> + Send + 'static) {
    if let Some(core) = CORE.get() {
        core.rt.spawn(task);
    }
}

/// Buckets the scrubber is cut into.

/// What the scrubber draws for the job's video at `position` of `duration`
/// seconds: `{"ranges": [[from, to], …] (0..1 of the film, ready), "ahead":
/// seconds ready without a gap from the position}`; empty until known.
pub fn timeline(job: u32, position: f64, duration: f64, cached: f64, read_byte: f64, read_time: f64) -> Value {
    let empty = json!({ "ranges": [], "ahead": 0 });
    let Some(core) = CORE.get() else { return empty };
    let state = core.jobs.lock().unwrap().get(&job).cloned();
    if let Some(Job::Local(_)) = state {
        // All of a saved film is on disk.
        return json!({ "ranges": [[0.0, 1.0]], "ahead": (duration - position).max(0.0) });
    }
    let Some(Job::Ready(handle, _)) = state else { return empty };
    let Some(file) = video_file(&handle, job) else { return empty };
    let Some(layout) = file_layout(&handle, file) else { return empty };
    // Exactly the pieces on disk now (evicted ones are not "have" any more): the scrubber never
    // shows a stretch as ready that is not.
    let Ok((have, _)) = core.api.api_dump_haves(handle.id().into()) else { return empty };
    let on_disk = layout.ranges(|piece| have.get(piece as usize).is_some_and(|b| *b));
    // Bytes are not proportional to time (the bitrate varies): anchor them where the player
    // says it has read to, so the stretch around the picture is drawn where it is.
    let on_disk = if read_byte > 0.0 && duration > 0.0 && layout.file_length > 0 {
        timeline::shifted(on_disk, read_time / duration - read_byte / layout.file_length as f64)
    } else {
        on_disk
    };
    // What the player holds in memory ahead of the picture plays as well.
    let ready = timeline::with_player_cache(on_disk, position, cached, duration);
    let ranges: Vec<[f64; 2]> = ready.iter().map(|&(a, b)| [a, b]).collect();
    json!({ "ranges": ranges, "ahead": timeline::ready_ahead(&ready, position, duration) })
}

/// Percent (0..=100) of the first `START_BYTES` of file `file` (all of a
/// smaller file) downloaded without a gap from its first byte.
fn start_percent(core: &Core, handle: &Arc<librqbit::ManagedTorrent>, file: usize) -> u64 {
    let Some(layout) = file_layout(handle, file) else { return 0 };
    let Ok((have, _)) = core.api.api_dump_haves(handle.id().into()) else { return 0 };
    layout.start_percent(|piece| have.get(piece as usize).is_some_and(|b| *b), START_BYTES)
}

fn file_layout(handle: &Arc<librqbit::ManagedTorrent>, file: usize) -> Option<Layout> {
    handle
        .with_metadata(|m| {
            let l = m.lengths();
            m.file_infos.get(file).map(|f| Layout {
                piece_length: l.default_piece_length() as u64,
                total_length: l.total_length(),
                file_offset: f.offset_in_torrent,
                file_length: f.len,
            })
        })
        .ok()?
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
    /// Percent (0..=100) of the file's first `want` bytes (all of a smaller
    /// file) that lie in downloaded pieces without a gap from its first byte.
    fn start_percent(&self, have: impl Fn(u32) -> bool, want: u64) -> u64 {
        let want = want.min(self.file_length);
        if want == 0 || self.piece_length == 0 {
            return 0;
        }
        let end = self.file_offset + want;
        let mut piece = self.file_offset / self.piece_length;
        let mut ready = self.file_offset;
        while ready < end && have(piece as u32) {
            piece += 1;
            ready = (piece * self.piece_length).min(self.total_length);
        }
        (ready.min(end) - self.file_offset) * 100 / want
    }


    /// The stretches of the file whose pieces are all in, as `(from, to)` in 0..1 of the
    /// file, neighbours merged: exact, piece by piece.
    fn ranges(&self, have: impl Fn(u32) -> bool) -> Vec<(f64, f64)> {
        if self.file_length == 0 || self.piece_length == 0 {
            return Vec::new();
        }
        let (start, end) = (self.file_offset, self.file_offset + self.file_length);
        let span = self.file_length as f64;
        let mut out: Vec<(f64, f64)> = Vec::new();
        let mut piece = start / self.piece_length;
        while piece * self.piece_length < end {
            if have(piece as u32) {
                let from = (piece * self.piece_length).max(start) - start;
                let to = ((piece + 1) * self.piece_length).min(end).min(self.total_length) - start;
                let (from, to) = (from as f64 / span, to as f64 / span);
                match out.last_mut() {
                    Some(last) if (last.1 - from).abs() < 1e-12 => last.1 = to,
                    _ => out.push((from, to)),
                }
            }
            piece += 1;
        }
        out
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use std::io::{Read, Write};
    use std::sync::{
        Arc,
        atomic::{AtomicBool, AtomicU64, Ordering},
    };
    use std::time::{Duration, Instant};

    use super::{Layout, with_open_trackers};

    #[test]
    fn file_urls_are_encoded() {
        assert_eq!(super::file_url(std::path::Path::new("/Users/me/Movies/Metropolis (1927)/a b.mkv")), "file:///Users/me/Movies/Metropolis%20%281927%29/a%20b.mkv");
        assert_eq!(super::file_url(std::path::Path::new("/x/Фильм.mp4")), "file:///x/%D0%A4%D0%B8%D0%BB%D1%8C%D0%BC.mp4");
    }

    #[test]
    fn magnets_get_open_trackers_once() {
        let m = "magnet:?xt=urn:btih:08ada5a7a6183aae1e09d831df6748d566095a10&tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337%2Fannounce";
        let out = with_open_trackers(m);
        assert_eq!(out.matches("tracker.opentrackr.org").count(), 1, "not twice");
        assert!(out.contains("tr=udp%3A%2F%2Fopen.stealth.si%3A80%2Fannounce"));
        assert_eq!(with_open_trackers("https://indexer.example/a.torrent"), "https://indexer.example/a.torrent");
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
    fn ranges_are_exactly_the_pieces_in() {
        // Pieces of 100 bytes; the file is bytes 50..450 (pieces 0..=4, 400 bytes).
        let l = Layout { piece_length: 100, total_length: 500, file_offset: 50, file_length: 400 };
        // Pieces 1 and 2 (bytes 100..300 = file 50..250) and 4 (400..450 = file 350..400).
        assert_eq!(l.ranges(|p| p == 1 || p == 2 || p == 4), vec![(0.125, 0.625), (0.875, 1.0)]);
        assert_eq!(l.ranges(|_| true), vec![(0.0, 1.0)]);
        assert!(l.ranges(|_| false).is_empty());
        // A short last piece of the torrent.
        let short = Layout { piece_length: 100, total_length: 250, file_offset: 0, file_length: 250 };
        assert_eq!(short.ranges(|p| p == 2), vec![(0.8, 1.0)]);
    }

    #[test]
    fn start_counts_from_the_first_byte_without_a_gap() {
        // Pieces of 100 bytes; the file is bytes 50..1050; the start wanted is 400 bytes (50..450).
        let l = Layout { piece_length: 100, total_length: 1100, file_offset: 50, file_length: 1000 };
        assert_eq!(l.start_percent(|_| false, 400), 0);
        // Piece 0 holds 50..100: 50 of 400.
        assert_eq!(l.start_percent(|p| p == 0, 400), 12);
        // Pieces 0, 1 and 3, not 2: 50..200, a gap after.
        assert_eq!(l.start_percent(|p| p != 2, 400), 37);
        assert_eq!(l.start_percent(|p| p <= 4, 400), 100);
        // A file smaller than what is wanted: all of it.
        let small = Layout { piece_length: 100, total_length: 150, file_offset: 0, file_length: 150 };
        assert_eq!(small.start_percent(|p| p == 0, 400), 66);
        assert_eq!(small.start_percent(|_| true, 400), 100);
        assert_eq!(Layout { file_length: 0, ..small }.start_percent(|_| true, 400), 0);
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

    /// One Range request on the stream server: the body (status must be 206)
    /// and the whole file's length from Content-Range.
    fn get_range(port: u16, path: &str, from: u64, to: u64) -> (Vec<u8>, u64) {
        let mut conn = std::net::TcpStream::connect(("127.0.0.1", port)).unwrap();
        conn.set_read_timeout(Some(Duration::from_secs(300))).unwrap();
        write!(conn, "GET {path} HTTP/1.1\r\nHost: 127.0.0.1\r\nRange: bytes={from}-{to}\r\nConnection: close\r\n\r\n").unwrap();
        let mut raw = Vec::new();
        conn.read_to_end(&mut raw).unwrap();
        let split = raw.windows(4).position(|w| w == b"\r\n\r\n").expect("headers") + 4;
        let head = String::from_utf8_lossy(&raw[..split]).into_owned();
        assert!(head.starts_with("HTTP/1.1 206"), "{head}");
        let total = head
            .lines()
            .find_map(|l| l.to_ascii_lowercase().strip_prefix("content-range: bytes ").map(str::to_owned))
            .and_then(|r| r.rsplit('/').next()?.trim().parse().ok())
            .expect("content-range");
        (raw[split..].to_vec(), total)
    }

    fn tree_bytes(dir: &std::path::Path) -> u64 {
        let Ok(entries) = std::fs::read_dir(dir) else { return 0 };
        entries
            .flatten()
            .map(|e| match e.metadata() {
                Ok(m) if m.is_dir() => tree_bytes(&e.path()),
                Ok(m) => m.len(),
                Err(_) => 0,
            })
            .sum()
    }

    /// Whether the scrubber shows `at` (0..1 of the film) as ready.
    fn ready_at(job: u32, at: f64) -> bool {
        let t = super::timeline(job, 0.0, 100.0, 0.0, 0.0, 0.0);
        t["ranges"].as_array().unwrap().iter().any(|r| r[0].as_f64().unwrap() <= at && at < r[1].as_f64().unwrap())
    }

    /// The ring buffer on a real torrent (needs the network, downloads ~80 MB):
    /// `cargo test -- --ignored ring_buffer --nocapture`. With a 64 MiB buffer:
    /// read 48 MiB from the start, seek to 80% and read to the end (the start
    /// is evicted), seek back to 5% (downloaded again, same bytes). The cache
    /// never holds more than the buffer and one piece.
    #[test]
    #[ignore]
    fn ring_buffer_streams_sintel_in_64_mib() {
        const MIB: u64 = super::MIB;
        super::set_buffer_mb(64);
        let budget = 64 * MIB;
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
        assert_eq!(status["phase"], "ready", "{status}");
        let url = status["stream_url"].as_str().unwrap().to_owned();
        let path = url[url.find("/torrents").unwrap()..].to_owned();
        let piece_len = {
            let core = super::CORE.get().unwrap();
            let Some(super::Job::Ready(h, _)) = core.jobs.lock().unwrap().get(&job).cloned() else { panic!() };
            h.with_metadata(|m| m.lengths().default_piece_length() as u64).unwrap()
        };

        // Watch the cache's size the whole time.
        let done = Arc::new(AtomicBool::new(false));
        let peak = Arc::new(AtomicU64::new(0));
        let watcher = {
            let (done, peak) = (done.clone(), peak.clone());
            std::thread::spawn(move || {
                while !done.load(Ordering::Relaxed) {
                    peak.fetch_max(tree_bytes(&super::cache_dir().join("ring")), Ordering::Relaxed);
                    std::thread::sleep(Duration::from_millis(50));
                }
            })
        };

        let t = Instant::now();
        let (start, len) = get_range(port, &path, 0, 48 * MIB - 1);
        assert_eq!(start.len() as u64, 48 * MIB);
        let five = len / 20;
        let probe = start[five as usize..(five + 2 * MIB) as usize].to_vec();
        println!("{len} B file, {piece_len} B pieces; 48 MiB from the start in {:?}", t.elapsed());

        let t = Instant::now();
        let eighty = len * 8 / 10;
        let (tail, _) = get_range(port, &path, eighty, len - 1);
        assert_eq!(tail.len() as u64, len - eighty);
        println!("80%..end in {:?}; cache {} MiB", t.elapsed(), tree_bytes(&super::cache_dir().join("ring")) / MIB);
        assert!(!ready_at(job, 0.05), "5% should be evicted by now");

        let t = Instant::now();
        let (again, _) = get_range(port, &path, five, five + 2 * MIB - 1);
        println!("back to 5% in {:?}", t.elapsed());
        assert!(again == probe, "the bytes downloaded again differ");
        assert!(ready_at(job, 0.05));

        done.store(true, Ordering::Relaxed);
        watcher.join().unwrap();
        let peak = peak.load(Ordering::Relaxed);
        println!("peak cache {:.1} MiB (budget 64 MiB + a piece of {} KiB)", peak as f64 / MIB as f64, piece_len / 1024);
        assert!(peak <= budget + piece_len, "cache peaked at {peak} B");
        super::close(job);
        super::set_buffer_mb(super::DEFAULT_BUFFER_MB);
    }
}
