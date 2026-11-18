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

use serde_json::{Value, json};

use super::{progress, settings};
use crate::wiring::{metadata, playback};
use reel_domain::discover::{DiscoverKind, Filter};
use reel_domain::{compat, episode};

mod details;
mod filters;
mod paging;
pub mod search;

// ---- Ids (`reel_domain::keys`).

pub use reel_domain::keys::{episode_key, parse_key, season_key};
use reel_domain::keys::parse_season_key;

// ---- Meta answers, kept in memory for the sync calls.

#[derive(Clone, Debug, PartialEq)]
enum Call {
    /// A `Meta.trending` kind: "movie", "tv", "movie-popular", "tv-popular", "anime", "anime-popular".
    Trending(&'static str),
    Title(String),
    Season(String, u32),
    /// A page (from 1) of a browse grid: the catalog through a filter (`Meta`'s discover).
    Discover(DiscoverKind, Filter, u32),
    /// What the filters of a catalog offer (genre names, country names).
    FilterOptions(DiscoverKind),
}

impl Call {
    fn key(&self) -> String {
        match self {
            Call::Trending(k) => format!("trending/{k}"),
            Call::Title(id) => format!("title/{id}"),
            Call::Season(id, n) => format!("season/{id}/{n}"),
            Call::Discover(kind, f, 1) => format!("discover/{}/{}", kind.as_str(), f.key()),
            Call::Discover(kind, f, n) => format!("discover/{}/{}/p{n}", kind.as_str(), f.key()),
            Call::FilterOptions(kind) => format!("filterOptions/{}", kind.as_str()),
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
    /// `metadata().revision()` when it was asked: newer data may be there after.
    meta_rev: u64,
    /// When the last answer had no data: retried after a while.
    failed_at: Option<Instant>,
}

/// Waiting for a first answer on the UI thread, at most: long enough for the local cache
/// (milliseconds), short enough that a page opens at once when the network is needed (it
/// shows its "loading" stand-ins, and the answer replaces them when it lands).
const FIRST_WAIT: Duration = Duration::from_millis(80);
/// A call that failed is asked again after this.
const RETRY: Duration = Duration::from_secs(30);

static SLOTS: LazyLock<(Mutex<HashMap<String, Slot>>, Condvar)> = LazyLock::new(Default::default);
/// Goes up with every change the UI should read again for.
static REV: AtomicU64 = AtomicU64::new(0);

pub(crate) fn bump() {
    REV.fetch_add(1, Ordering::Relaxed);
    notify_changed();
}

/// Wakes whoever waits in `changed` (the catalog's or Meta's revision went up).
static CHANGED: tokio::sync::Notify = tokio::sync::Notify::const_new();

pub(crate) fn notify_changed() {
    CHANGED.notify_waiters();
}

/// How long `changed` waits before answering with the same revision.
const CHANGED_WAIT: Duration = Duration::from_secs(25);

/// The revision once it is past `after` (at once if it already is), or the same one after
/// `CHANGED_WAIT`: the UI waits on it instead of polling, so new data shows the moment
/// it lands.
pub async fn changed(after: u64) -> u64 {
    let waiting = runtime().spawn(async move {
        let deadline = tokio::time::Instant::now() + CHANGED_WAIT;
        loop {
            let notified = CHANGED.notified();
            tokio::pin!(notified);
            notified.as_mut().enable();
            let now = revision();
            if now > after {
                return now;
            }
            if tokio::time::timeout_at(deadline, notified).await.is_err() {
                return revision();
            }
        }
    });
    waiting.await.unwrap_or_else(|_| revision())
}

/// Goes up when the searches are dropped (another source, another language): a search started
/// before answers into nothing, rather than over the new one's (a source that died mid-search
/// left its failure on the title after a working one was set).
static SEARCH_GEN: AtomicU64 = AtomicU64::new(0);

/// Records `search` for `key` if no source or language change came since it started (`started_in`).
fn record_search(key: &str, started_in: u64, search: Search) {
    let mut searches = SEARCHES.lock().unwrap();
    if SEARCH_GEN.load(Ordering::Relaxed) == started_in {
        searches.insert(key.to_owned(), search);
    }
}

/// The search source changed: what the old one found (or failed to find) is dropped, so the
/// screens search the new one at once.
pub fn source_changed() {
    SEARCH_GEN.fetch_add(1, Ordering::Relaxed);
    SEARCHES.lock().unwrap().clear();
    CHOSEN.lock().unwrap().clear();
    bump();
}

/// The content language changed: everything asked so far was in the old one.
pub fn language_changed() {
    SLOTS.0.lock().unwrap().clear();
    SEARCH_GEN.fetch_add(1, Ordering::Relaxed);
    SEARCHES.lock().unwrap().clear();
    bump();
}

/// What the UI polls: changes of the catalog's own and of `Meta`.
pub fn revision() -> u64 {
    REV.load(Ordering::Relaxed) + metadata().revision()
}

/// The catalog's runtime; also what `settings::changed` waits on.
pub(crate) fn runtime() -> &'static tokio::runtime::Runtime {
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
    super::watchlist::init(data_dir);
    if META_STARTED.load(Ordering::Acquire) && data_dir.is_some() {
        metadata().init(data_dir);
    }
    bump();
}

/// Opens the metadata cache once, before the first `Meta` call.
fn start_meta() {
    if !META_STARTED.swap(true, Ordering::AcqRel) {
        let dir = DATA_DIR.lock().unwrap().clone();
        metadata().init(dir.as_deref());
    }
}

/// The data of `call` as far as known. Starts asking when there is no
/// answer yet, when `Meta` has refreshed something since, or a while after a failure.
fn meta(call: &Call) -> Option<Value> {
    let rev = metadata().revision();
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
            Call::Trending(kind) => metadata().trending(kind.to_string(), lang).await,
            Call::Title(id) => metadata().title(id.clone(), lang).await,
            Call::Season(id, n) => metadata().season(id.clone(), *n, lang).await,
            Call::Discover(kind, f, n) => metadata().discover(*kind, f.clone(), lang, *n).await,
            Call::FilterOptions(kind) => metadata().filter_options(*kind, lang).await,
        };
        let envelope: Value = serde_json::from_str(&text).unwrap_or(Value::Null);
        if !envelope["error"].is_null() {
            tracing::warn!("reel catalog: {}: {}", call.key(), envelope["error"]);
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
        let changed = !slot.loaded
            || (data.is_some() && slot.data != data)
            || (data.is_none() && slot.data.is_none() && slot.failed_at.is_none());
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
    metadata().status()["tmdb"]["configured"].as_bool().unwrap_or(false)
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
/// Today's date, UTC, as `[year, month, day]` (a civil date from the Unix day count).
fn today() -> [u32; 3] {
    let secs = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_secs() as i64);
    civil(secs.div_euclid(86_400))
}

/// The civil date of a day count since 1970-01-01 (Howard Hinnant's algorithm).
fn civil(days: i64) -> [u32; 3] {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + i64::from(m <= 2);
    [y as u32, m as u32, d as u32]
}

/// Whether an episode dated `date` has not aired yet (`today` passed in for tests).
fn upcoming(date: Option<[u32; 3]>, today: [u32; 3]) -> bool {
    date.is_some_and(|d| d > today)
}

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
/// A TV's browser decodes and repaints a smaller still more easily: w780, scaled up.
const STILL_W_TV: u32 = 780;
/// A desktop's hero runs across a wide window on a 2x screen (2000 pt is 4000 px): the largest
/// the source has (TMDB's original, 1920 to 3840 px), as w1280 shows soft there.
const STILL_W_DESKTOP: u32 = u32::MAX;

fn still_width() -> u32 {
    // A desktop build: the Mac, Windows, Linux (not the TV's 32-bit ARM core, nor a phone).
    const DESKTOP: bool = cfg!(any(target_os = "macos", windows, all(target_os = "linux", not(target_arch = "arm"))));
    if compat::profile().device() == Some("tv") {
        STILL_W_TV
    } else if DESKTOP {
        STILL_W_DESKTOP
    } else {
        STILL_W
    }
}
const CARD_W: u32 = 780;
/// A TV's card is 352 px wide at 1x: w500 (13 KB, 0.14 MP decoded) is enough; w780 is for
/// a desktop's 2x screen.
const CARD_W_TV: u32 = 500;

/// A card's picture. On a TV, one far wider than the card (a source with a single size, as
/// AniList's 1900 px banners) comes from the core shrunk (thumbs.rs).
fn card_url(image: &Value) -> Option<String> {
    let width = card_width();
    let url = image_url(image, width)?;
    let picked = image["variants"].as_array()?.iter().find(|v| v["url"].as_str() == Some(&url))?["width"].as_u64();
    if width == CARD_W_TV && picked.is_some_and(|w| w > 2 * width as u64) {
        return Some(thumb_url(&url, width));
    }
    Some(url)
}

/// Where the TV's web UI asks for `src` `width` px wide (a path on the core's own server,
/// which `interface::thumbs` answers).
fn thumb_url(src: &str, width: u32) -> String {
    let mut u = reqwest::Url::parse("http://core/img").expect("a fixed address");
    u.query_pairs_mut().append_pair("w", &width.to_string()).append_pair("src", src);
    format!("/img?{}", u.query().unwrap_or_default())
}

fn card_width() -> u32 {
    if compat::profile().device() == Some("tv") { CARD_W_TV } else { CARD_W }
}
const POSTER_W: u32 = 342;
const THUMB_W: u32 = 300;

fn images(info: &mut Info, v: &Value) {
    info.still = image_url(&v["backdrop"], still_width());
    info.card = card_url(&v["backdrop"]);
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
    let season = parse_season_key(key).map(|(_, s)| s);
    let (title, alt_titles) = search_titles(info);
    let film = ep.is_none() && season.is_none();
    let request = json!({
        "imdb": info.imdb,
        "title": title,
        "altTitles": alt_titles,
        "year": if film { info.year } else { None },
        "season": ep.map(|e| e.0).or(season),
        "episode": ep.map(|e| e.1),
    });
    SEARCHES.lock().unwrap().insert(key.to_owned(), Search::default());
    start_search(key.to_owned(), request);
}

#[cfg(not(test))]
fn start_search(key: String, request: Value) {
    let started_in = SEARCH_GEN.load(Ordering::Relaxed);
    let finish = move |search: Search| {
        record_search(&key, started_in, search);
        bump();
    };
    let Some(source) = settings::source() else { return };
    let request: reel_domain::search::Request = match serde_json::from_value(request) {
        Ok(r) => r,
        Err(e) => return finish(Search { releases: None, failed: Some(e.to_string()) }),
    };
    let job = playback().search(source, request);
    std::thread::spawn(move || {
        let started = Instant::now();
        loop {
            std::thread::sleep(Duration::from_millis(300));
            let r = playback().search_result(job);
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
    let _ = playback;
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

/// The bitrate a well shared release still starts at once with, Mbit/s: a 4K WEB-DL or
/// encode (20–40) is in, a remux (60–80) is not. A swarm of 50+ gives far more than 15.
const PLAYS_NOW_MBIT: u64 = 40;

/// Starts without waiting: enough people sharing for its bitrate.
fn plays_now(peers: u64, mbit: u64) -> bool {
    peers >= 50 && mbit <= PLAYS_NOW_MBIT
}

/// The tallest picture Play picks by itself (None: any). A phone or a tablet shows no more than
/// 1080p's worth: a 4K release only costs it time and space (the viewer can still choose one).
static PICTURE_CAP: Mutex<Option<u32>> = Mutex::new(None);

/// Sets `PICTURE_CAP` (0: none).
pub fn set_picture_cap(lines: u32) {
    *PICTURE_CAP.lock().unwrap() = (lines > 0).then_some(lines);
}

/// The release Play uses: the user's choice, else the best quality that plays now (within the
/// device's picture cap when one under it plays now), else the one most people share. An index
/// into `releases`.
fn chosen(key: &str, releases: &[Value], minutes: u32, episodes: u32) -> Option<usize> {
    let cap = *PICTURE_CAP.lock().unwrap();
    chosen_within(cap, key, releases, minutes, episodes)
}

/// `chosen` with the picture cap given (tests pass it rather than set the process-wide one).
fn chosen_within(cap: Option<u32>, key: &str, releases: &[Value], minutes: u32, episodes: u32) -> Option<usize> {
    if releases.is_empty() {
        return None;
    }
    if let Some(&i) = CHOSEN.lock().unwrap().get(key)
        && i < releases.len()
    {
        return Some(i);
    }
    // A season plays from a pack when there is one: it holds every episode.
    let packs = parse_season_key(key).is_some() && releases.iter().any(|r| r["seasonPack"] == true);
    let rs = releases.iter().enumerate().filter(|(_, r)| !packs || r["seasonPack"] == true);
    let within = |r: &Value| cap.is_none_or(|c| r["info"]["resolution"].as_u64().is_none_or(|h| h as u32 <= c));
    let now = rs.clone().filter(|(_, r)| plays_now(peers(r), mbit(r, minutes, episodes)));
    now.clone()
        .filter(|(_, r)| within(r))
        .max_by_key(|(i, r)| (quality_rank(r), peers(r), std::cmp::Reverse(*i)))
        .or_else(|| now.max_by_key(|(i, r)| (quality_rank(r), peers(r), std::cmp::Reverse(*i))))
        .or_else(|| rs.max_by_key(|(i, r)| (peers(r), std::cmp::Reverse(*i))))
        .map(|(i, _)| i)
}

/// Four signal bars for the people sharing.
fn bars(peers: u64) -> u8 {
    reel_domain::release::swarm_tier(peers)
}

/// How long one of `key` runs and how many episodes a pack of its season holds.
fn length_of(key: &str, info: &Info) -> (u32, u32) {
    if let Some((show, s)) = parse_season_key(key) {
        let episodes = info.seasons.iter().find(|x| x.0 == s).map_or(1, |x| x.2);
        let minutes = peek(&Call::Season(show.to_owned(), s))
            .and_then(|season| find_episode(&season, 1).and_then(|x| x["runtimeMinutes"].as_u64()))
            .map_or(info.minutes, |m| m as u32);
        return (minutes, episodes);
    }
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
    let order = release_order(&releases, pick);
    order
        .iter()
        .map(|&(i, top)| {
            let r = &releases[i];
            let (p, m) = (peers(r), mbit(r, minutes, episodes));
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
                "note": start_note(p, m),
                "mbit": m,
                "selected": Some(i) == pick,
                "pack": r["seasonPack"] == true,
                "indexer": r["indexer"],
                "top": top,
            })
        })
        .collect()
}

/// How a release will start, from the people sharing it and the speed it needs:
/// "starts_fast", "needs" (a fast connection, `mbit`), "slow_start", "few_sharing".
fn start_note(peers: u64, mbit: u64) -> &'static str {
    if peers < 10 {
        "few_sharing"
    } else if mbit > 15 {
        "needs"
    } else if peers < 50 {
        "slow_start"
    } else {
        "starts_fast"
    }
}

/// The list's order, each with whether it is in the short list: first the
/// most shared release of each quality (and the one Play uses), best quality
/// first; then the rest, most shared first.
fn release_order(releases: &[Value], pick: Option<usize>) -> Vec<(usize, bool)> {
    let mut by_peers: Vec<usize> = (0..releases.len()).collect();
    by_peers.sort_by_key(|&i| std::cmp::Reverse(peers(&releases[i])));
    // A quality is the resolution, HDR or not.
    let mut seen: Vec<(String, bool)> = Vec::new();
    let mut top: Vec<usize> = Vec::new();
    for &i in &by_peers {
        let info = &releases[i]["info"];
        let kind = (quality(&releases[i]), info["hdr"] == true || info["dolby_vision"] == true);
        if !seen.contains(&kind) {
            seen.push(kind);
            top.push(i);
        }
    }
    if let Some(p) = pick
        && !top.contains(&p)
    {
        top.push(p);
    }
    top.sort_by_key(|&i| (std::cmp::Reverse(quality_rank(&releases[i])), std::cmp::Reverse(peers(&releases[i]))));
    let rest = by_peers.into_iter().filter(|i| !top.contains(i));
    top.iter().map(|&i| (i, true)).chain(rest.map(|i| (i, false))).collect()
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

pub use reel_domain::play::PlaySource;

/// Whether a release holds an episode: from its files once they are known,
/// else from its name ("S01E01-08", "S01" holds every one: unknown).
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Has {
    Yes,
    No,
    Unknown,
}

fn has_episode(r: &Value, s: u32, e: u32) -> Has {
    if let Some(files) = text(&r["source"]).and_then(|u| torrent_files(&u)) {
        return if episode::pick(&files, Some((s as u16, e as u16))).is_some() { Has::Yes } else { Has::No };
    }
    let info = &r["info"];
    if info["season"].as_u64().is_some_and(|x| x != s as u64) {
        return Has::No;
    }
    match info["episodes"].as_array() {
        Some(eps) if !eps.is_empty() => {
            if eps.iter().any(|x| x.as_u64() == Some(e as u64)) { Has::Yes } else { Has::No }
        }
        _ => Has::Unknown,
    }
}

/// The files of a release's torrent once the engine has read them (it starts
/// reading them the first time it is asked).
#[cfg(not(test))]
fn torrent_files(url: &str) -> Option<Vec<(usize, String, u64)>> {
    playback().torrent_files(url)
}
#[cfg(test)]
fn torrent_files(url: &str) -> Option<Vec<(usize, String, u64)>> {
    tests::TORRENT_FILES.lock().unwrap().get(url).cloned()
}

/// The release a show's season plays from (the viewer's, else a pack, else the
/// best single one), whether it holds episode `e`; None while searching or when
/// the season has none. Starts the season's search.
fn season_has(show: &str, info: &Info, s: u32, e: u32) -> Option<(String, Has)> {
    let key = season_key(show, s);
    ensure_search(&key, info);
    let releases = releases_of(&key);
    let (minutes, episodes) = length_of(&key, info);
    let r = &releases[chosen(&key, &releases, minutes, episodes)?];
    Some((text(&r["source"])?, has_episode(r, s, e)))
}

/// The season's search finished (found or not).
fn season_done(show: &str, s: u32) -> bool {
    search_of(&season_key(show, s)).is_some_and(|x| x.releases.is_some() || x.failed.is_some())
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
    if let Some((s, e)) = ep
        && !CHOSEN.lock().unwrap().contains_key(key)
    {
        match season_has(title, &info, s, e) {
            Some((source, Has::Yes | Has::Unknown)) => return PlaySource::Ready(source, Some((s as u16, e as u16))),
            Some((_, Has::No)) => return PlaySource::NotInRelease,
            None if !season_done(title, s) => return PlaySource::Searching,
            // The season has no release at all: look for this episode alone.
            None => {}
        }
    }
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

/// What saving `key` takes: the release it plays and the words the Saved screen keeps.
pub enum SaveAsk {
    Ready(reel_domain::ports::KeepRequest),
    /// Still finding out (the title, the season or the search): ask again.
    Searching,
    /// It cannot be saved: "no_source" or "not_in_release" (the UI words it).
    No(&'static str),
}

pub fn save_request(key: &str) -> SaveAsk {
    let (show, ep) = parse_key(key);
    let source = match play_source(key) {
        PlaySource::Ready(source, episode) => (source, episode),
        PlaySource::Searching => return SaveAsk::Searching,
        PlaySource::None => return SaveAsk::No("no_source"),
        PlaySource::NotInRelease => return SaveAsk::No("not_in_release"),
    };
    let Some(t) = peek(&Call::Title(show.to_owned())) else { return SaveAsk::Searching };
    let info = Info { id: show.to_owned(), ..from_title(&t) };
    let (label, image) = match ep {
        Some((s, e)) => {
            let found = peek(&Call::Season(show.to_owned(), s)).and_then(|season| find_episode(&season, e).cloned());
            let name = found.as_ref().and_then(|x| text(&x["name"])).unwrap_or_default();
            let thumb = found.as_ref().and_then(|x| image_url(&x["still"], THUMB_W));
            (name, thumb.or(info.still.clone()))
        }
        None => (String::new(), info.still.clone()),
    };
    SaveAsk::Ready(reel_domain::ports::KeepRequest {
        key: key.to_owned(),
        source: source.0,
        episode: source.1,
        title: info.title.clone(),
        year: info.year.map(u32::from),
        label,
        image: image.unwrap_or_default(),
        cover: info.still.clone().unwrap_or_default(),
    })
}

/// How many episodes of a show have aired, from what the catalog has now (never asking the
/// network): a season it has the episodes of counts those aired, another its episode count.
pub fn aired_episodes(show: &str) -> Option<usize> {
    let t = peek(&Call::Title(show.to_owned()))?;
    let info = from_title(&t);
    let now = today();
    Some(
        info.seasons
            .iter()
            .map(|(n, _, count, _)| match peek(&Call::Season(show.to_owned(), *n)) {
                Some(s) => s["episodes"].as_array().map_or(0, |e| e.iter().filter(|x| !upcoming(ymd(&x["airDate"]), now)).count()),
                None => *count as usize,
            })
            .sum(),
    )
}

/// A title's still as the catalog has it now (never asking the network), for the Saved row
/// of a show's episodes.
pub fn known_still(id: &str) -> Option<String> {
    let t = peek(&Call::Title(id.to_owned()))?;
    from_title(&t).still
}

/// The release the season's episodes play from and its files, when known (sizes in the
/// Save drawer): None while either is not.
pub fn season_files(show: &str, season: u32) -> Option<reel_domain::play::Files> {
    // The season's release is what its first episode plays from (unless one was picked for it).
    match play_source(&episode_key(show, season, 1)) {
        PlaySource::Ready(source, Some(_)) => playback().torrent_files(&source),
        _ => None,
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
    // Where it plays from: a release picked for it, else its season's (if it holds it).
    let own = CHOSEN.lock().unwrap().contains_key(&key);
    let from = plays_from(&key);
    let pick = search_of(&from).and_then(|s| s.releases).and_then(|rs| {
        let i = chosen(&from, &rs, minutes, 1)?;
        Some(rs[i].clone())
    });
    let in_release = match (&pick, own) {
        (_, true) => Some("own"),
        (Some(r), false) => Some(match has_episode(r, season, number) {
            Has::Yes => "yes",
            Has::No => "no",
            Has::Unknown => "unknown",
        }),
        (None, _) => None,
    };
    // An episode that has not aired is in no release yet: it shows its date, and does not play.
    let airs = upcoming(ymd(&ep["airDate"]), today());
    let in_release = if airs { None } else { in_release };
    let quality = pick.as_ref().filter(|_| in_release != Some("no")).map(quality);
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
        // "yes", "unknown" (its name does not say), "no" (pick another), "own"
        // (a release picked for it); null while its season is searched.
        "inRelease": in_release,
        // Not aired yet: `date` is when it airs.
        "upcoming": airs,
        "playable": has_source() && !airs,
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

/// What a title's releases are chosen for: a film itself, a show's season
/// (of the episode Play starts).
fn release_key(info: &Info, w: &Where) -> String {
    match w.episode {
        Some((s, _)) => season_key(&info.id, s),
        None => w.key.clone(),
    }
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
        "release": release_line(&release_key(info, &w), info),
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
    for unknown in ["tagline", "originalTitle", "releaseDate", "status", "trailer"] {
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
        // A start under a minute in (one recorded before the minute counted) is not continued.
        if !e.watched && e.position < progress::CONTINUE_FROM {
            continue;
        }
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
    let mut shelves = vec![("continue", continuing()), ("watchlist", watching())];
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

/// The filter whose grid each catalog shows now: the one chosen last
/// once its answer is in, the one before while it loads.
static SHOWN: LazyLock<Mutex<HashMap<DiscoverKind, Filter>>> = LazyLock::new(Default::default);

/// A browse page (`"movies"`, `"shows"` (Series), `"cartoons"`, `"anime"`):
/// `{"trending":[summary…],"all":[summary…],"filters":[group…],"allState",
/// "more","moreState"}`.
/// `all` is the catalog through the page's filters (see `filters::groups`
/// for `filters`), the pages asked for so far (see `paging`); `allState` is
/// "done", "loading" (a new filter's answer is on its way: `all` is still the
/// last one's), "empty" (nothing matches) or "offline". `more`: the source
/// has more after `all` (`browse_more` asks for it); `moreState`: "idle",
/// "loading" (the next page is on its way) or "failed" (`all` stays; asking
/// again retries). Without TMDB, Shows lists anime and Movies a notice card.
pub fn browse(page: &str) -> Value {
    let Some(kind) = filters::page_kind(page, tmdb_on()) else {
        return json!({ "trending": [notice("no_tmdb")], "all": [], "filters": [], "allState": "done", "more": false, "moreState": "idle" });
    };
    let trending = Call::Trending(match kind {
        DiscoverKind::Movie => "movie",
        DiscoverKind::Tv => "tv",
        DiscoverKind::Cartoons => "cartoons",
        DiscoverKind::Anime => "anime",
    });
    let filter = filters::of(kind);
    let grid = Call::Discover(kind, filter.clone(), 1);
    let shown = SHOWN.lock().unwrap().get(&kind).cloned().filter(|f| *f != filter);
    let options = Call::FilterOptions(kind);
    // The first grid of a page may wait a moment like the rest; a new
    // filter's does not: the last grid stays until it lands.
    let calls = match shown {
        Some(_) => vec![trending.clone(), options.clone()],
        None => vec![trending.clone(), options.clone(), grid.clone()],
    };
    let got = meta_all(&calls);
    let mut data = got.get(2).cloned().flatten();
    if shown.is_some() {
        data = meta(&grid);
    }
    let mut state = "done";
    let mut showing = filter.clone();
    match (&data, shown) {
        (Some(_), _) => {
            SHOWN.lock().unwrap().insert(kind, filter.clone());
        }
        (None, Some(last)) if !answered(&grid) => {
            data = peek(&Call::Discover(kind, last.clone(), 1));
            showing = last;
            state = "loading";
        }
        (None, _) => state = if answered(&grid) { "offline" } else { "loading" },
    }
    let paged = data.as_ref().map(|d| paging::grid(kind, &showing, d));
    // The last filter's grid while the new one loads: nothing more to ask for it.
    let (more, more_state) = match &paged {
        Some(p) if showing == filter => (p.more, p.state),
        _ => (false, "idle"),
    };
    let (t, a) = (shelf_items(&cards(&got[0])), shelf_items(&paged.map(|p| p.cards).unwrap_or_default()));
    if state == "done" && a.is_empty() {
        state = "empty";
    }
    let groups = filters::groups(kind, &filter, got[1].as_ref());
    if t.is_empty() && a.is_empty() && filter.is_default() {
        let key = if answered(&trending) { "offline" } else { "loading" };
        return json!({ "trending": [notice(key)], "all": [], "filters": groups, "allState": state, "more": false, "moreState": "idle" });
    }
    json!({ "trending": t, "all": a, "filters": groups, "allState": state, "more": more, "moreState": more_state })
}

/// Asks for the next page of a browse page's grid (see `paging::more`):
/// whether one is on its way now.
pub fn browse_more(page: &str) -> bool {
    let Some(kind) = filters::page_kind(page, tmdb_on()) else { return false };
    paging::more(kind, &filters::of(kind))
}

/// One choice in a browse page's filter panel: `group` "genres" toggles
/// genre `id`, "years" and "countries" pick `id` or drop it when it was
/// picked, "sort" sets the order; an empty `id` clears the group. Whether
/// the filter changed.
pub fn choose_filter(page: &str, group: &str, id: &str) -> bool {
    let Some(kind) = filters::page_kind(page, tmdb_on()) else { return false };
    let changed = filters::choose(kind, group, id);
    if changed {
        // The new filter's grid starts from page 1; the one on screen keeps its pages until it lands.
        let shown = SHOWN.lock().unwrap().get(&kind).cloned();
        paging::reset(kind, shown.as_ref());
        bump();
    }
    changed
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
/// ([y,m,d]), `countries`, `studios`, `status` (series), `trailer` (a
/// YouTube watch URL or null), and `similar` (summaries). A notice title while it is not known yet.
pub fn title(id: &str) -> Value {
    let call = Call::Title(id.to_owned());
    let Some(t) = meta_all(std::slice::from_ref(&call)).remove(0) else {
        return notice_title(if answered(&call) { "unavailable" } else { "loading" });
    };
    let info = Info { id: id.to_owned(), ..from_title(&t) };
    let w = where_in(&info);
    ensure_search(&w.key, &info);
    // Play starts sooner when the release's link is already opened.
    if let PlaySource::Ready(source, _) = play_source(&w.key) {
        playback().prefetch(&source);
    }
    let mut v = summary(&info);
    let rk = release_key(&info, &w);
    ensure_search(&rk, &info);
    v["releases"] = json!(releases_json(&rk, &info));
    v["releasesState"] = json!(releases_state(&rk));
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

/// Whose releases `key` plays from: an episode its own when the viewer picked
/// one for it, else its season's; a film itself.
fn plays_from(key: &str) -> String {
    match parse_key(key) {
        (show, Some((s, _))) if !CHOSEN.lock().unwrap().contains_key(key) => season_key(show, s),
        _ => key.to_owned(),
    }
}

/// The releases of one episode, for the viewer to pick one when it is not in
/// its season's release: `{"releases","releasesState","seasonRelease"}` (the
/// season's release line, the one it is not in).
pub fn episode_releases(key: &str) -> Value {
    let (show, ep) = parse_key(key);
    let (Some((s, _)), Some(t)) = (ep, peek(&Call::Title(show.to_owned()))) else { return json!({ "releases": [], "releasesState": "none" }) };
    let info = Info { id: show.to_owned(), ..from_title(&t) };
    ensure_search(key, &info);
    json!({
        "releases": releases_json(key, &info),
        "releasesState": releases_state(key),
        "seasonRelease": release_line(&season_key(show, s), &info),
    })
}

/// The tracks of what plays: audio and subtitle options (keys under
/// `tracks.*`; the engine does not list a file's tracks yet) and the releases.
pub fn tracks(key: &str) -> Value {
    let (title, _) = parse_key(key);
    let info = peek(&Call::Title(title.to_owned())).map(|t| Info { id: title.to_owned(), ..from_title(&t) });
    json!({
        "audio": [{ "key": "original", "selected": true }],
        "subtitles": [{ "key": "off", "selected": true }],
        "releases": info.map(|i| releases_json(&plays_from(key), &i)).unwrap_or_default(),
    })
}

fn in_list(id: &str) -> bool {
    super::watchlist::contains(id)
}

/// Adds the title to the Watchlist or takes it off; whether it is on it now.
pub fn toggle_list(id: &str) -> bool {
    let on = super::watchlist::toggle(id);
    bump();
    on
}

/// The Watchlist's titles as Home's shelf shows them (what the catalog has of each; one it
/// does not have yet is asked for and shows once it is in).
fn watching() -> Vec<Value> {
    super::watchlist::ids()
        .into_iter()
        .filter_map(|id| {
            let t = meta(&Call::Title(id.clone()))?;
            Some(summary(&Info { id, ..from_title(&t) }))
        })
        .collect()
}

/// Makes release `index` (of `title(id).releases[].index`) the one Play
/// uses for what `id` plays (a title: its Play target; or an episode key).
pub fn choose_release(id: &str, index: usize) -> bool {
    let (title, ep) = parse_key(id);
    let key = match (ep, peek(&Call::Title(title.to_owned()))) {
        (None, Some(t)) => {
            let info = Info { id: title.to_owned(), ..from_title(&t) };
            release_key(&info, &where_in(&info))
        }
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

#[cfg(test)]
mod thumb_url_tests {
    #[test]
    fn the_url_carries_the_source_encoded() {
        assert_eq!(super::thumb_url("https://s4.anilist.co/b/1-a.jpg?x=1&y=2", 500), "/img?w=500&src=https%3A%2F%2Fs4.anilist.co%2Fb%2F1-a.jpg%3Fx%3D1%26y%3D2");
    }
}

#[cfg(test)]
mod release_order_tests {
    use super::*;

    fn r(resolution: u64, hdr: bool, seeders: u64) -> Value {
        json!({ "info": { "resolution": resolution, "hdr": hdr }, "seeders": seeders })
    }

    #[test]
    fn the_short_list_has_the_most_shared_of_each_quality_best_first() {
        let rs = [r(1080, false, 500), r(2160, true, 90), r(1080, false, 900), r(720, false, 40), r(2160, true, 300), r(2160, false, 10)];
        let order = release_order(&rs, None);
        let top: Vec<usize> = order.iter().filter(|(_, t)| *t).map(|(i, _)| *i).collect();
        assert_eq!(top, vec![4, 5, 2, 3], "4K HDR, 4K, 1080p, 720p: the most shared of each");
        let rest: Vec<usize> = order.iter().filter(|(_, t)| !*t).map(|(i, _)| *i).collect();
        assert_eq!(rest, vec![0, 1], "then the rest, most shared first");
    }

    #[test]
    fn the_release_play_uses_is_always_in_the_short_list() {
        let rs = [r(1080, false, 500), r(1080, false, 20)];
        let order = release_order(&rs, Some(1));
        assert!(order.iter().all(|(_, top)| *top));
    }
}
