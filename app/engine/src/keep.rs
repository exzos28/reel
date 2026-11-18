//! Saved films and episodes (design/offline-downloads.md): a torrent's chosen files saved whole
//! with librqbit's filesystem storage into the user's folder, and played from there without
//! the internet.
//!
//! - Items are what the user saved: a film or an episode, by catalog key. Several items can
//!   share a torrent (episodes of a season pack): its selected files are their union.
//! - The library (`<data>/saved/library.json`) keeps the items, the folder and the .torrent of
//!   each infohash (`<data>/saved/torrents/`), never the source's link (it carries an API key).
//! - A torrent being saved is leased (`leases`): a stream of it reads the same files, and
//!   closing the player never deletes them. Complete, it leaves the session with its files.
//! - Unfinished items go on when the app starts again, from their .torrent.

use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use librqbit::{AddTorrent, AddTorrentOptions, AddTorrentResponse, ManagedTorrent};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::{
    disk,
    engine::{self, Fetched},
    leases,
};
use reel_domain::{compat, episode, ports::KeepRequest, redact::redact, subtitles::files};

/// Kept free on the folder's volume when deciding whether an item fits.
const RESERVE: u64 = 512 * 1024 * 1024;
/// How often the background checks what completed.
const TICK: Duration = Duration::from_secs(2);

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum State {
    /// Opening the source's link and reading the torrent's metadata.
    Resolving,
    Saving,
    /// The user paused it.
    Paused,
    /// The same torrent plays from the streaming cache now: saving starts when it closes.
    Waiting,
    Saved,
    Failed,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Item {
    pub id: u32,
    pub key: String,
    pub title: String,
    #[serde(default)]
    pub label: String,
    #[serde(default)]
    pub image: String,
    #[serde(default)]
    pub episode: Option<(u16, u16)>,
    /// Where its torrent's files go (`<folder>/<Title (year)>`).
    pub dir: PathBuf,
    #[serde(default)]
    pub infohash: Option<String>,
    /// The video's index in the torrent.
    #[serde(default)]
    pub video: Option<usize>,
    /// Its files in the torrent (the video and its subtitles): (index, path, length).
    #[serde(default)]
    pub files: Vec<(usize, String, u64)>,
    pub state: State,
    /// Why it failed (the app words the known ones).
    #[serde(default)]
    pub message: Option<String>,
    /// Seconds since 1970.
    pub added: u64,
}

impl Item {
    pub fn size(&self) -> u64 {
        self.files.iter().map(|f| f.2).sum()
    }

    fn indexes(&self) -> impl Iterator<Item = usize> + '_ {
        self.files.iter().map(|f| f.0)
    }

    /// Its video on disk.
    pub fn video_path(&self) -> Option<PathBuf> {
        let v = self.video?;
        self.files.iter().find(|f| f.0 == v).map(|f| self.dir.join(&f.1))
    }

    fn unfinished(&self) -> bool {
        matches!(self.state, State::Resolving | State::Saving | State::Paused | State::Waiting)
    }
}

#[derive(Serialize, Deserialize, Default)]
struct Stored {
    #[serde(default)]
    folder: Option<PathBuf>,
    #[serde(default)]
    next_id: u32,
    #[serde(default)]
    items: Vec<Item>,
}

struct Library {
    /// `<data>/saved`: the library file and the .torrent files.
    home: PathBuf,
    stored: Stored,
    /// The torrents being saved, by infohash: their handle and librqbit id.
    live: HashMap<String, (usize, Arc<ManagedTorrent>)>,
    revision: u64,
}

static LIB: Mutex<Option<Library>> = Mutex::new(None);

fn with<R>(f: impl FnOnce(&mut Library) -> R) -> Option<R> {
    LIB.lock().unwrap().as_mut().map(f)
}

fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs())
}

impl Library {
    fn file(&self) -> PathBuf {
        self.home.join("library.json")
    }

    fn torrent_file(&self, infohash: &str) -> PathBuf {
        self.home.join("torrents").join(format!("{infohash}.torrent"))
    }

    fn folder(&self) -> PathBuf {
        self.stored.folder.clone().unwrap_or_else(|| self.home.clone())
    }

