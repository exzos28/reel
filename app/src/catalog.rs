//! The catalog the UI shows, made from the metadata layer (`metadata`, the
//! `Meta` module): TMDB films and series, AniList anime. Releases come from
//! the user's own search source (`sources`), where they stopped from
//! `progress`. Here are the data and the decisions on it (which release
//! plays, how fast each starts, what is left to watch, what plays next); the
//! UI's words for it live in `locales/`.
//!
//! **Sync calls on async data.** The UI reads the catalog synchronously
//! (`Catalog.home()` returns the JSON), while `Meta` answers with Promises.
//! So the catalog keeps the last answer of each `Meta` call in memory and
//! returns that; a call it has no answer for yet is started on the
//! catalog's own runtime (the first one waits a moment, so what the SQLite
//! cache holds shows on the first paint). When an answer lands, when `Meta`
//! refreshed something (`metadata::revision`), when a search finishes or
//! progress is saved, `revision()` goes up and the UI reads again.
//!
//! Ids are the metadata ones ("tmdb:movie:603", "tmdb:tv:1399",
//! "anilist:21"); an episode is `<title>:s<season>e<episode>`
//! ("tmdb:tv:1399:s1e2"), which is also what the player plays and reports.

use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Condvar, LazyLock, Mutex, OnceLock};
use std::time::{Duration, Instant};

use nsh_core::prelude::*;
use serde_json::{Value, json};

use crate::{metadata, progress, settings, sources};

mod details;

// ---- Ids.

/// What plays: a title, or an episode of one.
pub fn episode_key(show: &str, season: u32, episode: u32) -> String {
    format!("{show}:s{season}e{episode}")
}

/// `tmdb:tv:1399:s1e2` → ("tmdb:tv:1399", Some((1, 2))); a title id → (id, None).
pub fn parse_key(key: &str) -> (&str, Option<(u32, u32)>) {
    if let Some((show, ep)) = key.rsplit_once(':')
        && let Some(rest) = ep.strip_prefix('s')
        && let Some((s, e)) = rest.split_once('e')
        && let (Ok(s), Ok(e)) = (s.parse(), e.parse())
    {
        return (show, Some((s, e)));
    }
    (key, None)
}

// ---- Meta answers, kept in memory for the sync calls.

#[derive(Clone, Debug, PartialEq)]
enum Call {
    /// A `Meta.trending` kind: "movie", "tv", "movie-popular", "tv-popular", "anime", "anime-popular".
    Trending(&'static str),
    Title(String),
    Season(String, u32),
}

impl Call {
    fn key(&self) -> String {
        match self {
            Call::Trending(k) => format!("trending/{k}"),
            Call::Title(id) => format!("title/{id}"),
            Call::Season(id, n) => format!("season/{id}/{n}"),
        }
    }
}

#[derive(Default)]
struct Slot {
    /// The envelope's `data` (the last one that had data).
    data: Option<Value>,
    /// Answered at least once.
    loaded: bool,
    loading: bool,
    /// `metadata::revision()` when it was asked: newer data may be there after.
    meta_rev: u64,
    /// When the last answer had no data: retried after a while.
    failed_at: Option<Instant>,
}

/// Waiting for a first answer on the UI thread, at most.
const FIRST_WAIT: Duration = Duration::from_millis(1500);
/// A call that failed is asked again after this.
const RETRY: Duration = Duration::from_secs(30);

static SLOTS: LazyLock<(Mutex<HashMap<String, Slot>>, Condvar)> = LazyLock::new(Default::default);
/// Goes up with every change the UI should read again for.
static REV: AtomicU64 = AtomicU64::new(0);

fn bump() {
    REV.fetch_add(1, Ordering::Relaxed);
}

/// The content language changed: everything asked so far was in the old one.
pub fn language_changed() {
    SLOTS.0.lock().unwrap().clear();
    SEARCHES.lock().unwrap().clear();
    bump();
}

/// What the UI polls: changes of the catalog's own and of `Meta`.
pub fn revision() -> u64 {
    REV.load(Ordering::Relaxed) + metadata::revision()
}

fn runtime() -> &'static tokio::runtime::Runtime {
    static RT: OnceLock<tokio::runtime::Runtime> = OnceLock::new();
    RT.get_or_init(|| {
        tokio::runtime::Builder::new_multi_thread()
            .worker_threads(1)
            .enable_all()
            .thread_name("reel-catalog")
            .build()
            .expect("the catalog runtime starts")
    })
}

static DATA_DIR: Mutex<Option<std::path::PathBuf>> = Mutex::new(None);
static META_STARTED: AtomicBool = AtomicBool::new(false);

/// The app's data directory (from `Settings.load`): progress is read from
/// it, and the metadata cache opens there (now, or with the first call).
pub fn init(data_dir: Option<&std::path::Path>) {
    *DATA_DIR.lock().unwrap() = data_dir.map(ToOwned::to_owned);
    progress::init(data_dir);
    if META_STARTED.load(Ordering::Acquire) && data_dir.is_some() {
        metadata::init(data_dir);
    }
    bump();
}

/// Opens the metadata cache once, before the first `Meta` call.
fn start_meta() {
    if !META_STARTED.swap(true, Ordering::AcqRel) {
        let dir = DATA_DIR.lock().unwrap().clone();
        metadata::init(dir.as_deref());
    }
}

/// The data of `call` as far as known. Starts asking when there is no
/// answer yet, when `Meta` has refreshed something since, or a while after a failure.
fn meta(call: &Call) -> Option<Value> {
    let rev = metadata::revision();
    let mut slots = SLOTS.0.lock().unwrap();
    let slot = slots.entry(call.key()).or_default();
    let due = !slot.loading
        && (!slot.loaded || slot.meta_rev < rev || slot.failed_at.is_some_and(|t| t.elapsed() > RETRY));
    if due {
        slot.loading = true;
        ask(call.clone(), rev);
    }
    slot.data.clone()
}

