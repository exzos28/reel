//! Saved films and episodes (design/offline-downloads.md): a torrent's chosen files saved whole
//! with librqbit's filesystem storage into the user's folder, and played from there without
//! the internet.
//!
//! - Items are what the user saved: a film or an episode, by catalog key. Several items can
//!   share a torrent (episodes of a season pack): its selected files are their union.
//! - Each torrent has a folder of its own (`<folder>/<Title (year)>`, `… (2)` for a second
//!   release of the same title): librqbit opens every file of a torrent and writes the edge
//!   pieces of the chosen ones into their neighbours, so two torrents must never share paths.
//! - The library (`<data>/saved/library.json`) keeps the items, the folder and the .torrent of
//!   each infohash (`<data>/saved/torrents/`), never the source's link (it carries an API key).
//!   An entry it cannot read is kept as it is, never dropped.
//! - A torrent being saved is leased (`leases`): a stream of it reads the same files, and
//!   closing the player never deletes them. Complete, it leaves the session with its files.
//! - Files are deleted only when no other item uses the same path.
//! - Unfinished items go on when the app starts again, from their .torrent, and from the
//!   pieces librqbit verified (`<hash>.bitv` beside it, vendored librqbit's fastresume) instead
//!   of hashing the files again.

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
/// How long getting a torrent may take (the source's link, a magnet's metadata from peers)
/// before the item fails: librqbit waits for peers as long as it takes.
const FIND_FOR: Duration = Duration::from_secs(180);

/// One lock per source being opened: episodes of one pack open it one after another, so the
/// second finds the torrent the first added instead of fetching its metadata again.
static OPENING: Mutex<Option<HashMap<String, Arc<tokio::sync::Mutex<()>>>>> = Mutex::new(None);

fn opening(source: &str) -> Arc<tokio::sync::Mutex<()>> {
    OPENING.lock().unwrap().get_or_insert_with(HashMap::new).entry(source.to_owned()).or_default().clone()
}

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
    /// The title's picture (a show's, for its row).
    #[serde(default)]
    pub cover: String,
    #[serde(default)]
    pub episode: Option<(u16, u16)>,
    /// Its season's place in the show's numbering, for a pack numbered through it.
    #[serde(default)]
    pub through: Option<reel_domain::numbering::Through>,
    /// Its torrent's folder (`<folder>/<Title (year)>`; before the torrent is known, the one it
    /// would take).
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

    /// Its files on disk.
    fn paths(&self) -> impl Iterator<Item = PathBuf> + '_ {
        self.files.iter().map(|f| self.dir.join(&f.1))
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
    /// Entries this build could not read (a newer build's, a damaged one): written back as
    /// they were, so going back to that build loses nothing.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    unread: Vec<Value>,
}

/// Reads the library: an entry that does not parse is kept aside (`unread`), and a file that
/// is not JSON at all is moved aside (`library.json.unreadable-<time>`), never overwritten.
fn load(file: &Path) -> Stored {
    let Ok(bytes) = std::fs::read(file) else { return Stored::default() };
    let v: Value = match serde_json::from_slice(&bytes) {
        Ok(v) => v,
        Err(e) => {
            let aside = file.with_extension(format!("json.unreadable-{}", now()));
            tracing::warn!("reel saved: {} is not JSON ({e}): kept as {}", file.display(), aside.display());
            let _ = std::fs::rename(file, aside);
            return Stored::default();
        }
    };
    let mut stored = Stored {
        folder: v["folder"].as_str().map(PathBuf::from),
        next_id: v["next_id"].as_u64().unwrap_or(0) as u32,
        items: Vec::new(),
        unread: v["unread"].as_array().cloned().unwrap_or_default(),
    };
    for entry in v["items"].as_array().cloned().unwrap_or_default() {
        match serde_json::from_value::<Item>(entry.clone()) {
            Ok(i) => stored.items.push(i),
            Err(e) => {
                tracing::warn!("reel saved: an entry of the library is not read ({e}): kept as it is");
                stored.unread.push(entry);
            }
        }
    }
    // Ids of unread entries are never handed out again.
    let top = stored.unread.iter().filter_map(|e| e["id"].as_u64()).max().unwrap_or(0) as u32;
    stored.next_id = stored.next_id.max(top);
    stored
}

struct Library {
    /// `<data>/saved`: the library file and the .torrent files.
    home: PathBuf,
    /// Where films go while the user has chosen no folder (`default_folder`).
    films: PathBuf,
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
        self.stored.folder.clone().unwrap_or_else(|| self.films.clone())
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

    fn of<'a>(&'a self, infohash: &'a str) -> impl Iterator<Item = &'a Item> + 'a {
        self.stored.items.iter().filter(move |i| i.infohash.as_deref() == Some(infohash))
    }

    /// The files librqbit downloads of `infohash`: those of its items not failed and not paused
    /// (one episode of a pack pauses alone: its files are left out).
    fn wanted(&self, infohash: &str) -> HashSet<usize> {
        self.of(infohash).filter(|i| !matches!(i.state, State::Failed | State::Paused)).flat_map(|i| i.indexes().collect::<Vec<_>>()).collect()
    }

    /// Every file some item uses, on disk.
    fn used_paths(&self) -> HashSet<PathBuf> {
        self.stored.items.iter().flat_map(|i| i.paths().collect::<Vec<_>>()).collect()
    }

    /// The folder for torrent `infohash`: the one its items have, else `base` or the first of
    /// `base (2)`, `base (3)`… that no other torrent uses and that is not a folder with files
    /// in it already.
    fn dir_for(&self, infohash: &str, base: &Path) -> PathBuf {
        if let Some(i) = self.of(infohash).find(|i| !i.files.is_empty()) {
            return i.dir.clone();
        }
        for n in 1.. {
            let dir = if n == 1 { base.to_owned() } else { PathBuf::from(format!("{} ({n})", base.display())) };
            let taken = self.stored.items.iter().any(|i| i.dir == dir && i.infohash.is_some() && i.infohash.as_deref() != Some(infohash) && !i.files.is_empty());
            let full = std::fs::read_dir(&dir).is_ok_and(|mut d| d.next().is_some());
            if !taken && !full {
                return dir;
            }
        }
        unreachable!()
    }
}