    /// Writes the library (a temp file, synced, then renamed: a crash leaves the old one).
    fn save(&mut self) {
        self.revision += 1;
        let file = self.file();
        let tmp = file.with_extension("json.tmp");
        let Ok(text) = serde_json::to_vec_pretty(&self.stored) else { return };
        let written = (|| -> std::io::Result<()> {
            use std::io::Write;
            let mut f = std::fs::File::create(&tmp)?;
            f.write_all(&text)?;
            f.sync_all()?;
            std::fs::rename(&tmp, &file)
        })();
        if let Err(e) = written {
            tracing::warn!("reel saved: writing {}: {e}", file.display());
        }
    }

    fn item_mut(&mut self, id: u32) -> Option<&mut Item> {
        self.stored.items.iter_mut().find(|i| i.id == id)
    }

    /// The files every item of `infohash` needs (what librqbit downloads of it).
    fn wanted(&self, infohash: &str) -> HashSet<usize> {
        self.stored
            .items
            .iter()
            .filter(|i| i.infohash.as_deref() == Some(infohash) && i.state != State::Failed)
            .flat_map(|i| i.indexes().collect::<Vec<_>>())
            .collect()
    }
}

/// A folder name from a title: no characters a file system refuses, at most 100 characters.
pub fn folder_name(title: &str, year: Option<u32>) -> String {
    let clean: String = title
        .chars()
        .map(|c| if c.is_control() || r#"/\:*?"<>|"#.contains(c) { ' ' } else { c })
        .collect();
    let clean = clean.split_whitespace().collect::<Vec<_>>().join(" ");
    let clean: String = clean.trim_matches('.').chars().take(100).collect();
    let clean = if clean.is_empty() { "reel".to_owned() } else { clean };
    match year {
        Some(y) => format!("{clean} ({y})"),
        None => clean,
    }
}

// ---- Opening the library ---------------------------------------------------------------

/// Opens the library in `data_dir/saved` and goes on saving what was unfinished. Once.
pub fn init(data_dir: &Path) {
    let home = data_dir.join("saved");
    let mut guard = LIB.lock().unwrap();
    if guard.is_some() {
        return;
    }
    let _ = std::fs::create_dir_all(home.join("torrents"));
    let stored: Stored = std::fs::read(home.join("library.json"))
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default();
    let mut lib = Library { home, stored, live: HashMap::new(), revision: 1 };
    // Without its link (never stored) an item that had no torrent yet cannot go on.
    for item in lib.stored.items.iter_mut() {
        if matches!(item.state, State::Resolving | State::Waiting) {
            item.state = State::Failed;
            item.message = Some("interrupted".into());
        }
    }
    let resume: Vec<(String, PathBuf, bool)> = {
        let mut seen = HashSet::new();
        lib.stored
            .items
            .iter()
            .filter(|i| i.unfinished())
            .filter_map(|i| {
                let hash = i.infohash.clone()?;
                seen.insert(hash.clone()).then(|| {
                    let paused = lib.stored.items.iter().filter(|o| o.infohash.as_deref() == Some(&hash) && o.unfinished()).all(|o| o.state == State::Paused);
                    (hash, i.dir.clone(), paused)
                })
            })
            .collect()
    };
    let resume: Vec<_> = resume.into_iter().map(|(h, d, p)| (lib.torrent_file(&h), lib.wanted(&h), h, d, p)).collect();
    *guard = Some(lib);
    drop(guard);
    if !resume.is_empty() {
        let Ok(core) = engine::core() else { return };
        for (file, wanted, hash, dir, paused) in resume {
            let Ok(bytes) = std::fs::read(&file) else {
                fail_torrent(&hash, "the torrent file is gone");
                continue;
            };
            core.rt.spawn(async move {
                let options = AddTorrentOptions {
                    overwrite: true,
                    paused,
                    only_files: Some(wanted.into_iter().collect()),
                    output_folder: Some(dir.to_string_lossy().into_owned()),
                    ..Default::default()
                };
                match core.session.add_torrent(AddTorrent::from_bytes(bytes), Some(options)).await {
                    Ok(AddTorrentResponse::Added(id, handle) | AddTorrentResponse::AlreadyManaged(id, handle)) => {
                        leases::with(|l| l.take_keep(id));
                        with(|lib| lib.live.insert(hash, (id, handle)));
                    }
                    Ok(AddTorrentResponse::ListOnly(_)) => {}
                    Err(e) => fail_torrent(&hash, &redact(&format!("{e:#}"))),
                }
            });
        }
    }
    std::thread::Builder::new()
        .name("reel-saved".into())
        .spawn(|| loop {
            std::thread::sleep(TICK);
            tick();
        })
        .ok();
}

fn fail_torrent(hash: &str, message: &str) {
    with(|lib| {
        for i in lib.stored.items.iter_mut().filter(|i| i.infohash.as_deref() == Some(hash) && i.unfinished()) {
            i.state = State::Failed;
            i.message = Some(message.to_owned());
        }
        lib.save();
    });
}

// ---- The folder ------------------------------------------------------------------------

pub fn folder() -> Option<PathBuf> {
    with(|lib| lib.folder())
}

pub fn set_folder(folder: &Path) -> Result<(), String> {
    std::fs::create_dir_all(folder).map_err(|e| e.to_string())?;
    let probe = folder.join(".reel-write-check");
    std::fs::write(&probe, b"").map_err(|e| e.to_string())?;
    let _ = std::fs::remove_file(probe);
    with(|lib| {
        lib.stored.folder = Some(folder.to_owned());
        lib.save();
    })
    .ok_or_else(|| "not ready".to_owned())
}

// ---- Saving ----------------------------------------------------------------------------

pub fn add(req: KeepRequest) -> Result<u32, String> {
    let id = with(|lib| {
        if let Some(i) = lib.stored.items.iter().find(|i| i.key == req.key && i.state != State::Failed) {
            return i.id;
        }
        lib.stored.items.retain(|i| i.key != req.key);
        lib.stored.next_id += 1;
        let id = lib.stored.next_id;
        let dir = lib.folder().join(folder_name(&req.title, req.year));
        lib.stored.items.push(Item {
            id,
            key: req.key.clone(),
            title: req.title.clone(),
            label: req.label.clone(),
            image: req.image.clone(),
            episode: req.episode,
            dir,
            infohash: None,
            video: None,
            files: Vec::new(),
            state: State::Resolving,
            message: None,
            added: now(),
        });
        lib.save();
        id
    })
    .ok_or_else(|| "the library is not open".to_owned())?;
    let core = engine::core().map_err(|e| format!("{e:#}"))?;
    let source = req.source;
    core.rt.spawn(async move { resolve(id, source).await });
    Ok(id)
}

fn set_failed(id: u32, message: &str) {
    with(|lib| {
        if let Some(i) = lib.item_mut(id) {
            i.state = State::Failed;
            i.message = Some(message.to_owned());
        }
        lib.save();
    });
}

/// Adds the item's torrent (or finds it in the session) and selects its files.
async fn resolve(id: u32, source: String) {
    let Some((dir, ep)) = with(|lib| lib.item_mut(id).map(|i| (i.dir.clone(), i.episode))).flatten() else { return };
    let Ok(core) = engine::core() else { return };
    let add = if source.starts_with("http://") || source.starts_with("https://") {
        match engine::fetch_once(&source).await {
            Ok(Fetched::Torrent(bytes)) => AddTorrent::from_bytes(bytes),
            Ok(Fetched::Magnet(m)) => AddTorrent::from_url(engine::with_open_trackers(&m)),
            Err(e) => return set_failed(id, &redact(&e)),
        }
    } else {
        AddTorrent::from_url(engine::with_open_trackers(&source))
    };
    let options = AddTorrentOptions {
        overwrite: true,
        // Nothing until the item's files are known (below).
        only_files: Some(Vec::new()),
        output_folder: Some(dir.to_string_lossy().into_owned()),
        ..Default::default()
    };
    let (tid, handle) = match core.session.add_torrent(add, Some(options)).await {
        Ok(AddTorrentResponse::Added(tid, handle)) => {
            leases::with(|l| l.take_keep(tid));
            (tid, handle)
        }
        Ok(AddTorrentResponse::AlreadyManaged(tid, handle)) => {
            if !leases::with(|l| l.get(tid).kept) {
                // A stream reads it from the ring cache: its storage cannot change. Saving
                // starts once that stream is closed and the torrent has left the session.
                with(|lib| {
                    if let Some(i) = lib.item_mut(id) {
                        i.state = State::Waiting;
                    }
                    lib.save();
                });
                while core.session.get(tid.into()).is_some() {
                    tokio::time::sleep(Duration::from_secs(3)).await;
                    if with(|lib| lib.item_mut(id).is_none()).unwrap_or(true) {
                        return; // removed meanwhile
                    }
                }
                return Box::pin(resolve(id, source)).await;
            }
            (tid, handle)
        }
        Ok(AddTorrentResponse::ListOnly(_)) => return set_failed(id, "the torrent was only listed"),
        Err(e) => return set_failed(id, &redact(&format!("{e:#}"))),
    };
    let all: Vec<(usize, String, u64)> = match handle.with_metadata(|m| {
        m.file_infos.iter().enumerate().map(|(i, f)| (i, f.relative_filename.to_string_lossy().into_owned(), f.len)).collect()
    }) {
        Ok(all) => all,
        Err(e) => return set_failed(id, &format!("{e:#}")),
    };
    let Some(video) = episode::pick(&all, ep) else {
        return set_failed(id, if ep.is_some() { "not_in_release" } else { "no_video" });
    };
    let video_name = &all[video].1;
    if compat::file_ok(video_name, compat::profile()).is_err() {
        return set_failed(id, "unsupported");
    }
    let mut mine = vec![all[video].clone()];
    for sub in files::find(&all, video) {
        if let Some(f) = all.iter().find(|f| f.0 == sub.id) {
            mine.push(f.clone());
        }
    }
    let hash = handle.info_hash().as_string();
    let torrent_bytes = handle.with_metadata(|m| m.torrent_bytes.clone()).ok();
    let wanted = with(|lib| {
        if let Some(bytes) = &torrent_bytes {
            let file = lib.torrent_file(&hash);
            if !file.exists() {
                let _ = std::fs::write(&file, bytes);
            }
        }
        if let Some(i) = lib.item_mut(id) {
            i.infohash = Some(hash.clone());
            i.video = Some(video);
            i.files = mine;
            i.state = State::Saving;
            i.message = None;
        }
        lib.live.insert(hash.clone(), (tid, handle.clone()));
        let wanted = lib.wanted(&hash);
        lib.save();
        wanted
    });
    let Some(wanted) = wanted else { return };
    if handle.is_paused() {
        let _ = core.session.unpause(&handle).await;
    }
    if let Err(e) = core.session.update_only_files(&handle, &wanted).await {
        set_failed(id, &format!("{e:#}"));
    }
}

// ---- Progress and completion -----------------------------------------------------------

/// Bytes of the item's files on disk now (of a live torrent), or None.
fn have(lib: &Library, item: &Item) -> Option<u64> {
    let (_, handle) = lib.live.get(item.infohash.as_ref()?)?;
    let stats = handle.stats();
    Some(item.files.iter().map(|f| stats.file_progress.get(f.0).copied().unwrap_or(0).min(f.2)).sum())
}

/// Marks complete items saved; a torrent whose items are all saved leaves the session with
/// its files, and the files of it nobody saved (written by edge pieces) are deleted.
pub fn tick() {
    let finished: Vec<(String, usize, PathBuf, Vec<String>, HashSet<String>)> = with(|lib| {
        let mut changed = false;
        let ids: Vec<u32> = lib.stored.items.iter().filter(|i| i.state == State::Saving).map(|i| i.id).collect();
        for id in ids {
            let Some(item) = lib.stored.items.iter().find(|i| i.id == id) else { continue };
            if have(lib, item).is_some_and(|h| h >= item.size()) {
                let item = lib.item_mut(id).unwrap();
                item.state = State::Saved;
                changed = true;
            }
        }
        let mut done = Vec::new();
        let hashes: Vec<String> = lib.live.keys().cloned().collect();
        for hash in hashes {
            let mine = lib.stored.items.iter().filter(|i| i.infohash.as_deref() == Some(&hash));
            if mine.clone().any(Item::unfinished) {
                continue;
            }
            let keep: HashSet<String> = mine.flat_map(|i| i.files.iter().map(|f| f.1.clone()).collect::<Vec<_>>()).collect();
            let (tid, handle) = lib.live.remove(&hash).unwrap();
            let all: Vec<String> = handle
                .with_metadata(|m| m.file_infos.iter().map(|f| f.relative_filename.to_string_lossy().into_owned()).collect())
                .unwrap_or_default();
            let dir = lib.stored.items.iter().find(|i| i.infohash.as_deref() == Some(&hash)).map(|i| i.dir.clone()).unwrap_or_default();
            done.push((hash, tid, dir, all, keep));
        }
        if changed || !done.is_empty() {
            lib.save();
        }
        done
    })
    .unwrap_or_default();
    for (_, tid, dir, all, keep) in finished {
        let release = leases::with(|l| l.release_keep(tid, true));
        if let Ok(core) = engine::core() {
            engine::apply_release(core, tid, release);
        }
        for path in all.iter().filter(|p| !keep.contains(*p)) {
            remove_file_and_empty_dirs(&dir, path);
        }
    }
}

/// Deletes `dir/rel` and the folders above it (up to `dir`) left empty.
fn remove_file_and_empty_dirs(dir: &Path, rel: &str) {
    let path = dir.join(rel);
    let _ = std::fs::remove_file(&path);
    let mut parent = path.parent();
    while let Some(p) = parent {
        if !p.starts_with(dir) || std::fs::remove_dir(p).is_err() {
            break;
        }
        parent = p.parent();
    }
}

// ---- What the screens read -------------------------------------------------------------

pub fn list() -> Value {
    with(|lib| {
        let mut items: Vec<&Item> = lib.stored.items.iter().collect();
        items.sort_by(|a, b| b.added.cmp(&a.added).then(b.id.cmp(&a.id)));
        let rows: Vec<Value> = items
            .into_iter()
            .map(|i| {
                let size = i.size();
                let have = match i.state {
                    State::Saved => size,
                    _ => have(lib, i).unwrap_or(0),
                };
                let live = i.infohash.as_ref().and_then(|h| lib.live.get(h)).and_then(|(_, h)| h.stats().live);
                let state = if i.state == State::Saved && !i.video_path().is_some_and(|p| p.exists()) { "unavailable" } else { state_name(i.state) };
                json!({
                    "id": i.id,
                    "key": i.key,
                    "title": i.title,
                    "label": i.label,
                    "image": i.image,
                    "state": state,
                    "size": size,
                    "have": have,
                    "progress": if size > 0 { have as f64 / size as f64 } else { 0.0 },
                    "speed": live.as_ref().map(|l| l.download_speed.mbps),
                    "peers": live.as_ref().map(|l| l.snapshot.peer_stats.live),
                    "message": i.message,
                    "folder": i.dir,
                })
            })
            .collect();
        Value::from(rows)
    })
    .unwrap_or_else(|| json!([]))
}

fn state_name(s: State) -> &'static str {
    match s {
        State::Resolving => "resolving",
        State::Saving => "saving",
        State::Paused => "paused",
        State::Waiting => "waiting",
        State::Saved => "saved",
        State::Failed => "failed",
    }
}