/// What is known of `call`, without asking.
fn peek(call: &Call) -> Option<Value> {
    SLOTS.0.lock().unwrap().get(&call.key()).and_then(|s| s.data.clone())
}

/// Whether `call` has been answered (with data or not).
fn answered(call: &Call) -> bool {
    SLOTS.0.lock().unwrap().get(&call.key()).is_some_and(|s| s.loaded)
}

/// `meta` for several calls; the ones never answered get up to
/// `FIRST_WAIT` together (a cache hit takes milliseconds).
fn meta_all(calls: &[Call]) -> Vec<Option<Value>> {
    let first: Vec<String> = calls.iter().filter(|c| !answered(c)).map(Call::key).collect();
    let mut out: Vec<Option<Value>> = calls.iter().map(meta).collect();
    if !first.is_empty() && cfg!(not(test)) {
        let deadline = Instant::now() + FIRST_WAIT;
        let (lock, cv) = &*SLOTS;
        let mut slots = lock.lock().unwrap();
        while first.iter().any(|k| slots.get(k).is_some_and(|s| !s.loaded)) {
            let left = deadline.saturating_duration_since(Instant::now());
            if left.is_zero() {
                break;
            }
            slots = cv.wait_timeout(slots, left).unwrap().0;
        }
        drop(slots);
        out = calls.iter().map(peek).collect();
    }
    out
}

#[cfg(not(test))]
fn ask(call: Call, rev: u64) {
    start_meta();
    runtime().spawn(async move {
        let lang = settings::content_language();
        let text = match &call {
            Call::Trending(kind) => metadata::trending(kind.to_string(), lang).await,
            Call::Title(id) => metadata::title(id.clone(), lang).await,
            Call::Season(id, n) => metadata::season(id.clone(), *n, lang).await,
        };
        let envelope: Value = serde_json::from_str(&text).unwrap_or(Value::Null);
        if !envelope["error"].is_null() {
            eprintln!("reel catalog: {}: {}", call.key(), envelope["error"]);
        }
        land(&call, &envelope, rev);
    });
}

/// Tests answer by `seed`; nothing goes to the network.
#[cfg(test)]
fn ask(_call: Call, _rev: u64) {
    let _ = (runtime, start_meta);
}

/// Stores an answer (`{"data",…}` as `Meta` resolves it).
fn land(call: &Call, envelope: &Value, rev: u64) {
    let data = Some(&envelope["data"]).filter(|d| !d.is_null()).cloned();
    let (lock, cv) = &*SLOTS;
    let changed = {
        let mut slots = lock.lock().unwrap();
        let slot = slots.entry(call.key()).or_default();
        let changed = !slot.loaded || (data.is_some() && slot.data != data);
        slot.failed_at = if data.is_none() { Some(Instant::now()) } else { None };
        if data.is_some() {
            slot.data = data;
        }
        slot.loaded = true;
        slot.loading = false;
        slot.meta_rev = rev;
        changed
    };
    cv.notify_all();
    if changed {
        bump();
    }
}

/// Whether TMDB can be asked (a key, the project's or the user's).
fn tmdb_on() -> bool {
    #[cfg(test)]
    if let Some(on) = *TEST_TMDB.lock().unwrap() {
        return on;
    }
    metadata::status()["tmdb"]["configured"].as_bool().unwrap_or(false)
}

// ---- Reading the metadata model (`metadata::model`, camelCase JSON).

fn text(v: &Value) -> Option<String> {
    v.as_str().filter(|s| !s.is_empty()).map(str::to_owned)
}

/// The URL of the smallest size at least `width` wide, else the largest.
fn image_url(image: &Value, width: u32) -> Option<String> {
    let variants = image["variants"].as_array()?;
    variants
        .iter()
        .find(|v| v["width"].as_u64().is_none_or(|w| w >= width as u64))
        .or(variants.last())
        .and_then(|v| text(&v["url"]))
}

/// The score shown: TMDB's, else AniList's (out of 100), else MAL's; "7.9" and votes.
fn rating(ratings: &Value) -> (String, String) {
    let list = ratings.as_array().map(Vec::as_slice).unwrap_or_default();
    for source in ["tmdb", "anilist", "mal"] {
        if let Some(r) = list.iter().find(|r| r["source"] == source) {
            let value = r["value"].as_f64().unwrap_or(0.0);
            let scale = r["scale"].as_f64().unwrap_or(10.0);
            if value <= 0.0 {
                continue;
            }
            let ten = value * 10.0 / scale;
            return (format!("{ten:.1}"), r["votes"].as_u64().map(votes).unwrap_or_default());
        }
    }
    (String::new(), String::new())
}

/// 950, 6.4K, 82K, 1.2M
fn votes(n: u64) -> String {
    match n {
        0..1_000 => n.to_string(),
        1_000..10_000 => format!("{:.1}K", n as f64 / 1_000.0),
        10_000..1_000_000 => format!("{}K", (n as f64 / 1_000.0).round()),
        _ => format!("{:.1}M", n as f64 / 1_000_000.0),
    }
}

fn year(date: &Value) -> Option<u16> {
    date.as_str()?.get(..4)?.parse().ok()
}

/// "2024-11-20" → [2024, 11, 20].
fn ymd(date: &Value) -> Option<[u32; 3]> {
    let mut it = date.as_str()?.splitn(3, '-').map(|p| p.parse::<u32>().ok());
    Some([it.next()??, it.next()??, it.next()??])
}

/// What the catalog needs of a title, from a card or a full title.
#[derive(Clone, Debug, Default)]
struct Info {
    id: String,
    show: bool,
    title: String,
    about: String,
    original_title: Option<String>,
    year: Option<u16>,
    year_end: Option<u16>,
    minutes: u32,
    rating: String,
    votes: String,
    genres: Vec<String>,
    still: Option<String>,
    card: Option<String>,
    poster: Option<String>,
    paper: Option<String>,
    /// Regular seasons: (number, year, episodes, name).
    seasons: Vec<(u32, Option<u16>, u32, Option<String>)>,
    season_count: u32,
    airs: Option<[u32; 4]>,
    anime: bool,
    imdb: Option<String>,
    /// The model's scores and age ratings, as they came.
    ratings: Value,
    certifications: Value,
}