/// The longest folder name `folder_name` makes, in characters.
const NAME_MAX: usize = 100;

/// A folder name from a title, the same on every system and one Windows takes too: no
/// characters a file system refuses, no dot or space at the ends (Windows drops them, so the
/// folder would not be found by its name), no device name of Windows (`CON`, `NUL`, `COM1`…,
/// also before an extension: `CON.x`), at most 100 characters with the year.
pub fn folder_name(title: &str, year: Option<u32>) -> String {
    let clean: String = title
        .chars()
        .map(|c| if c.is_control() || r#"/\:*?"<>|"#.contains(c) { ' ' } else { c })
        .collect();
    let clean = clean.split_whitespace().collect::<Vec<_>>().join(" ");
    let year = year.map(|y| format!(" ({y})")).unwrap_or_default();
    let room = NAME_MAX - year.chars().count();
    let clean: String = clean.trim_matches(['.', ' ']).chars().take(room).collect();
    let clean = clean.trim_end_matches(['.', ' ']);
    let name = if clean.is_empty() { format!("reel{year}") } else { format!("{clean}{year}") };
    let name: String = not_a_device(&name).chars().take(NAME_MAX).collect();
    name.trim_end_matches(['.', ' ']).to_owned()
}

/// `name` with a `_` after its stem when Windows reads it as a device (`CON` → `CON_`,
/// `nul.txt` → `nul_.txt`): the part before its first dot, spaces at the end dropped, is `CON`,
/// `PRN`, `AUX`, `NUL`, `COM0`–`COM9` or `LPT0`–`LPT9` (or `¹ ² ³` for the digit), in any case.
fn not_a_device(name: &str) -> String {
    let stem_len = name.find('.').unwrap_or(name.len());
    let stem = name[..stem_len].trim_end_matches(' ').to_ascii_uppercase();
    let mut chars = stem.chars();
    let head: String = chars.by_ref().take(3).collect();
    let tail: Vec<char> = chars.collect();
    let device = match (head.as_str(), tail.as_slice()) {
        ("CON" | "PRN" | "AUX" | "NUL", []) => true,
        ("COM" | "LPT", [d]) => d.is_ascii_digit() || "¹²³".contains(*d),
        _ => false,
    };
    if device { format!("{}_{}", &name[..stem_len], &name[stem_len..]) } else { name.to_owned() }
}

/// The longest path Windows opens without its long-path prefix (`MAX_PATH`: 260 UTF-16 units
/// with the closing NUL). Rust's `std::fs`, and so librqbit, which writes the files with it,
/// adds `\\?\` to longer paths itself (`sys::path::windows::maybe_verbatim`), but mpv opens the
/// video with `_wopen` as it is and reel's executable does not declare `longPathAware`: a
/// longer path would save and never play.
const WINDOWS_MAX_PATH: usize = 259;

/// Whether Windows opens `path` without the long-path prefix (checked on every system in tests).
fn fits_windows(path: &Path) -> bool {
    path.to_string_lossy().encode_utf16().count() <= WINDOWS_MAX_PATH
}

/// Where films go while the user has chosen no folder: the library's own (`<data>/saved`),
/// except on Windows (`local`: `%LOCALAPPDATA%`), where NSH's data dir is the roaming
/// `%APPDATA%`, copied to every computer the user signs in to: films go to
/// `%LOCALAPPDATA%\reel\saved` there (unset or empty: the library's). The library itself
/// (`library.json`, the .torrent files) stays in the data dir: it is small, the settings are
/// there too, and each item keeps its folder in full, so it finds its files wherever they are.
/// iOS backs the app's data up to iCloud: saved films (gigabytes, back from the swarm any time)
/// are left out, as `NSURLIsExcludedFromBackupKey` marks them (this attribute is what it sets).
#[cfg(target_os = "ios")]
fn exclude_from_backup(dir: &Path) {
    use std::os::unix::ffi::OsStrExt;
    let Ok(path) = std::ffi::CString::new(dir.as_os_str().as_bytes()) else { return };
    let value = b"com.apple.backupd";
    let r = unsafe {
        libc::setxattr(path.as_ptr(), c"com.apple.metadata:com_apple_backup_excludeItem".as_ptr(), value.as_ptr().cast(), value.len(), 0, 0)
    };
    if r != 0 {
        engine::log_line(&format!("saved: not left out of the backup: {}", std::io::Error::last_os_error()));
    }
}

#[cfg(not(target_os = "ios"))]
fn exclude_from_backup(_dir: &Path) {}

/// `dir` (an item's folder) when it is gone, but was in a library home of the same name as `home`
/// (`…/<old container>/…/saved/<Title (year)>`): the same folder under `home`, if it is there.
fn moved_folder(dir: &Path, home: &Path) -> Option<PathBuf> {
    if dir.as_os_str().is_empty() || dir.exists() {
        return None;
    }
    let name = dir.file_name()?;
    if dir.parent()?.file_name()? != home.file_name()? {
        return None;
    }
    let here = home.join(name);
    here.exists().then_some(here)
}

fn default_folder(home: &Path, local: Option<std::ffi::OsString>) -> PathBuf {
    match local.filter(|l| !l.is_empty()) {
        Some(local) => PathBuf::from(local).join("reel").join("saved"),
        None => home.to_owned(),
    }
}

/// Deletes the files at `paths` (each under `dir`) and the folders above them, up to `dir`,
/// left empty; a path outside `dir`, or an empty `dir`, is never touched.
fn delete_files(dir: &Path, paths: impl IntoIterator<Item = PathBuf>) {
    if dir.as_os_str().is_empty() || !dir.is_absolute() {
        return;
    }
    for path in paths {
        if !path.starts_with(dir) || path.components().any(|c| matches!(c, std::path::Component::ParentDir)) {
            continue;
        }
        let _ = std::fs::remove_file(&path);
        let mut parent = path.parent();
        while let Some(p) = parent {
            if !p.starts_with(dir) || std::fs::remove_dir(p).is_err() {
                break;
            }
            parent = p.parent();
        }
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
    exclude_from_backup(&home);
    let stored = load(&home.join("library.json"));
    let films = default_folder(&home, if cfg!(windows) { std::env::var_os("LOCALAPPDATA") } else { None });
    let mut lib = Library { home, films, stored, live: HashMap::new(), revision: 1 };
    // iOS moves an app's data to a new container path when the app is installed again or
    // updated: an item's folder stored under the old one is the same folder under the new one.
    for item in lib.stored.items.iter_mut() {
        if let Some(moved) = moved_folder(&item.dir, &lib.home) {
            item.dir = moved;
        }
    }
    // Without its link (never stored) an item that had no torrent yet cannot go on.
    for item in lib.stored.items.iter_mut() {
        if item.infohash.is_none() && item.unfinished() || item.state == State::Waiting {
            item.state = State::Failed;
            item.message = Some("interrupted".into());
        }
    }
    let mut hashes: Vec<String> = lib.stored.items.iter().filter(|i| i.unfinished()).filter_map(|i| i.infohash.clone()).collect();
    hashes.sort();
    hashes.dedup();
    let resume: Vec<_> = hashes
        .into_iter()
        .map(|h| {
            let paused = lib.wanted(&h).is_empty();
            let dir = lib.of(&h).find(|i| i.unfinished()).map(|i| i.dir.clone()).unwrap_or_default();
            (lib.torrent_file(&h), lib.wanted(&h), h, dir, paused)
        })
        .collect();
    *guard = Some(lib);
    drop(guard);
    if !resume.is_empty() {
        let Ok(core) = engine::core() else { return };
        for (file, wanted, hash, dir, paused) in resume {
            let Ok(bytes) = std::fs::read(&file) else {
                fail_torrent(&hash, "interrupted");
                continue;
            };
            let fastresume = file.parent().map(Path::to_path_buf);
            core.rt.spawn(async move {
                let options = AddTorrentOptions {
                    overwrite: true,
                    paused,
                    fastresume_folder: fastresume,
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
    // The engine first: an item is only written down once something can save it.
    let core = engine::core().map_err(|e| format!("{e:#}"))?;
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
            cover: req.cover.clone(),
            episode: req.episode,
            through: req.through,
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

/// The torrent `tid` (`infohash`) was added for an item that will not save it (it failed, or
/// was removed meanwhile): unless another item saves it, it leaves the session, and what it
/// wrote goes (its folder is its own; files other items use stay).
fn let_go(tid: usize, infohash: &str, handle: &ManagedTorrent) {
    let Some(Some((dir, paths))) = with(|lib| {
        if lib.live.contains_key(infohash) || lib.of(infohash).any(|i| i.state != State::Failed) {
            return None;
        }
        let dir = lib.of(infohash).map(|i| i.dir.clone()).next()?;
        let used = lib.used_paths();
        let all: Vec<PathBuf> = handle
            .with_metadata(|m| m.file_infos.iter().map(|f| dir.join(&f.relative_filename)).collect())
            .unwrap_or_default();
        Some((dir, all.into_iter().filter(|p| !used.contains(p)).collect::<Vec<_>>()))
    }) else {
        return;
    };
    let release = leases::with(|l| l.release_keep(tid, true));
    if let Ok(core) = engine::core() {
        engine::apply_release(core, tid, release);
    }
    delete_files(&dir, paths);
}

/// What the item's source is, as librqbit takes it, and its infohash when it can be read
/// before the torrent is added (a .torrent's, a magnet's).
async fn open_source(source: &str) -> Result<(AddTorrent<'static>, Option<String>), String> {
    let magnet = |m: &str| {
        let hash = librqbit_core::magnet::Magnet::parse(m).ok().and_then(|x| x.as_id20()).map(|h| h.as_string());
        (AddTorrent::from_url(engine::with_open_trackers(m)), hash)
    };
    if source.starts_with("http://") || source.starts_with("https://") {
        match engine::fetch_once(source).await {
            Ok(Fetched::Torrent(bytes)) => {
                let hash = librqbit_core::torrent_metainfo::torrent_from_bytes(&bytes).ok().map(|t| t.info_hash.as_string());
                Ok((AddTorrent::from_bytes(bytes), hash))
            }
            Ok(Fetched::Magnet(m)) => Ok(magnet(&m)),
            Err(e) => Err(redact(&e)),
        }
    } else {
        Ok(magnet(source))
    }
}

/// Adds the item's torrent (or finds it in the session) into the torrent's own folder, and
/// selects its files.
async fn resolve(id: u32, source: String) {
    let Some((base, ep, through)) = with(|lib| lib.item_mut(id).map(|i| (i.dir.clone(), i.episode, i.through))).flatten() else { return };
    let Ok(core) = engine::core() else { return };
    let started = std::time::Instant::now();
    let step = |what: &str| engine::log_line(&format!("saved {id} +{} ms {what}", started.elapsed().as_millis()));
    let lock = opening(&source);
    let _opening = lock.lock().await;
    step("opening the source");
    let (add, known) = match open_source(&source).await {
        Ok(x) => x,
        Err(e) => {
            step(&format!("the source failed: {e}"));
            return set_failed(id, &e);
        }
    };
    step(if known.is_some() { "source opened, infohash known" } else { "source opened" });
    // The torrent's folder, from its infohash when known now (a torrent saved already keeps
    // its own); a magnet that does not say gets one by its title.
    let Some(dir) = with(|lib| {
        let dir = known.as_deref().map_or_else(|| base.clone(), |h| lib.dir_for(h, &base));
        if let Some(i) = lib.item_mut(id) {
            i.dir = dir.clone();
        }
        dir
    }) else {
        return;
    };
    let options = AddTorrentOptions {
        overwrite: true,
        // Nothing until the item's files are known (below).
        only_files: Some(Vec::new()),
        output_folder: Some(dir.to_string_lossy().into_owned()),
        fastresume_folder: with(|lib| lib.home.join("torrents")),
        ..Default::default()
    };
    // Another episode of the same pack saves it already: take that torrent as it is. Adding a
    // magnet again would fetch its metadata from peers first (seconds each, episode after
    // episode) before librqbit says it has it.
    let saving = known.as_deref().and_then(|h| with(|lib| lib.live.get(h).cloned()).flatten());
    let added = if let Some((tid, handle)) = saving {
        Ok(Ok(AddTorrentResponse::AlreadyManaged(tid, handle)))
    } else {
        tokio::time::timeout(FIND_FOR, core.session.add_torrent(add, Some(options))).await
    };
    let added = match added {
        Ok(r) => r,
        // Nobody gave the torrent's metadata in time: no one shares it now.
        Err(_) => {
            step("no metadata in time");
            return set_failed(id, "no_peers");
        }
    };
    step("torrent added");
    let (tid, handle) = match added {
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
                drop(_opening);
                return Box::pin(resolve(id, source)).await;
            }
            (tid, handle)
        }
        Ok(AddTorrentResponse::ListOnly(_)) => return set_failed(id, "the torrent was only listed"),
        Err(e) => return set_failed(id, &redact(&format!("{e:#}"))),
    };
    let hash = handle.info_hash().as_string();
    // Whatever goes wrong from here: the item fails and the torrent is let go of.
    let fail = |message: &str| {
        set_failed(id, message);
        let_go(tid, &hash, &handle);
    };
    let all: Vec<(usize, String, u64)> = match handle.with_metadata(|m| {
        m.file_infos.iter().enumerate().map(|(i, f)| (i, f.relative_filename.to_string_lossy().into_owned(), f.len)).collect()
    }) {
        Ok(all) => all,
        Err(e) => return fail(&format!("{e:#}")),
    };
    let Some(video) = episode::pick(&all, ep, through) else {
        return fail(if ep.is_some() { "not_in_release" } else { "no_video" });
    };
    if compat::file_ok(&all[video].1, compat::profile()).is_err() {
        return fail("unsupported");
    }
    let mut mine = vec![all[video].clone()];
    for sub in files::find(&all, video) {
        if let Some(f) = all.iter().find(|f| f.0 == sub.id) {
            mine.push(f.clone());
        }
    }
    let torrent_bytes = handle.with_metadata(|m| m.torrent_bytes.clone()).ok();
    // The torrent's folder is where librqbit writes it (a magnet's, or one added earlier).
    let written_to = handle.output_folder().to_owned();
    // A video Windows could not open for the player: said now, not once it is saved.
    if cfg!(windows) && !fits_windows(&written_to.join(&all[video].1)) {
        return fail("path_too_long");
    }
    let wanted = with(|lib| {
        // Removed while its torrent was being found.
        lib.item_mut(id)?;
        if let Some(bytes) = &torrent_bytes {
            let file = lib.torrent_file(&hash);
            if !file.exists() {
                let _ = std::fs::write(&file, bytes);
            }
        }
        let i = lib.item_mut(id)?;
        i.infohash = Some(hash.clone());
        i.dir = written_to.clone();
        i.video = Some(video);
        i.files = mine;
        i.state = State::Saving;
        i.message = None;
        lib.live.insert(hash.clone(), (tid, handle.clone()));
        let wanted = lib.wanted(&hash);
        lib.save();
        Some(wanted)
    })
    .flatten();
    let Some(wanted) = wanted else {
        return let_go(tid, &hash, &handle);
    };
    if handle.is_paused() {
        let _ = core.session.unpause(&handle).await;
    }
    // librqbit changes the files of a torrent only once it has checked them.
    let _ = handle.wait_until_initialized().await;
    if let Err(e) = core.session.update_only_files(&handle, &wanted).await {
        set_failed(id, &format!("{e:#}"));
    }
    step("files selected, saving");
}

// ---- Progress and completion -----------------------------------------------------------

/// Bytes of the item's files on disk now (of a live torrent), or None.
fn have(lib: &Library, item: &Item) -> Option<u64> {
    let (_, handle) = lib.live.get(item.infohash.as_ref()?)?;
    let stats = handle.stats();
    Some(item.files.iter().map(|f| stats.file_progress.get(f.0).copied().unwrap_or(0).min(f.2)).sum())
}

/// Why a torrent stopped with an error, as the app words it.
fn error_message(e: &str) -> &'static str {
    let e = e.to_ascii_lowercase();
    if e.contains("no space") || e.contains("os error 28") || e.contains("os error 112") { "no_space" } else { "write" }
}

/// Marks complete items saved and stopped ones failed; a torrent whose items are all done
/// leaves the session with its files, and the files of it nobody saved (written by edge
/// pieces) are deleted.
pub fn tick() {
    let finished: Vec<(usize, PathBuf, Vec<PathBuf>)> = with(|lib| {
        let mut changed = false;
        // A torrent librqbit stopped with an error (the disk is full, the drive gone).
        let broken: Vec<(String, String)> = lib.live.iter().filter_map(|(h, (_, t))| Some((h.clone(), t.stats().error?))).collect();
        for (hash, e) in broken {
            tracing::warn!("reel saved: {hash} stopped: {e}");
            for i in lib.stored.items.iter_mut().filter(|i| i.infohash.as_deref() == Some(&hash) && i.unfinished()) {
                i.state = State::Failed;
                i.message = Some(error_message(&e).to_owned());
            }
            changed = true;
        }
        let ids: Vec<u32> = lib.stored.items.iter().filter(|i| i.state == State::Saving).map(|i| i.id).collect();
        for id in ids {
            let Some(item) = lib.stored.items.iter().find(|i| i.id == id) else { continue };
            if have(lib, item).is_some_and(|h| h >= item.size()) {
                lib.item_mut(id).unwrap().state = State::Saved;
                changed = true;
            }
        }
        let mut done = Vec::new();
        let hashes: Vec<String> = lib.live.keys().cloned().collect();
        for hash in hashes {
            if lib.of(&hash).any(Item::unfinished) {
                continue;
            }
            let Some(dir) = lib.of(&hash).map(|i| i.dir.clone()).next() else { continue };
            let (tid, handle) = lib.live.remove(&hash).unwrap();
            let used = lib.used_paths();
            let unused: Vec<PathBuf> = handle
                .with_metadata(|m| m.file_infos.iter().map(|f| dir.join(&f.relative_filename)).collect::<Vec<_>>())
                .unwrap_or_default()
                .into_iter()
                .filter(|p| !used.contains(p))
                .collect();
            done.push((tid, dir, unused));
        }
        if changed || !done.is_empty() {
            lib.save();
        }
        done
    })
    .unwrap_or_default();
    for (tid, dir, unused) in finished {
        let release = leases::with(|l| l.release_keep(tid, true));
        if let Ok(core) = engine::core() {
            engine::apply_release(core, tid, release);
        }
        delete_files(&dir, unused);
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
                let stats = i.infohash.as_ref().and_then(|h| lib.live.get(h)).map(|(_, h)| h.stats());
                // Opened again, the torrent checks what is on the disk first: how much is saved
                // is not known until it is done (it says 0 meanwhile).
                let checking = matches!(stats.as_ref().map(|s| &s.state), Some(librqbit::TorrentStatsState::Initializing { .. }));
                let live = stats.and_then(|s| s.live);
                let state = if i.state == State::Saved && !i.video_path().is_some_and(|p| p.exists()) { "unavailable" } else { state_name(i.state) };
                json!({
                    "id": i.id,
                    "key": i.key,
                    "title": i.title,
                    "label": i.label,
                    "image": i.image,
                    "cover": if i.cover.is_empty() { &i.image } else { &i.cover },
                    "season": i.episode.map(|e| e.0),
                    "number": i.episode.map(|e| e.1),
                    "state": state,
                    "size": size,
                    "have": have,
                    "progress": if size > 0 { have as f64 / size as f64 } else { 0.0 },
                    "checking": checking,
                    "speed": live.as_ref().map(|l| l.download_speed.mbps),
                    "peers": live.as_ref().map(|l| l.snapshot.peer_stats.live),
                    "message": i.message,
                    "folder": i.dir,
                    // Speed and people are the torrent's (librqbit does not split them by file).
                    "torrent": i.infohash,
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

/// Whether the torrent with librqbit id `tid` is one being saved now and paused by the user:
/// a stream of it unpauses it while it plays (`engine`), and pauses it again after.
pub(crate) fn paused_by_user(tid: usize) -> bool {
    with(|lib| lib.live.iter().any(|(h, (id, _))| *id == tid && lib.of(h).filter(|i| i.unfinished()).all(|i| i.state == State::Paused))).unwrap_or(false)
}

// ---- Pausing and removing --------------------------------------------------------------

/// Pauses one item or goes on with it. An episode of a pack pauses alone: its files leave the
/// torrent's selection; the torrent itself pauses only once nothing of it is left to save.
pub fn set_running(id: u32, on: bool) {
    let Some(Some((hash, handle, wanted))) = with(|lib| {
        let item = lib.item_mut(id)?;
        match (item.state, on) {
            (State::Saving, false) => item.state = State::Paused,
            (State::Paused, true) => item.state = State::Saving,
            _ => return None,
        }
        let hash = item.infohash.clone()?;
        let (_, handle) = lib.live.get(&hash)?.clone();
        let wanted = lib.wanted(&hash);
        lib.save();
        Some((hash, handle, wanted))
    }) else {
        return;
    };
    let Ok(core) = engine::core() else { return };
    core.rt.spawn(async move {
        let r = if wanted.is_empty() {
            core.session.pause(&handle).await
        } else {
            let _ = handle.wait_until_initialized().await;
            if handle.is_paused() {
                let _ = core.session.unpause(&handle).await;
            }
            core.session.update_only_files(&handle, &wanted).await
        };
        if let Err(e) = r {
            tracing::warn!("reel saved: {} {hash}: {e:#}", if on { "resuming" } else { "pausing" });
        }
    });
}

/// What removing an item does to its torrent.
enum Rest {
    /// Not in the session (complete, or never added): only files go.
    Idle,
    /// Other items of it still save: it downloads only their files from now on.
    Narrow(Arc<ManagedTorrent>, HashSet<usize>),
    /// Nothing of it saves any more: it leaves the session.
    Release(usize),
}

pub fn remove(id: u32) {
    let Some(Some((dir, gone, rest))) = with(|lib| {
        let at = lib.stored.items.iter().position(|i| i.id == id)?;
        let item = lib.stored.items.remove(at);
        let used = lib.used_paths();
        let mut rest = Rest::Idle;
        let mut gone: Vec<PathBuf> = item.paths().collect();
        if let Some(h) = &item.infohash {
            if lib.of(h).next().is_none() {
                let _ = std::fs::remove_file(lib.torrent_file(h));
                let _ = std::fs::remove_file(lib.torrent_file(h).with_extension("bitv"));
            }
            if let Some((tid, handle)) = lib.live.get(h).cloned() {
                if lib.of(h).any(Item::unfinished) {
                    rest = Rest::Narrow(handle, lib.wanted(h));
                } else {
                    lib.live.remove(h);
                    rest = Rest::Release(tid);
                    // What it wrote and no one uses goes too (edge pieces of its other files).
                    gone.extend(handle.with_metadata(|m| m.file_infos.iter().map(|f| item.dir.join(&f.relative_filename)).collect::<Vec<_>>()).unwrap_or_default());
                }
            }
        }
        lib.save();
        // Never a file another item uses (one path, two keys; subtitles of a pack).
        let gone: Vec<PathBuf> = gone.into_iter().filter(|p| !used.contains(p)).collect();
        Some((item.dir, gone, rest))
    }) else {
        return;
    };
    let Ok(core) = engine::core() else {
        return delete_files(&dir, gone);
    };
    match rest {
        Rest::Idle => delete_files(&dir, gone),
        Rest::Narrow(handle, wanted) => {
            core.rt.spawn(async move {
                let _ = handle.wait_until_initialized().await;
                let _ = core.session.update_only_files(&handle, &wanted).await;
                delete_files(&dir, gone);
            });
        }
        Rest::Release(tid) => {
            let release = leases::with(|l| l.release_keep(tid, true));
            engine::apply_release(core, tid, release);
            core.rt.spawn(async move {
                // Let librqbit close the files before they go.
                tokio::time::sleep(Duration::from_millis(500)).await;
                delete_files(&dir, gone);
            });
        }
    }
}

#[cfg(test)]
mod moved {
    use super::moved_folder;

    #[test]
    fn a_folder_under_an_old_container_is_found_under_the_new_one() {
        let base = std::env::temp_dir().join(format!("reel-moved-{}", std::process::id()));
        let home = base.join("NEW/saved");
        std::fs::create_dir_all(home.join("Film (2026)")).unwrap();
        let old = base.join("OLD/saved/Film (2026)");
        assert_eq!(moved_folder(&old, &home), Some(home.join("Film (2026)")));
        // There still, or not a library's folder, or not under the new home: left as it is.
        assert_eq!(moved_folder(&home.join("Film (2026)"), &home), None);
        assert_eq!(moved_folder(&base.join("OLD/elsewhere/Film (2026)"), &home), None);
        assert_eq!(moved_folder(&base.join("OLD/saved/Other (1999)"), &home), None);
        let _ = std::fs::remove_dir_all(&base);
    }
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
    fn folder_names_are_ones_windows_takes() {
        // No dot or space at the end, also once cut to length.
        assert_eq!(folder_name("Se7en.", None), "Se7en");
        assert_eq!(folder_name(" Amélie . ", None), "Amélie");
        assert_eq!(folder_name(&format!("{}. b", "a".repeat(98)), None), "a".repeat(98));
        // At most 100 characters with the year, and the year kept.
        let long = folder_name(&"é".repeat(300), Some(2001));
        assert_eq!(long.chars().count(), 100);
        assert!(long.ends_with("é (2001)"), "{long}");
        assert_eq!(folder_name("...", Some(1999)), "reel (1999)");
        // Device names, in any case and before an extension, get a `_`.
        assert_eq!(folder_name("CON", None), "CON_");
        assert_eq!(folder_name("nul", None), "nul_");
        assert_eq!(folder_name("Aux.Files", None), "Aux_.Files");
        assert_eq!(folder_name("com1", None), "com1_");
        assert_eq!(folder_name("LPT9.x", None), "LPT9_.x");
        assert_eq!(folder_name("COM¹", None), "COM¹_");
        assert_eq!(folder_name("Con . Air", None), "Con _. Air");
        // Not devices.
        assert_eq!(folder_name("Con Air", Some(1997)), "Con Air (1997)");
        assert_eq!(folder_name("CON", Some(2020)), "CON (2020)");
        assert_eq!(folder_name("Console", None), "Console");
        assert_eq!(folder_name("COM10", None), "COM10");
        assert_eq!(folder_name("LPT", None), "LPT");
    }

    #[test]
    fn paths_longer_than_windows_opens_are_found() {
        let dir = PathBuf::from(r"C:\Users\me\AppData\Local\reel\saved\Film (2001)");
        assert!(fits_windows(&dir.join("Film.mkv")));
        assert!(fits_windows(Path::new(&"a".repeat(259))));
        assert!(!fits_windows(Path::new(&"a".repeat(260))));
        // UTF-16 units, not bytes: 259 Cyrillic letters fit (518 bytes).
        assert!(fits_windows(Path::new(&"ф".repeat(259))));
    }

    #[test]
    fn films_go_to_local_app_data_when_it_is_given() {
        let home = Path::new("/data/saved");
        assert_eq!(default_folder(home, Some(r"C:\Users\me\AppData\Local".into())), PathBuf::from(r"C:\Users\me\AppData\Local").join("reel").join("saved"));
        assert_eq!(default_folder(home, Some("".into())), home);
        assert_eq!(default_folder(home, None), home);
    }

    #[test]
    fn an_item_knows_its_video_and_size() {
        let i = Item {
            id: 1,
            key: "tmdb:tv:1:s1e2".into(),
            title: "Show".into(),
            label: String::new(),
            image: String::new(),
            cover: String::new(),
            episode: Some((1, 2)),
            through: None,
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

    /// Needs the network (about 130 MB): `cargo test -p reel-engine -- --ignored saves_sintel --nocapture`.
    /// Saves Sintel whole, plays it from its file, removes it.
    #[test]
    #[ignore]
    fn saves_sintel_and_plays_it_from_disk() {
        let data = std::env::temp_dir().join(format!("reel-keep-sintel-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&data);
        init(&data);
        let key = "test:sintel";
        let id = add(KeepRequest { key: key.into(), source: crate::engine::tests::SINTEL.into(), title: "Sintel".into(), year: Some(2010), ..Default::default() }).expect("added");
        let started = std::time::Instant::now();
        loop {
            std::thread::sleep(Duration::from_secs(2));
            tick();
            let items = list();
            let it = items.as_array().unwrap().iter().find(|i| i["id"] == id).unwrap().clone();
            println!("{:>4}s {} {:.0}% of {} B", started.elapsed().as_secs(), it["state"], it["progress"].as_f64().unwrap_or(0.0) * 100.0, it["size"]);
            if it["state"] == "saved" {
                break;
            }
            assert_ne!(it["state"], "failed", "{it}");
            assert!(started.elapsed() < Duration::from_secs(600), "not saved in 10 min");
        }
        let file = local_file(key).expect("a saved file");
        assert!(file.starts_with(data.join("saved").join("Sintel (2010)")), "{}", file.display());
        assert!(std::fs::metadata(&file).unwrap().len() > 100 * 1024 * 1024);
        // Plays from the file: no torrent, a file:// URL.
        let job = crate::engine::open(key).expect("opens");
        let status = crate::engine::status(job);
        assert_eq!(status["phase"], "ready");
        assert!(status["stream_url"].as_str().unwrap().starts_with("file://"), "{status}");
        crate::engine::close(job);
        // The library survives as a file; removing deletes the film.
        assert!(data.join("saved/library.json").exists());
        remove(id);
        std::thread::sleep(Duration::from_secs(2));
        assert!(!file.exists());
        let _ = std::fs::remove_dir_all(&data);
    }

    /// Needs the network: `cargo test -p reel-engine -- --ignored removing --nocapture`.
    /// Removing while the torrent is found deletes nothing outside its folder; removing
    /// mid-save leaves no file of it behind.
    #[test]
    #[ignore]
    fn removing_early_or_mid_save_leaves_nothing_and_touches_nothing_else() {
        let data = std::env::temp_dir().join(format!("reel-keep-remove-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&data);
        init(&data);
        // Files named as Sintel's in the working directory: an item with no folder once
        // deleted these.
        let decoy = PathBuf::from("Sintel.mp4");
        std::fs::write(&decoy, b"keep me").unwrap();
        let sintel = || KeepRequest { key: "test:sintel".into(), source: crate::engine::tests::SINTEL.into(), title: "Sintel".into(), year: Some(2010), ..Default::default() };
        let early = add(sintel()).unwrap();
        remove(early);
        std::thread::sleep(Duration::from_secs(8));
        tick();
        assert!(decoy.exists(), "a file outside the folder was deleted");
        let _ = std::fs::remove_file(&decoy);
        // Mid-save.
        let id = add(sintel()).unwrap();
        let started = std::time::Instant::now();
        let dir = loop {
            std::thread::sleep(Duration::from_millis(300));
            let items = list();
            let it = items.as_array().unwrap().iter().find(|i| i["id"] == id).unwrap().clone();
            if it["have"].as_u64().unwrap_or(0) > 0 {
                break PathBuf::from(it["folder"].as_str().unwrap());
            }
            assert!(started.elapsed() < Duration::from_secs(300), "never started");
        };
        remove(id);
        std::thread::sleep(Duration::from_secs(3));
        assert!(!dir.exists() || std::fs::read_dir(&dir).unwrap().next().is_none(), "files of it stayed in {}", dir.display());
        let _ = std::fs::remove_dir_all(&data);
    }

    #[test]
    fn empty_folders_go_with_the_last_file() {
        let dir = std::env::temp_dir().join(format!("reel-keep-test-{}", std::process::id()));
        std::fs::create_dir_all(dir.join("a/b")).unwrap();
        std::fs::write(dir.join("a/b/x.mkv"), b"1").unwrap();
        std::fs::write(dir.join("a/y.srt"), b"1").unwrap();
        delete_files(&dir, [dir.join("a/b/x.mkv")]);
        assert!(!dir.join("a/b").exists());
        assert!(dir.join("a/y.srt").exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn nothing_outside_the_folder_or_without_one_is_deleted() {
        let dir = std::env::temp_dir().join(format!("reel-keep-guard-{}", std::process::id()));
        let outside = std::env::temp_dir().join(format!("reel-keep-outside-{}.txt", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(&outside, b"1").unwrap();
        std::fs::write("reel-keep-relative-probe.txt", b"1").unwrap();
        // An empty folder (an item that never got one) deletes nothing, not even relative paths.
        delete_files(Path::new(""), [PathBuf::from("reel-keep-relative-probe.txt")]);
        assert!(Path::new("reel-keep-relative-probe.txt").exists());
        delete_files(&dir, [outside.clone(), dir.join("../x")]);
        assert!(outside.exists());
        let _ = std::fs::remove_file("reel-keep-relative-probe.txt");
        let _ = std::fs::remove_file(&outside);
        let _ = std::fs::remove_dir_all(&dir);
    }

    fn item(id: u32, key: &str, hash: &str, dir: &str, files: &[&str]) -> Item {
        Item {
            id,
            key: key.into(),
            title: "T".into(),
            label: String::new(),
            image: String::new(),
            cover: String::new(),
            episode: None,
            through: None,
            dir: PathBuf::from(dir),
            infohash: Some(hash.into()),
            video: Some(0),
            files: files.iter().enumerate().map(|(i, f)| (i, (*f).to_owned(), 1)).collect(),
            state: State::Saved,
            message: None,
            added: 0,
        }
    }

    #[test]
    fn a_second_release_of_a_title_gets_a_folder_of_its_own() {
        let home = std::env::temp_dir().join(format!("reel-keep-dirs-{}", std::process::id()));
        let base = home.join("Film (1999)");
        let lib = Library {
            home: home.clone(),
            films: home.clone(),
            stored: Stored { items: vec![item(1, "k", "aa", &base.to_string_lossy(), &["f.mkv"])], ..Default::default() },
            live: HashMap::new(),
            revision: 0,
        };
        assert_eq!(lib.dir_for("aa", &base), base, "the same torrent keeps its folder");
        assert_eq!(lib.dir_for("bb", &base), PathBuf::from(format!("{} (2)", base.display())));
        // A folder with files in it that the library does not know is not written into either.
        let other = home.join("Other (2001)");
        std::fs::create_dir_all(&other).unwrap();
        std::fs::write(other.join("x.mkv"), b"1").unwrap();
        assert_eq!(lib.dir_for("cc", &other), PathBuf::from(format!("{} (2)", other.display())));
        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn an_entry_that_does_not_read_is_kept_not_dropped() {
        let dir = std::env::temp_dir().join(format!("reel-keep-load-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("library.json");
        let good = serde_json::to_value(item(3, "k", "aa", "/x", &["a.mkv"])).unwrap();
        let mut odd = good.clone();
        odd["id"] = json!(9);
        odd["state"] = json!("saved_v2");
        std::fs::write(&file, serde_json::to_vec(&json!({ "next_id": 3, "items": [good, odd] })).unwrap()).unwrap();
        let s = load(&file);
        assert_eq!(s.items.len(), 1);
        assert_eq!(s.unread.len(), 1);
        assert_eq!(s.next_id, 9, "an unread entry's id is not handed out again");
        // Written back, the unread entry is still there.
        assert!(serde_json::to_value(&s).unwrap()["unread"][0]["state"] == "saved_v2");
        // Not JSON at all: moved aside, not overwritten.
        std::fs::write(&file, b"{ not json").unwrap();
        assert!(load(&file).items.is_empty());
        assert!(!file.exists());
        assert!(std::fs::read_dir(&dir).unwrap().any(|e| e.unwrap().file_name().to_string_lossy().contains("unreadable")));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_path_two_items_use_is_never_deleted_with_one() {
        let lib = Library {
            home: PathBuf::from("/h"),
            films: PathBuf::from("/h"),
            stored: Stored { items: vec![item(1, "a", "aa", "/f/T", &["x.mkv", "x.srt"]), item(2, "b", "aa", "/f/T", &["y.mkv", "x.srt"])], ..Default::default() },
            live: HashMap::new(),
            revision: 0,
        };
        let used = lib.used_paths();
        assert!(used.contains(Path::new("/f/T/x.srt")));
        assert_eq!(used.len(), 3);
    }
}