pub fn revision() -> u64 {
    with(|lib| lib.revision).unwrap_or(0)
}

pub fn space() -> Value {
    let (saved, folder) = with(|lib| (lib.stored.items.iter().filter(|i| i.state != State::Failed).map(|i| have(lib, i).unwrap_or(if i.state == State::Saved { i.size() } else { 0 })).sum::<u64>(), lib.folder())).unwrap_or_default();
    let _ = std::fs::create_dir_all(&folder);
    let free = disk::free_bytes(&folder).ok();
    json!({ "saved": saved, "free": free, "folder": folder, "reserve": RESERVE })
}

/// The saved video that plays `key`, complete and on disk.
pub fn local_file(key: &str) -> Option<PathBuf> {
    with(|lib| lib.stored.items.iter().find(|i| i.key == key && i.state == State::Saved).and_then(Item::video_path))
        .flatten()
        .filter(|p| p.exists())
}

/// The files of the saved item that plays `key`: its folder, the video's index and its files
/// (for the subtitles of a saved film).
pub fn local_files(key: &str) -> Option<(PathBuf, usize, Vec<(usize, String, u64)>)> {
    with(|lib| {
        let i = lib.stored.items.iter().find(|i| i.key == key && i.state == State::Saved)?;
        Some((i.dir.clone(), i.video?, i.files.clone()))
    })
    .flatten()
}