/// Backdrop sizes: the hero's and a 16:9 card's; posters (2:3).
const STILL_W: u32 = 1280;
const CARD_W: u32 = 780;
const POSTER_W: u32 = 342;
const THUMB_W: u32 = 300;

fn images(info: &mut Info, v: &Value) {
    info.still = image_url(&v["backdrop"], STILL_W);
    info.card = image_url(&v["backdrop"], CARD_W);
    info.poster = image_url(&v["poster"], POSTER_W);
    info.paper = text(&v["poster"]["color"]).or_else(|| text(&v["backdrop"]["color"]));
}

/// A `TitleCard` (shelves, search).
fn from_card(card: &Value) -> Info {
    let (rating, votes) = rating(&card["ratings"]);
    let mut info = Info {
        id: text(&card["id"]).unwrap_or_default(),
        show: card["kind"] == "series",
        title: text(&card["title"]).unwrap_or_default(),
        about: text(&card["overview"]).unwrap_or_default(),
        original_title: text(&card["originalTitle"]),
        year: card["year"].as_u64().map(|y| y as u16),
        rating,
        votes,
        anime: card["anime"].as_bool().unwrap_or(false),
        ratings: card["ratings"].clone(),
        ..Default::default()
    };
    images(&mut info, card);
    info
}

/// A full `Title` (the title screen).
fn from_title(t: &Value) -> Info {
    let (rating, votes) = rating(&t["ratings"]);
    let show = t["kind"] == "series";
    let first = year(&t["release"]["date"]).or(t["release"]["year"].as_u64().map(|y| y as u16));
    let last = year(&t["release"]["lastDate"]);
    let ended = matches!(t["status"].as_str(), Some("ended" | "canceled"));
    let mut seasons: Vec<_> = t["seasons"]
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or_default()
        .iter()
        .filter_map(|s| {
            let n = s["number"].as_u64()? as u32;
            (n >= 1).then(|| (n, year(&s["airDate"]), s["episodeCount"].as_u64().unwrap_or(0) as u32, text(&s["name"])))
        })
        .collect();
    seasons.sort_by_key(|s| s.0);
    let next = &t["nextEpisode"];
    let airs = match (next["season"].as_u64(), next["number"].as_u64(), ymd(&next["airDate"])) {
        (Some(s), Some(e), Some([_, m, d])) => Some([s as u32, e as u32, m, d]),
        _ => None,
    };
    let mut info = Info {
        id: text(&t["id"]).unwrap_or_default(),
        show,
        title: text(&t["title"]).unwrap_or_default(),
        about: text(&t["overview"]).unwrap_or_default(),
        original_title: text(&t["originalTitle"]),
        year: first,
        year_end: if show && ended { last.filter(|l| Some(*l) != first) } else { None },
        minutes: t["runtimeMinutes"].as_u64().unwrap_or(0) as u32,
        rating,
        votes,
        genres: t["genres"]
            .as_array()
            .map(Vec::as_slice)
            .unwrap_or_default()
            .iter()
            .filter_map(|g| text(&g["name"]))
            .collect(),
        season_count: t["seasonCount"].as_u64().map(|n| n as u32).unwrap_or(seasons.len() as u32),
        seasons,
        airs,
        anime: !t["anime"].is_null(),
        imdb: text(&t["ids"]["imdb"]),
        ratings: t["ratings"].clone(),
        certifications: t["certifications"].clone(),
        ..Default::default()
    };
    images(&mut info, t);
    info
}

/// A card with what its full title adds, when the catalog has it already.
fn card_info(card: &Value) -> Info {
    let info = from_card(card);
    match peek(&Call::Title(info.id.clone())) {
        Some(t) => Info { id: info.id.clone(), ..from_title(&t) },
        None => info,
    }
}

// ---- Releases: the user's search, which plays, how fast each starts.

/// A search for what plays (a film or an episode), while the app runs.
#[derive(Clone, Debug, Default)]
struct Search {
    /// Ranked as `sources` ranks them; None while it runs.
    releases: Option<Vec<Value>>,
    failed: Option<String>,
}

static SEARCHES: LazyLock<Mutex<HashMap<String, Search>>> = LazyLock::new(Default::default);
/// The user's choice of release per what plays: an index into its releases.
static CHOSEN: LazyLock<Mutex<HashMap<String, usize>>> = LazyLock::new(Default::default);

fn has_source() -> bool {
    #[cfg(test)]
    if let Some(on) = *TEST_SOURCE.lock().unwrap() {
        return on;
    }
    settings::source().is_some()
}

/// The names a source is searched by: the title in the content language first
/// (trackers name releases "Локализованное / Original"), then the original.
fn search_titles(info: &Info) -> (String, Vec<String>) {
    let alt = info.original_title.iter().filter(|o| **o != info.title).cloned().collect();
    (info.title.clone(), alt)
}

/// Starts the search for `key` (once per run) when there is a source.
fn ensure_search(key: &str, info: &Info) {
    if !has_source() || SEARCHES.lock().unwrap().contains_key(key) {
        return;
    }
    let (_, ep) = parse_key(key);
    let (title, alt_titles) = search_titles(info);
    let request = json!({
        "imdb": info.imdb,
        "title": title,
        "altTitles": alt_titles,
        "year": if ep.is_none() { info.year } else { None },
        "season": ep.map(|e| e.0),
        "episode": ep.map(|e| e.1),
    });
    SEARCHES.lock().unwrap().insert(key.to_owned(), Search::default());
    start_search(key.to_owned(), request);
}