// ---- Pausing and removing --------------------------------------------------------------

pub fn set_running(id: u32, on: bool) {
    let Some(Some((hash, handle))) = with(|lib| {
        let hash = lib.item_mut(id)?.infohash.clone()?;
        let (_, handle) = lib.live.get(&hash)?.clone();
        for i in lib.stored.items.iter_mut().filter(|i| i.infohash.as_deref() == Some(&hash)) {
            match (i.state, on) {
                (State::Saving, false) => i.state = State::Paused,
                (State::Paused, true) => i.state = State::Saving,
                _ => {}
            }
        }
        lib.save();
        Some((hash, handle))
    }) else {
        return;
    };
    let Ok(core) = engine::core() else { return };
    core.rt.spawn(async move {
        let r = if on { core.session.unpause(&handle).await } else { core.session.pause(&handle).await };
        if let Err(e) = r {
            tracing::warn!("reel saved: {} {hash}: {e:#}", if on { "resuming" } else { "pausing" });
        }
    });
}

pub fn remove(id: u32) {
    let Some(Some((item, rest))) = with(|lib| {
        let at = lib.stored.items.iter().position(|i| i.id == id)?;
        let item = lib.stored.items.remove(at);
        let rest = item.infohash.as_ref().map(|h| {
            let wanted = lib.wanted(h);
            let still = lib.stored.items.iter().any(|i| i.infohash.as_ref() == Some(h));
            let live = lib.live.get(h).cloned();
            if !still {
                let _ = std::fs::remove_file(lib.torrent_file(h));
            }
            let unfinished = lib.stored.items.iter().any(|i| i.infohash.as_ref() == Some(h) && i.unfinished());
            if !unfinished {
                lib.live.remove(h);
            }
            (wanted, live, unfinished)
        });
        lib.save();
        Some((item, rest))
    }) else {
        return;
    };
    let files: Vec<String> = item.files.iter().map(|f| f.1.clone()).collect();
    let dir = item.dir.clone();
    let Some((wanted, live, unfinished)) = rest else {
        return;
    };
    match (live, engine::core()) {
        (Some((tid, handle)), Ok(core)) => core.rt.spawn(async move {
            if unfinished {
                let _ = core.session.update_only_files(&handle, &wanted).await;
            } else {
                let release = leases::with(|l| l.release_keep(tid, true));
                engine::apply_release(core, tid, release);
                // Let librqbit close the files before they go.
                tokio::time::sleep(Duration::from_millis(500)).await;
            }
            for f in &files {
                remove_file_and_empty_dirs(&dir, f);
            }
        }),
        _ => {
            for f in &files {
                remove_file_and_empty_dirs(&dir, f);
            }
            return;
        }
    };
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn folder_names_are_safe() {
        assert_eq!(folder_name("Metropolis", Some(1927)), "Metropolis (1927)");
        assert_eq!(folder_name("Mission: Impossible / Part 2?", None), "Mission Impossible Part 2");
        assert_eq!(folder_name("...", None), "reel");
        assert_eq!(folder_name(&"x".repeat(300), None).len(), 100);
    }

    #[test]
    fn an_item_knows_its_video_and_size() {
        let i = Item {
            id: 1,
            key: "tmdb:tv:1:s1e2".into(),
            title: "Show".into(),
            label: String::new(),
            image: String::new(),
            episode: Some((1, 2)),
            dir: PathBuf::from("/films/Show"),
            infohash: Some("ab".into()),
            video: Some(3),
            files: vec![(3, "S01/Show.S01E02.mkv".into(), 1000), (4, "S01/Show.S01E02.en.srt".into(), 20)],
            state: State::Saving,
            message: None,
            added: 0,
        };
        assert_eq!(i.size(), 1020);
        assert_eq!(i.video_path(), Some(PathBuf::from("/films/Show/S01/Show.S01E02.mkv")));
        assert!(i.unfinished());
    }

    #[test]
    fn empty_folders_go_with_the_last_file() {
        let dir = std::env::temp_dir().join(format!("reel-keep-test-{}", std::process::id()));
        std::fs::create_dir_all(dir.join("a/b")).unwrap();
        std::fs::write(dir.join("a/b/x.mkv"), b"1").unwrap();
        std::fs::write(dir.join("a/y.srt"), b"1").unwrap();
        remove_file_and_empty_dirs(&dir, "a/b/x.mkv");
        assert!(!dir.join("a/b").exists());
        assert!(dir.join("a/y.srt").exists());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