#[cfg(not(test))]
fn start_search(key: String, request: Value) {
    let finish = move |search: Search| {
        SEARCHES.lock().unwrap().insert(key.clone(), search);
        bump();
    };
    let Some(source) = settings::source() else { return };
    let request: sources::Request = match serde_json::from_value(request) {
        Ok(r) => r,
        Err(e) => return finish(Search { releases: None, failed: Some(e.to_string()) }),
    };
    let job = sources::start_search(source, request);
    std::thread::spawn(move || {
        let started = Instant::now();
        loop {
            std::thread::sleep(Duration::from_millis(300));
            let r = sources::result(job);
            match r["state"].as_str() {
                Some("pending") if started.elapsed() < Duration::from_secs(120) => continue,
                Some("done") => {
                    let releases = r["releases"].as_array().cloned().unwrap_or_default();
                    break finish(Search { releases: Some(releases), failed: None });
                }
                _ => {
                    let message = text(&r["message"]).unwrap_or_else(|| "timed out".into());
                    eprintln!("reel catalog: search failed: {message}");
                    break finish(Search { releases: None, failed: Some(message) });
                }
            }
        }
    });
}

#[cfg(test)]
fn start_search(_key: String, _request: Value) {
    let _ = sources::result;
}

fn search_of(key: &str) -> Option<Search> {
    SEARCHES.lock().unwrap().get(key).cloned()
}

fn releases_of(key: &str) -> Vec<Value> {
    search_of(key).and_then(|s| s.releases).unwrap_or_default()
}

/// "4K", "1080p", "720p", "SD".
fn quality(r: &Value) -> String {
    match r["info"]["resolution"].as_u64() {
        Some(2160) => "4K".into(),
        Some(n) => format!("{n}p"),
        None => "SD".into(),
    }
}

fn quality_rank(r: &Value) -> u64 {
    r["info"]["resolution"].as_u64().unwrap_or(0)
}

/// The release's own words for where it comes from: "BluRay", "WEB HDR".
fn source_label(r: &Value) -> String {
    let info = &r["info"];
    let mut parts: Vec<&str> = Vec::new();
    parts.push(match info["source"].as_str() {
        Some("remux") => "Remux",
        Some("bluray") => "BluRay",
        Some("web") => "WEB",
        Some("hdtv") => "HDTV",
        Some("dvd") => "DVD",
        _ => "",
    });
    if info["dolby_vision"] == true {
        parts.push("DV");
    } else if info["hdr"] == true {
        parts.push("HDR");
    }
    parts.retain(|p| !p.is_empty());
    parts.join(" ")
}

fn peers(r: &Value) -> u64 {
    r["seeders"].as_u64().unwrap_or(0)
}

/// The bitrate it needs to play without waiting, Mbit/s (0: unknown).
/// A pack is shared out over `episodes`.
fn mbit(r: &Value, minutes: u32, episodes: u32) -> u64 {
    let bytes = r["size"].as_f64().unwrap_or(0.0);
    let share = if r["seasonPack"] == true { episodes.max(1) as f64 } else { 1.0 };
    if bytes <= 0.0 || minutes == 0 {
        return 0;
    }
    (bytes / share * 8.0 / (minutes as f64 * 60.0) / 1e6).ceil() as u64
}

fn size(r: &Value) -> String {
    r["size"].as_f64().filter(|b| *b > 0.0).map(crate::Fmt::size).unwrap_or_default()
}

/// Starts without waiting: enough people sharing for its bitrate.
fn plays_now(peers: u64, mbit: u64) -> bool {
    peers >= 50 && mbit <= 15
}

/// The release Play uses: the user's choice, else the best quality that
/// plays now, else the one most people share. An index into `releases`.
fn chosen(key: &str, releases: &[Value], minutes: u32, episodes: u32) -> Option<usize> {
    if releases.is_empty() {
        return None;
    }
    if let Some(&i) = CHOSEN.lock().unwrap().get(key)
        && i < releases.len()
    {
        return Some(i);
    }
    let rs = releases.iter().enumerate();
    rs.clone()
        .filter(|(_, r)| plays_now(peers(r), mbit(r, minutes, episodes)))
        .max_by_key(|(i, r)| (quality_rank(r), peers(r), std::cmp::Reverse(*i)))
        .or_else(|| rs.max_by_key(|(i, r)| (peers(r), std::cmp::Reverse(*i))))
        .map(|(i, _)| i)
}

/// Four signal bars for the people sharing.
fn bars(peers: u64) -> u8 {
    match peers {
        200.. => 4,
        30..200 => 3,
        10..30 => 2,
        _ => 1,
    }
}

/// How long one of `key` runs and how many episodes a pack of its season holds.
fn length_of(key: &str, info: &Info) -> (u32, u32) {
    let (show, ep) = parse_key(key);
    let Some((s, e)) = ep else { return (info.minutes, 1) };
    let episodes = info.seasons.iter().find(|x| x.0 == s).map_or(1, |x| x.2);
    let minutes = peek(&Call::Season(show.to_owned(), s))
        .and_then(|season| find_episode(&season, e).and_then(|x| x["runtimeMinutes"].as_u64()))
        .map_or(info.minutes, |m| m as u32);
    (minutes, episodes)
}

/// The releases of `key`, those starting fastest first, each with a plain
/// note (`note` a key under `release.note.*`, `mbit` for "needs").
fn releases_json(key: &str, info: &Info) -> Vec<Value> {
    let releases = releases_of(key);
    let (minutes, episodes) = length_of(key, info);
    let pick = chosen(key, &releases, minutes, episodes);
    let mut order: Vec<usize> = (0..releases.len()).collect();
    order.sort_by_key(|&i| std::cmp::Reverse(peers(&releases[i])));
    order
        .iter()
        .enumerate()
        .map(|(rank, &i)| {
            let r = &releases[i];
            let (p, m) = (peers(r), mbit(r, minutes, episodes));
            let note = if Some(i) == pick {
                "plays_now"
            } else if m > 15 {
                "needs"
            } else if p < 10 {
                "few_sharing"
            } else if rank == 0 {
                "starts_fastest"
            } else if p < 30 {
                "slow_start"
            } else {
                "plays_now"
            };
            json!({
                "index": i,
                "quality": quality(r),
                "source": source_label(r),
                // The release's full name.
                "group": r["title"],
                "size": size(r),
                "tracks": [],
                "peers": p,
                "bars": bars(p),
                "note": note,
                "mbit": m,
                "selected": Some(i) == pick,
                "pack": r["seasonPack"] == true,
                "indexer": r["indexer"],
            })
        })
        .collect()
}

/// The release line: the one Play uses, `fast` when it starts in seconds.
fn release_line(key: &str, info: &Info) -> Value {
    let releases = releases_of(key);
    let (minutes, episodes) = length_of(key, info);
    let Some(r) = chosen(key, &releases, minutes, episodes).map(|i| &releases[i]) else { return Value::Null };
    json!({
        "quality": quality(r),
        "source": source_label(r),
        "pack": r["seasonPack"] == true,
        "size": size(r),
        "peers": peers(r),
        "fast": peers(r) >= 100 && mbit(r, minutes, episodes) <= 15,
    })
}

/// Where the search for `key` is: "no_source" (none set in Settings),
/// "searching", "failed", "done".
fn releases_state(key: &str) -> &'static str {
    if !has_source() {
        return "no_source";
    }
    match search_of(key) {
        None => "searching",
        Some(Search { failed: Some(_), .. }) => "failed",
        Some(Search { releases: None, .. }) => "searching",
        Some(_) => "done",
    }
}

/// What the engine opens for `key`.
pub enum PlaySource {
    /// No source set, no release found, or no such title.
    None,
    /// Still finding out (the title or the search): ask again.
    Searching,
    /// A magnet or .torrent URL, and the episode to pick in a pack.
    Ready(String, Option<(u16, u16)>),
}

/// The release `key` plays, starting what is needed to know it.
pub fn play_source(key: &str) -> PlaySource {
    if !has_source() {
        return PlaySource::None;
    }
    let (title, ep) = parse_key(key);
    let call = Call::Title(title.to_owned());
    let Some(t) = meta(&call) else {
        return if answered(&call) { PlaySource::None } else { PlaySource::Searching };
    };
    let info = from_title(&t);
    ensure_search(key, &info);
    match search_of(key) {
        Some(Search { releases: Some(releases), .. }) => {
            let (minutes, episodes) = length_of(key, &info);
            match chosen(key, &releases, minutes, episodes).and_then(|i| text(&releases[i]["source"])) {
                Some(source) => PlaySource::Ready(source, ep.map(|(s, e)| (s as u16, e as u16))),
                None => PlaySource::None,
            }
        }
        Some(Search { failed: Some(_), .. }) | None => PlaySource::None,
        Some(_) => PlaySource::Searching,
    }
}

// ---- Episodes.

fn find_episode(season: &Value, number: u32) -> Option<&Value> {
    season["episodes"].as_array()?.iter().find(|e| e["number"].as_u64() == Some(number as u64))
}

/// The episode after (season, episode) of `show`, from what the catalog
/// knows (asking for the season it needs); None after the last one.
fn next_episode(show: &str, info: &Info, season: u32, episode: u32) -> Option<(u32, u32)> {
    let count = match meta(&Call::Season(show.to_owned(), season)) {
        Some(s) => s["episodes"].as_array().map_or(0, |e| {
            e.iter().filter_map(|x| x["number"].as_u64()).max().unwrap_or(0) as u32
        }),
        None => info.seasons.iter().find(|s| s.0 == season).map_or(u32::MAX, |s| s.2),
    };
    if episode < count {
        return Some((season, episode + 1));
    }
    info.seasons.iter().find(|s| s.0 > season && s.2 > 0).map(|s| (s.0, 1))
}

fn episode_json(show: &str, ep: &Value, fallback_minutes: u32) -> Value {
    let season = ep["season"].as_u64().unwrap_or(0) as u32;
    let number = ep["number"].as_u64().unwrap_or(0) as u32;
    let key = episode_key(show, season, number);
    let minutes = ep["runtimeMinutes"].as_u64().map_or(fallback_minutes, |m| m as u32);
    let seen = progress::get(&key);
    let watched = seen.as_ref().is_some_and(|e| e.watched);
    let quality = search_of(&key).and_then(|s| s.releases).and_then(|rs| {
        let pick = chosen(&key, &rs, minutes, 1)?;
        Some(quality(&rs[pick]))
    });
    json!({
        "id": key,
        "show": show,
        "season": season,
        "number": number,
        "title": text(&ep["name"]).unwrap_or_default(),
        "about": text(&ep["overview"]).unwrap_or_default(),
        "minutes": minutes,
        "date": ymd(&ep["airDate"]),
        "rating": rating(&ep["ratings"]).0,
        "thumb": image_url(&ep["still"], THUMB_W),
        "progress": seen.as_ref().map_or(0.0, |e| e.fraction()),
        "left": seen.as_ref().filter(|e| !e.watched && e.position > 0.0).map(|e| e.minutes_left()),
        "watched": watched,
        "start": seen.as_ref().filter(|e| !e.watched).map_or(0.0, |e| e.position),
        "quality": quality,
        "playable": has_source(),
    })
}

/// The episodes of a season: `[{"id","show","season","number","title","about",
/// "minutes","date":[y,m,d]|null,"rating","thumb","progress","left","watched",
/// "start","quality","playable"}]`; empty until the season is known.
pub fn episodes(show: &str, season: u32) -> Value {
    let got = meta_all(&[Call::Season(show.to_owned(), season), Call::Title(show.to_owned())]);
    let Some(s) = &got[0] else { return json!([]) };
    let fallback = got[1].as_ref().map_or(0, |t| from_title(t).minutes);
    s["episodes"]
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or_default()
        .iter()
        .map(|e| episode_json(show, e, fallback))
        .collect()
}

/// One episode (null until its season is known).
pub fn episode(show: &str, season: u32, number: u32) -> Value {
    let Some(s) = meta(&Call::Season(show.to_owned(), season)) else { return Value::Null };
    let fallback = peek(&Call::Title(show.to_owned())).map_or(0, |t| from_title(&t).minutes);
    find_episode(&s, number).map_or(Value::Null, |e| episode_json(show, e, fallback))
}

/// How long before the end of an episode the next one is offered.
const UP_NEXT_S: f64 = 40.0;

/// The episode after `key`, once `position` is within the last 40 s of
/// `duration`; null for a film, the last episode, or earlier.
pub fn up_next(key: &str, position: f64, duration: f64) -> Value {
    if duration <= 0.0 || duration - position > UP_NEXT_S {
        return Value::Null;
    }
    let (show, Some((s, e))) = parse_key(key) else { return Value::Null };
    let info = peek(&Call::Title(show.to_owned())).map(|t| from_title(&t)).unwrap_or_default();
    match next_episode(show, &info, s, e) {
        Some((ns, ne)) => episode(show, ns, ne),
        None => Value::Null,
    }
}

// ---- Cards and title screens.

/// Where the viewer is in a title: what Play starts and what it says.
struct Where {
    /// What plays (a title or an episode key).
    key: String,
    episode: Option<(u32, u32)>,
    /// Seconds into it; watched part; minutes left (None: not started).
    start: f64,
    progress: f64,
    left: Option<u32>,
    /// A show the viewer is in (or onto the next episode of).
    resume: bool,
}

fn where_in(info: &Info) -> Where {
    if !info.show {
        let seen = progress::get(&info.id).filter(|e| !e.watched);
        return Where {
            key: info.id.clone(),
            episode: None,
            start: seen.as_ref().map_or(0.0, |e| e.position),
            progress: seen.as_ref().map_or(0.0, |e| e.fraction()),
            left: seen.as_ref().map(|e| e.minutes_left()),
            resume: false,
        };
    }
    let first = (info.seasons.first().map_or(1, |s| s.0), 1);
    let at = |(s, e): (u32, u32), resume: bool| {
        let key = episode_key(&info.id, s, e);
        let seen = progress::get(&key).filter(|x| !x.watched);
        Where {
            start: seen.as_ref().map_or(0.0, |x| x.position),
            progress: seen.as_ref().map_or(0.0, |x| x.fraction()),
            left: seen.as_ref().map(|x| x.minutes_left()),
            key,
            episode: Some((s, e)),
            resume,
        }
    };
    match progress::latest(&info.id) {
        Some((_, e)) if !e.watched => at((e.season.unwrap_or(1), e.episode.unwrap_or(1)), true),
        Some((_, e)) => match next_episode(&info.id, info, e.season.unwrap_or(1), e.episode.unwrap_or(1)) {
            Some(next) => at(next, true),
            None => at(first, false),
        },
        None => at(first, false),
    }
}

/// What a card, a shelf and a hero show of a title.
fn summary(info: &Info) -> Value {
    let w = where_in(info);
    let play = match w.episode {
        Some((s, e)) => json!({ "id": w.key, "season": s, "episode": e, "start": w.start }),
        None => json!({ "id": w.key, "start": w.start }),
    };
    json!({
        "id": info.id,
        "kind": if info.show { "show" } else { "movie" },
        "title": info.title,
        "about": info.about,
        "notice": null,
        "anime": info.anime,
        "year": info.year,
        "yearEnd": info.year_end,
        "minutes": info.minutes,
        "rating": info.rating,
        "votes": info.votes,
        "ratings": details::ratings(&info.ratings),
        "certification": details::certification(&info.certifications, &settings::content_language()),
        "badges": [],
        "genres": info.genres,
        "still": info.still,
        "card": info.card.as_ref().or(info.still.as_ref()),
        "poster": info.poster,
        "ink": "#F5F5F5",
        "paper": info.paper.as_deref().unwrap_or("#1A1A1A"),
        "stoppedAt": (!info.show && w.start > 0.0).then_some(w.start as u32),
        "progress": w.progress,
        "left": w.left,
        "resume": match (w.resume, w.episode) {
            (true, Some((s, e))) => json!({ "season": s, "episode": e }),
            _ => Value::Null,
        },
        "seasons": info.season_count,
        "airs": info.airs.map(|[s, e, m, d]| json!({ "season": s, "episode": e, "month": m, "day": d })),
        "tag": null,
        "playable": has_source(),
        "inList": in_list(&info.id),
        "release": release_line(&w.key, info),
        "play": play,
    })
}

/// A stand-in card that says something instead of a title (`notice`, a key
/// under `empty.*`): no TMDB key, still loading, nothing came.
fn notice(key: &str) -> Value {
    let info = Info { id: format!("reel:notice:{key}"), ..Default::default() };
    let mut v = summary(&info);
    v["notice"] = json!(key);
    v
}

fn notice_title(key: &str) -> Value {
    let mut v = notice(key);
    v["releases"] = json!([]);
    v["releasesState"] = json!("none");
    v["aboutFull"] = json!(false);
    for empty in ["cast", "crew", "countries", "studios", "similar"] {
        v[empty] = json!([]);
    }
    for unknown in ["tagline", "originalTitle", "releaseDate", "status"] {
        v[unknown] = Value::Null;
    }
    v
}

fn list_of(v: &Value) -> &[Value] {
    v.as_array().map(Vec::as_slice).unwrap_or_default()
}

/// Shelf items of a `Meta.trending` answer.
fn cards(data: &Option<Value>) -> Vec<Value> {
    data.as_ref().and_then(|d| d["items"].as_array().cloned()).unwrap_or_default()
}

/// Full titles asked for ahead, per shelf, so the hero has the runtime and
/// the genres of what the remote reaches first. Not for anime: AniList
/// allows few calls a minute.
const PREFETCH: usize = 8;

fn shelf_items(cards: &[Value]) -> Vec<Value> {
    let mut seen = HashSet::new();
    cards
        .iter()
        .filter(|c| c["id"].as_str().is_some_and(|id| seen.insert(id.to_owned())))
        .enumerate()
        .map(|(i, c)| {
            let id = c["id"].as_str().unwrap_or_default();
            if i < PREFETCH && id.starts_with("tmdb:") && c["anime"] != true {
                meta(&Call::Title(id.to_owned()));
            }
            summary(&card_info(c))
        })
        .collect()
}

/// `a`, `b`, `a`, `b`…
fn interleave(a: Vec<Value>, b: Vec<Value>) -> Vec<Value> {
    let mut out = Vec::with_capacity(a.len() + b.len());
    let (mut a, mut b) = (a.into_iter(), b.into_iter());
    loop {
        match (a.next(), b.next()) {
            (None, None) => break out,
            (x, y) => out.extend(x.into_iter().chain(y)),
        }
    }
}

/// Continue watching: the titles the viewer is in, latest first; a film
/// they finished drops out, a show stays while it has a next episode.
fn continuing() -> Vec<Value> {
    let mut out = Vec::new();
    for (_, e) in progress::recent().into_iter().take(20) {
        let Some(t) = meta(&Call::Title(e.title.clone())) else { continue };
        let info = Info { id: e.title.clone(), ..from_title(&t) };
        if !info.show && e.watched {
            continue;
        }
        let s = summary(&info);
        if info.show && s["resume"].is_null() {
            continue;
        }
        out.push(s);
    }
    out
}

/// The home shelves: `[{"id","items":[summary…]}]`, ids are keys under
/// `shelf.*`. Never empty: a shelf with one notice card (`notice` set) says
/// why when there is nothing to show.
pub fn home() -> Value {
    let tmdb = tmdb_on();
    let kinds: &[&'static str] =
        if tmdb { &["movie", "tv", "movie-popular", "tv-popular", "anime"] } else { &["anime"] };
    let calls: Vec<Call> = kinds.iter().map(|k| Call::Trending(k)).collect();
    let got = meta_all(&calls);
    let by = |k: &str| kinds.iter().position(|x| *x == k).map(|i| cards(&got[i])).unwrap_or_default();
    let mut shelves = vec![("continue", continuing())];
    if tmdb {
        shelves.push(("trending_movies", shelf_items(&by("movie"))));
        shelves.push(("trending_shows", shelf_items(&by("tv"))));
        shelves.push(("popular", shelf_items(&interleave(by("movie-popular"), by("tv-popular")))));
    }
    shelves.push(("anime", shelf_items(&by("anime"))));
    let mut out: Vec<Value> =
        shelves.into_iter().filter(|(_, items)| !items.is_empty()).map(|(id, items)| json!({ "id": id, "items": items })).collect();
    let pending = calls.iter().any(|c| !answered(c));
    if !tmdb {
        out.push(json!({ "id": "no_tmdb", "items": [notice("no_tmdb")] }));
    } else if out.is_empty() {
        let key = if pending { "loading" } else { "offline" };
        out.push(json!({ "id": key, "items": [notice(key)] }));
    }
    json!(out)
}

/// A browse page: `{"trending":[summary…],"all":[summary…]}` for `"movies"`
/// or `"shows"`. Without TMDB, Shows lists anime and Movies a notice card.
pub fn browse(page: &str) -> Value {
    let shows = page == "shows";
    let tmdb = tmdb_on();
    let (trending, all) = match (tmdb, shows) {
        // Anime comes from AniList, with or without a TMDB key.
        _ if page == "anime" => ("anime", "anime-popular"),
        (true, false) => ("movie", "movie-popular"),
        (true, true) => ("tv", "tv-popular"),
        (false, true) => ("anime", "anime-popular"),
        (false, false) => return json!({ "trending": [notice("no_tmdb")], "all": [] }),
    };
    let got = meta_all(&[Call::Trending(trending), Call::Trending(all)]);
    let (t, a) = (shelf_items(&cards(&got[0])), shelf_items(&cards(&got[1])));
    if t.is_empty() && a.is_empty() {
        let key = if answered(&Call::Trending(trending)) { "offline" } else { "loading" };
        return json!({ "trending": [notice(key)], "all": [] });
    }
    json!({ "trending": t, "all": a })
}

/// An overview longer than this (characters) does not fit the hero's three
/// lines: the screen shows it whole below.
const HERO_ABOUT: usize = 200;
/// How many titles "More like this" shows.
const SIMILAR: usize = 12;

/// A title screen: the summary plus `releases` (of what Play starts: the
/// film, or the show's episode) and `releasesState` (see `releases_state`),
/// and for shows `season` (the one to show first) and `seasonList`
/// (`[{"number","year","episodes","name"}]`, regular seasons). Below the
/// hero: `aboutFull` (the overview is longer than the hero shows), `cast`,
/// `crew` (see `details`), `tagline`, `originalTitle`, `releaseDate`
/// ([y,m,d]), `countries`, `studios`, `status` (series), and `similar`
/// (summaries). A notice title while it is not known yet.
pub fn title(id: &str) -> Value {
    let call = Call::Title(id.to_owned());
    let Some(t) = meta_all(std::slice::from_ref(&call)).remove(0) else {
        return notice_title(if answered(&call) { "unavailable" } else { "loading" });
    };
    let info = Info { id: id.to_owned(), ..from_title(&t) };
    let w = where_in(&info);
    ensure_search(&w.key, &info);
    let mut v = summary(&info);
    v["releases"] = json!(releases_json(&w.key, &info));
    v["releasesState"] = json!(releases_state(&w.key));
    v["aboutFull"] = json!(info.about.chars().count() > HERO_ABOUT);
    v["cast"] = json!(details::cast(&t["credits"]));
    v["crew"] = json!(details::crew(&t["credits"], info.show));
    if let Value::Object(more) = details::details(&t, info.show) {
        v.as_object_mut().expect("a summary is an object").extend(more);
    }
    let mut seen = HashSet::from([id.to_owned()]);
    v["similar"] = list_of(&t["similar"])
        .iter()
        .filter(|c| c["id"].as_str().is_some_and(|i| seen.insert(i.to_owned())))
        .take(SIMILAR)
        .map(|c| summary(&card_info(c)))
        .collect();
    if info.show {
        v["season"] = json!(w.episode.map_or(1, |e| e.0));
        v["seasonList"] = info
            .seasons
            .iter()
            .map(|(n, y, eps, name)| json!({ "number": n, "year": y.or(info.year).unwrap_or(0), "episodes": eps, "name": name }))
            .collect();
    }
    v
}

/// The tracks of what plays: audio and subtitle options (keys under
/// `tracks.*`; the engine does not list a file's tracks yet) and the releases.
pub fn tracks(key: &str) -> Value {
    let (title, _) = parse_key(key);
    let info = peek(&Call::Title(title.to_owned())).map(|t| Info { id: title.to_owned(), ..from_title(&t) });
    json!({
        "audio": [{ "key": "original", "selected": true }],
        "subtitles": [{ "key": "off", "selected": true }],
        "releases": info.map(|i| releases_json(key, &i)).unwrap_or_default(),
    })
}

/// The user's list while the app runs.
static LIST: LazyLock<Mutex<HashSet<String>>> = LazyLock::new(Default::default);

fn in_list(id: &str) -> bool {
    LIST.lock().unwrap().contains(id)
}

/// Adds the title to the user's list or takes it off; whether it is on it now.
pub fn toggle_list(id: &str) -> bool {
    let mut list = LIST.lock().unwrap();
    let on = if list.remove(id) {
        false
    } else {
        list.insert(id.to_string());
        true
    };
    bump();
    on
}

/// Makes release `index` (of `title(id).releases[].index`) the one Play
/// uses for what `id` plays (a title: its Play target; or an episode key).
pub fn choose_release(id: &str, index: usize) -> bool {
    let (title, ep) = parse_key(id);
    let key = match (ep, peek(&Call::Title(title.to_owned()))) {
        (None, Some(t)) => where_in(&Info { id: title.to_owned(), ..from_title(&t) }).key,
        _ => id.to_owned(),
    };
    let ok = index < releases_of(&key).len();
    if ok {
        CHOSEN.lock().unwrap().insert(key, index);
        bump();
    }
    ok
}

/// Records where the player is in `key`; whether it now counts as watched.
pub fn save_progress(key: &str, position: f64, duration: f64) -> bool {
    let (title, ep) = parse_key(key);
    if title.starts_with("reel:") {
        return false;
    }
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_secs() as i64);
    let watched = progress::save(key, title, ep, position, duration, now);
    bump();
    watched
}

/// The catalog the UI shows: TMDB and AniList titles through `Meta`,
/// releases from the user's search source, watch progress. Results are JSON
/// strings; poll `revision()` and read again when it changes.
#[module]
pub struct Catalog;

#[module]
impl Catalog {
    /// Goes up when anything the catalog shows changed (an answer landed, a
    /// search finished, progress was saved): read again.
    pub fn revision() -> f64 {
        revision() as f64
    }

    /// The home shelves: `[{"id","items":[summary…]}]` (see `catalog::summary`).
    pub fn home() -> String {
        home().to_string()
    }

    /// `"movies"` or `"shows"`: `{"trending":[summary…],"all":[summary…]}`.
    pub fn browse(page: String) -> String {
        browse(&page).to_string()
    }

    /// A film or show screen (a notice title while it is not known yet).
    pub fn title(id: String) -> String {
        title(&id).to_string()
    }

    /// The episodes of `season` of `show`.
    pub fn episodes(show: String, season: u32) -> String {
        episodes(&show, season).to_string()
    }

    /// Episode `number` of `season` of `show`, or null while it is not known.
    pub fn episode(show: String, season: u32, number: u32) -> String {
        episode(&show, season, number).to_string()
    }

    /// The episode to offer next at `position` of `duration` seconds of `id`, or null.
    pub fn up_next(id: String, position: f64, duration: f64) -> String {
        up_next(&id, position, duration).to_string()
    }

    /// The audio, subtitle and release options of what plays.
    pub fn tracks(id: String) -> String {
        tracks(&id).to_string()
    }

    /// Adds `id` to the user's list or takes it off: whether it is on it now.
    pub fn toggle_list(id: String) -> bool {
        toggle_list(&id)
    }

    /// Makes release `index` the one Play uses for `id`.
    pub fn choose_release(id: String, index: u32) -> bool {
        choose_release(&id, index as usize)
    }

    /// Where the player should start `id` (what plays), seconds: where the
    /// viewer stopped, 0 when new or watched.
    pub fn start_at(id: String) -> f64 {
        progress::start_at(&id)
    }

    /// The player's report: `position` of `duration` seconds into `id`.
    /// Whether it counts as watched now (90%).
    pub fn save_progress(id: String, position: f64, duration: f64) -> bool {
        save_progress(&id, position, duration)
    }
}

/// The catalog's and progress's stores are process-wide: tests that use
/// them take this lock.
#[cfg(test)]
pub(crate) static TEST_LOCK: Mutex<()> = Mutex::new(());
#[cfg(test)]
static TEST_TMDB: Mutex<Option<bool>> = Mutex::new(None);
#[cfg(test)]
static TEST_SOURCE: Mutex<Option<bool>> = Mutex::new(None);

#[cfg(test)]
mod tests;
