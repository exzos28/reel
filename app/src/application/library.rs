//! Saving films and episodes to watch offline (design/offline-downloads.md): what the Save
//! button, the Save drawer and the Saved screen ask. The engine saves (`wiring::keep`); this
//! finds the release each key plays (the catalog may still be searching) and words nothing:
//! states are keys the UI translates, sizes are bytes.

use std::{
    collections::HashMap,
    path::Path,
    sync::{
        Mutex,
        atomic::{AtomicU64, Ordering},
    },
    time::{Duration, Instant},
};

use serde_json::{Value, json};

use super::catalog::{self, SaveAsk};
use crate::wiring::keep;
use reel_domain::{episode, eta, fit, keys::episode_key};

/// How long a key may wait for its release before it is given up on.
const SEARCH_FOR: Duration = Duration::from_secs(150);

/// Keys asked to be saved that have no item yet: still searching, or why they cannot be.
static ASKED: Mutex<Option<HashMap<String, Asked>>> = Mutex::new(None);
static REVISION: AtomicU64 = AtomicU64::new(1);

#[derive(Clone)]
enum Asked {
    Searching,
    No(&'static str),
}

fn asked(key: &str) -> Option<Asked> {
    ASKED.lock().unwrap().as_ref()?.get(key).cloned()
}

fn set_asked(key: &str, a: Option<Asked>) {
    let mut all = ASKED.lock().unwrap();
    let all = all.get_or_insert_with(HashMap::new);
    match a {
        Some(a) => all.insert(key.to_owned(), a),
        None => all.remove(key),
    };
    REVISION.fetch_add(1, Ordering::Relaxed);
}

pub fn supported() -> bool {
    keep().supported()
}

/// Opens the library (Settings.load hands the data dir over once).
pub fn init(data_dir: Option<&Path>) {
    if let (true, Some(dir)) = (supported(), data_dir) {
        keep().init(dir);
    }
}

/// Something is being saved now (not paused, not done): the screen stays on for it on iOS.
#[cfg_attr(not(target_os = "ios"), allow(dead_code))]
pub fn saving_now() -> bool {
    items().iter().any(|i| matches!(i["state"].as_str(), Some("resolving" | "saving" | "waiting")))
}

fn items() -> Vec<Value> {
    keep().list().as_array().cloned().unwrap_or_default()
}

/// Saves each key once its release is known (a film, or episodes). Keys already saved or
/// being saved are left as they are.
pub fn save(keys: &[String]) -> bool {
    save_from(keys, None)
}

/// Saves film `key` from its release `release` (an id, Save's smaller one) instead of Play's.
pub fn save_release(key: &str, release: &str) -> bool {
    save_from(&[key.to_owned()], Some(release.to_owned()))
}

fn save_from(keys: &[String], release: Option<String>) -> bool {
    if !supported() {
        return false;
    }
    let have = items();
    for key in keys {
        if have.iter().any(|i| i["key"] == key.as_str() && i["state"] != "failed") {
            continue;
        }
        set_asked(key, Some(Asked::Searching));
        let key = key.clone();
        let release = release.clone();
        std::thread::spawn(move || {
            let started = Instant::now();
            loop {
                match catalog::save_request(&key, release.as_deref()) {
                    SaveAsk::Ready(request) => {
                        // Not started when it does not fit (the Save button and the drawer say
                        // so first; this holds when several start at once).
                        if !claim(&key, catalog::save_size(&key, release.as_deref())) {
                            return set_asked(&key, Some(Asked::No("no_space")));
                        }
                        let r = keep().add(request);
                        set_asked(&key, r.err().map(|_| Asked::No("failed")));
                        return;
                    }
                    SaveAsk::No(why) => return set_asked(&key, Some(Asked::No(why))),
                    SaveAsk::Searching if started.elapsed() > SEARCH_FOR => return set_asked(&key, Some(Asked::No("no_source"))),
                    SaveAsk::Searching => std::thread::sleep(Duration::from_millis(400)),
                }
            }
        });
    }
    true
}

/// Bytes set aside per key that starts saving, until its item knows its own size (an item is
/// added before its torrent is read, with no size): saves started together each count the others.
static CLAIMED: Mutex<Option<HashMap<String, u64>>> = Mutex::new(None);

/// What is still to come on the disk: what is left of each unfinished item, and what is set
/// aside for keys whose item does not know its size yet (or is not added yet), `key` aside.
fn pending(items: &[Value], claimed: &HashMap<String, u64>, key: &str) -> u64 {
    let left: u64 = items
        .iter()
        .filter(|i| i["key"] != key && UNFINISHED.contains(&i["state"].as_str().unwrap_or("")))
        .map(|i| i["size"].as_u64().unwrap_or(0).saturating_sub(i["have"].as_u64().unwrap_or(0)))
        .sum();
    let set_aside: u64 = claimed
        .iter()
        .filter(|(k, _)| k.as_str() != key)
        .filter(|(k, _)| match items.iter().find(|i| i["key"] == k.as_str()) {
            Some(i) => UNFINISHED.contains(&i["state"].as_str().unwrap_or("")) && i["size"].as_u64().unwrap_or(0) == 0,
            None => matches!(asked(k), Some(Asked::Searching)),
        })
        .map(|(_, b)| *b)
        .sum();
    left + set_aside
}

/// Free bytes on the folder's volume, when known.
fn free() -> Option<u64> {
    keep().space()["free"].as_u64()
}

/// Sets `size` aside for `key` when it fits (`fit::fits`); true. A size or free space not known
/// lets it start: the engine waits for space (`waiting_space`) if the disk fills.
fn claim(key: &str, size: Option<u64>) -> bool {
    let mut all = CLAIMED.lock().unwrap();
    let all = all.get_or_insert_with(HashMap::new);
    let (Some(size), Some(free)) = (size, free()) else { return true };
    if !fit::fits(size, free, pending(&items(), all, key)) {
        return false;
    }
    all.insert(key.to_owned(), size);
    true
}

/// Save on a film's page (design/offline-downloads.md, "Fit"): `{"size","free","fits",
/// "smaller"}`. `size`: bytes its release takes (null while not known); `fits`: true, false, or
/// null while the size or the free space is not known; `smaller`: when it does not fit, the
/// release to save instead (`{"id","quality","source","size"}`), null when none fits.
pub fn offer(key: &str) -> Value {
    let size = catalog::save_size(key, None);
    let free = free();
    let all = items();
    let pending = pending(&all, CLAIMED.lock().unwrap().get_or_insert_with(HashMap::new), key);
    let fits = verdict(size, free, pending);
    let smaller = match (fits, free) {
        (Some(false), Some(free)) => catalog::smaller_release(key, |s| fit::fits(s, free, pending)),
        _ => None,
    };
    json!({ "size": size, "free": free, "fits": fits, "smaller": smaller })
}

/// Whether `size` fits `free` with `pending` to come: None while either is not known.
fn verdict(size: Option<u64>, free: Option<u64>, pending: u64) -> Option<bool> {
    Some(fit::fits(size?, free?, pending))
}

/// One key's state for its button: `{"state","progress","id","message"}`; state is
/// "none", "searching", "resolving", "saving", "paused", "waiting", "saved", "unavailable"
/// or "failed" (`message`: "no_source", "not_in_release", "unsupported", …).
pub fn item(key: &str) -> Value {
    item_in(&items(), key)
}

fn item_in(items: &[Value], key: &str) -> Value {
    if let Some(i) = items.iter().find(|i| i["key"] == key) {
        return json!({ "state": i["state"], "progress": i["progress"], "id": i["id"], "message": i["message"] });
    }
    match asked(key) {
        Some(Asked::Searching) => json!({ "state": "searching", "progress": 0.0 }),
        Some(Asked::No(why)) => json!({ "state": "failed", "progress": 0.0, "message": why }),
        None => json!({ "state": "none", "progress": 0.0 }),
    }
}

const UNFINISHED: [&str; 4] = ["resolving", "saving", "paused", "waiting"];

/// The hero button of a title. A film: its item. A show: what is saved of it,
/// `{"state","saved","saving","progress"}`, state "none", "saving" while anything is
/// unfinished ("paused" when all of that is paused), "saved" once every aired episode is,
/// "some" while only some are.
pub fn title(id: &str, show: bool) -> Value {
    if !show {
        return item(id);
    }
    let prefix = format!("{id}:s");
    let mine: Vec<Value> = items().into_iter().filter(|i| i["key"].as_str().is_some_and(|k| k.starts_with(&prefix))).collect();
    let searching = ASKED
        .lock()
        .unwrap()
        .as_ref()
        .map_or(0, |a| a.iter().filter(|(k, v)| k.starts_with(&prefix) && matches!(v, Asked::Searching)).count());
    let saved = mine.iter().filter(|i| i["state"] == "saved").count();
    let unfinished: Vec<&Value> = mine.iter().filter(|i| UNFINISHED.contains(&i["state"].as_str().unwrap_or(""))).collect();
    let (have, size) = unfinished.iter().fold((0u64, 0u64), |(h, s), i| (h + i["have"].as_u64().unwrap_or(0), s + i["size"].as_u64().unwrap_or(0)));
    // "Saved" once every aired episode is; some of them: "some" (the button counts them).
    let aired = catalog::aired_episodes(id);
    let state = if !unfinished.is_empty() || searching > 0 {
        if searching == 0 && unfinished.iter().all(|i| i["state"] == "paused") { "paused" } else { "saving" }
    } else if saved > 0 && aired.is_some_and(|a| saved >= a) {
        "saved"
    } else if saved > 0 {
        "some"
    } else {
        "none"
    };
    json!({
        "state": state,
        "saved": saved,
        "saving": unfinished.len() + searching,
        "progress": if size > 0 { have as f64 / size as f64 } else { 0.0 },
    })
}

/// The Save drawer for a season: `{"episodes":[{"key","number","title","size","state",
/// "progress","locked"}],"saved","total","size"}`. Sizes are bytes, null until the release's
/// files are known; `locked`: saved or being saved, so the drawer does not pick it again.
/// `picked`: the keys ticked in the drawer: `"picked":{"count","size","fits"}` (bytes of those
/// whose size is known; `fits` true, false, or null while a size or the free space is not
/// known), and `"free"` (bytes, null when not known).
pub fn plan(show: &str, season: u32, picked: &[String]) -> Value {
    let files = catalog::season_files(show, season);
    let through = catalog::through_of(show, season);
    let all = items();
    let episodes: Vec<Value> = catalog::episodes(show, season)
        .as_array()
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .filter(|e| e["upcoming"] != true)
        .map(|e| {
            let number = e["number"].as_u64().unwrap_or(0) as u32;
            let key = episode_key(show, season, number);
            let from_pack = files.as_ref().and_then(|f| {
                let i = episode::pick(f, Some((season as u16, number as u16)), through)?;
                f.iter().find(|x| x.0 == i).map(|x| x.2)
            });
            let saved_size = all.iter().find(|i| i["key"] == key.as_str()).and_then(|i| i["size"].as_u64()).filter(|s| *s > 0);
            let st = item_in(&all, &key);
            let state = st["state"].as_str().unwrap_or("none").to_owned();
            json!({
                "key": key,
                "number": number,
                "title": e["title"],
                "size": saved_size.or(from_pack),
                "locked": !matches!(state.as_str(), "none" | "failed"),
                "state": state,
                "progress": st["progress"],
            })
        })
        .collect();
    let saved = episodes.iter().filter(|e| e["locked"] == true).count();
    let size: Option<u64> = episodes.iter().map(|e| e["size"].as_u64()).sum();
    let ticked: Vec<&Value> = episodes.iter().filter(|e| e["locked"] != true && picked.iter().any(|k| e["key"] == k.as_str())).collect();
    let known: u64 = ticked.iter().filter_map(|e| e["size"].as_u64()).sum();
    let unknown = ticked.iter().any(|e| e["size"].as_u64().is_none());
    let free = free();
    let pending = pending(&all, CLAIMED.lock().unwrap().get_or_insert_with(HashMap::new), "");
    let fits = picked_fit(ticked.len(), known, unknown, free, pending);
    json!({
        "episodes": episodes,
        "saved": saved,
        "total": episodes.len(),
        "size": size,
        "free": free,
        "picked": { "count": ticked.len(), "size": known, "fits": fits },
    })
}

/// Whether the drawer's ticked episodes fit: false as soon as those of known size do not (more
/// only adds), null while one's size or the free space is not known, true otherwise.
fn picked_fit(count: usize, known: u64, unknown: bool, free: Option<u64>, pending: u64) -> Option<bool> {
    if count == 0 {
        return Some(true);
    }
    match verdict(Some(known), free, pending)? {
        false => Some(false),
        true if unknown => None,
        true => Some(true),
    }
}

/// The Saved screen: `{"saving":[group…],"ready":[group…],"failed":[group…],"space"}`.
/// A group is one title, `{"id","title","image","show","count","size","have","progress",
/// "speed","peers","items":[item…]}` (speed and people of its torrents, each counted once): a film's holds its one item, a show's its episodes (by season and
/// number); groups newest first. Items as `Keep::list` gives them.
pub fn list() -> Value {
    let all = with_left(items());
    let state = |i: &Value| i["state"].as_str().unwrap_or("").to_owned();
    // A title is in one place: Saving while anything of it saves (its saved episodes with it),
    // else Ready to watch; what failed is listed apart.
    let kept: Vec<Value> = all.iter().filter(|i| state(i) != "failed").cloned().collect();
    let (saving, ready): (Vec<Value>, Vec<Value>) =
        groups(kept).into_iter().partition(|g| g["items"].as_array().is_some_and(|items| items.iter().any(|i| UNFINISHED.contains(&state(i).as_str()))));
    let failed: Vec<Value> = all.iter().filter(|i| state(i) == "failed").cloned().collect();
    json!({
        "saving": saving,
        "ready": ready,
        "failed": groups(failed),
        "space": keep().space(),
    })
}

/// Items grouped by title (`keys::parse_key`'s title), in the order their newest item comes.
fn groups(items: Vec<Value>) -> Vec<Value> {
    let mut order: Vec<String> = Vec::new();
    let mut by: HashMap<String, Vec<Value>> = HashMap::new();
    for i in items {
        let id = reel_domain::keys::parse_key(i["key"].as_str().unwrap_or("")).0.to_owned();
        if !by.contains_key(&id) {
            order.push(id.clone());
        }
        by.entry(id).or_default().push(i);
    }
    order
        .into_iter()
        .map(|id| {
            let mut items = by.remove(&id).unwrap_or_default();
            items.sort_by_key(|i| (i["season"].as_u64().unwrap_or(0), i["number"].as_u64().unwrap_or(0)));
            let show = items.iter().any(|i| i["season"].is_u64());
            let size: u64 = items.iter().map(|i| i["size"].as_u64().unwrap_or(0)).sum();
            let have: u64 = items.iter().map(|i| i["have"].as_u64().unwrap_or(0)).sum();
            // Speed and people are a torrent's, not an episode's: each torrent counted once.
            let mut torrents: HashMap<String, (f64, u64)> = HashMap::new();
            for i in &items {
                if let (Some(t), Some(speed)) = (i["torrent"].as_str(), i["speed"].as_f64()) {
                    torrents.insert(t.to_owned(), (speed, i["peers"].as_u64().unwrap_or(0)));
                }
            }
            let speed = (!torrents.is_empty()).then(|| torrents.values().map(|t| t.0).sum::<f64>());
            let peers: u64 = torrents.values().map(|t| t.1).sum();
            let first = items.first().cloned().unwrap_or(Value::Null);
            json!({
                "id": id,
                "title": first["title"],
                // A show's own picture: the catalog's when it has it (items saved before they
                // kept one), else the one kept with them.
                "image": if show { catalog::known_still(&id).map(Value::from).unwrap_or_else(|| first["cover"].clone()) } else { first["cover"].clone() },
                "show": show,
                "count": items.len(),
                "size": size,
                "have": have,
                "progress": if size > 0 { have as f64 / size as f64 } else { 0.0 },
                "checking": items.iter().any(|i| i["checking"] == true),
                "speed": speed,
                "peers": peers,
                "left": group_left(&items),
                "items": items,
            })
        })
        .collect()
}

/// Bytes an item still lacks.
fn remaining(i: &Value) -> u64 {
    i["size"].as_u64().unwrap_or(0).saturating_sub(i["have"].as_u64().unwrap_or(0))
}

fn unfinished(i: &Value) -> bool {
    UNFINISHED.contains(&i["state"].as_str().unwrap_or(""))
}

/// The items with `"left"`: minutes each still takes, rounded as said (`eta::minutes_left`),
/// null unless it saves at a rate the engine measured steady. The rate is its torrent's, so an
/// episode of a pack others of which still save says nothing: its show's row says how long
/// they all take.
fn with_left(items: Vec<Value>) -> Vec<Value> {
    let sharing = |t: &Value| items.iter().filter(|i| unfinished(i) && t.is_string() && i["torrent"] == *t).count();
    let left: Vec<Option<u32>> = items
        .iter()
        .map(|i| {
            let rate = if i["state"] == "saving" && sharing(&i["torrent"]) == 1 { i["rate"].as_f64() } else { None };
            rate.and_then(|r| eta::minutes_left(remaining(i), r))
        })
        .collect();
    items
        .into_iter()
        .zip(left)
        .map(|(mut i, left)| {
            i["left"] = json!(left);
            i
        })
        .collect()
}

/// Minutes until every unfinished item of a title is saved: all that is left of them over
/// their torrents' rates together. Null when one of them does not save at a known rate (paused,
/// waiting, just started) or nothing is unfinished.
fn group_left(items: &[Value]) -> Option<u32> {
    let unfinished: Vec<&Value> = items.iter().filter(|i| unfinished(i)).collect();
    if unfinished.is_empty() {
        return None;
    }
    let mut rates: HashMap<&str, f64> = HashMap::new();
    for i in &unfinished {
        let rate = if i["state"] == "saving" { i["rate"].as_f64() } else { None };
        rates.insert(i["torrent"].as_str()?, rate?);
    }
    eta::minutes_left(unfinished.iter().map(|i| remaining(i)).sum(), rates.values().sum())
}

/// The Saved tab's mark: `{"saving","progress"}`; saving while anything is being found or
/// saved (not only paused), progress the share saved of everything unfinished (paused too, so
/// it does not jump back when one pauses).
pub fn overall() -> Value {
    let all = items();
    let unfinished: Vec<&Value> = all.iter().filter(|i| unfinished(i)).collect();
    let searching = ASKED.lock().unwrap().as_ref().is_some_and(|a| a.values().any(|v| matches!(v, Asked::Searching)));
    let saving = searching || unfinished.iter().any(|i| i["state"] != "paused");
    let size: u64 = unfinished.iter().map(|i| i["size"].as_u64().unwrap_or(0)).sum();
    let have: u64 = unfinished.iter().map(|i| i["have"].as_u64().unwrap_or(0)).sum();
    json!({ "saving": saving, "progress": if size > 0 { have as f64 / size as f64 } else { 0.0 } })
}

pub fn set_running(id: u32, on: bool) {
    keep().set_running(id, on);
}

pub fn remove(id: u32) {
    keep().remove(id);
}

/// Saves new items into `folder` from now on. Err: it cannot be written to.
pub fn set_folder(folder: &str) -> Result<(), String> {
    keep().set_folder(Path::new(folder))
}

/// Opens the folder new items are saved into in the system's file manager (Finder, File
/// Explorer, the desktop's own); false where there is none (phones, TVs) or it did not open.
pub fn open_folder() -> bool {
    let Some(folder) = keep().folder() else { return false };
    let _ = std::fs::create_dir_all(&folder);
    #[cfg(target_os = "macos")]
    let opened = std::process::Command::new("open").arg(&folder).spawn();
    #[cfg(windows)]
    let opened = std::process::Command::new("explorer").arg(&folder).spawn();
    #[cfg(all(target_os = "linux", not(target_os = "android")))]
    let opened = std::process::Command::new("xdg-open").arg(&folder).spawn();
    #[cfg(not(any(target_os = "macos", windows, all(target_os = "linux", not(target_os = "android")))))]
    let opened: std::io::Result<()> = Err(std::io::Error::other("no file manager"));
    match opened {
        Ok(_) => true,
        Err(e) => {
            tracing::warn!("reel saved: opening {}: {e}", folder.display());
            false
        }
    }
}

/// Where the app opens (design/offline-downloads.md): `"saved"` when Home's catalog is out of
/// reach (no network) and something is saved to watch, `"home"` otherwise, `"wait"` while Home's
/// first answers are on their way.
pub fn opening() -> &'static str {
    if !supported() {
        return "home";
    }
    opening_from(catalog::home_unreachable(), || items().iter().any(|i| i["state"] == "saved"))
}

fn opening_from(unreachable: Option<bool>, ready: impl FnOnce() -> bool) -> &'static str {
    match unreachable {
        None => "wait",
        Some(true) if ready() => "saved",
        Some(_) => "home",
    }
}

/// Goes up when anything the screens show changed.
pub fn revision() -> u64 {
    keep().revision() + REVISION.load(Ordering::Relaxed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn it_opens_on_saved_only_offline_with_something_to_watch() {
        assert_eq!(opening_from(None, || true), "wait");
        assert_eq!(opening_from(Some(true), || true), "saved");
        assert_eq!(opening_from(Some(true), || false), "home", "nothing saved: Home says it is offline");
        assert_eq!(opening_from(Some(false), || true), "home");
    }

    #[test]
    fn a_shows_episodes_are_one_group_a_film_its_own() {
        let ep = |n: u64| json!({ "key": format!("tmdb:tv:1:s1e{n}"), "title": "Show", "image": "", "cover": "", "season": 1, "number": n, "size": 100, "have": 50 });
        let film = json!({ "key": "tmdb:movie:7", "title": "Film", "image": "", "cover": "", "season": null, "number": null, "size": 10, "have": 10 });
        let g = groups(vec![ep(3), film, ep(1)]);
        assert_eq!(g.len(), 2);
        assert_eq!(g[0]["id"], "tmdb:tv:1");
        assert_eq!(g[0]["show"], true);
        assert_eq!(g[0]["count"], 2);
        assert_eq!(g[0]["items"][0]["number"], 1, "episodes in order");
        assert_eq!(g[0]["progress"], 0.5);
        assert_eq!(g[1]["show"], false);
    }

    const MB: u64 = 1024 * 1024;

    fn saving(n: u64, torrent: &str, have: u64, rate: Option<f64>) -> Value {
        json!({ "key": format!("tmdb:tv:1:s1e{n}"), "season": 1, "number": n, "state": "saving", "torrent": torrent, "size": 700 * MB, "have": have, "rate": rate })
    }

    #[test]
    fn an_item_says_how_long_it_takes_only_at_a_known_rate() {
        // The review's case: 35 of 700 MB at 0.1 MB/s.
        let i = |rate| with_left(vec![saving(1, "a", 35 * MB, rate)]).remove(0);
        assert_eq!(i(Some(0.1 * MB as f64))["left"], 110);
        assert_eq!(i(None)["left"], Value::Null);
        let mut paused = saving(1, "a", 35 * MB, Some(MB as f64));
        paused["state"] = json!("paused");
        assert_eq!(with_left(vec![paused])[0]["left"], Value::Null, "a paused one takes no time");
    }

    #[test]
    fn a_show_takes_what_is_left_of_it_over_its_torrents_rates() {
        let rate = Some(MB as f64);
        // Two episodes of one pack, 600 MB left of each, the pack at 1 MB/s: 20 min.
        let g = groups(with_left(vec![saving(1, "a", 100 * MB, rate), saving(2, "a", 100 * MB, rate)]));
        assert_eq!(g[0]["left"], 20);
        assert_eq!(g[0]["items"][0]["left"], Value::Null, "an episode of a pack others of which save says nothing");
        // Two seasons from two torrents, 1 MB/s each: 2 MB/s together.
        let g = groups(with_left(vec![saving(1, "a", 100 * MB, rate), saving(2, "b", 100 * MB, rate)]));
        assert_eq!(g[0]["left"], 10);
        let mut done = saving(3, "a", 700 * MB, None);
        done["state"] = json!("saved");
        let g = groups(with_left(vec![saving(1, "a", 100 * MB, rate), done.clone()]));
        assert_eq!(g[0]["left"], 10, "a saved episode adds nothing");
        assert_eq!(g[0]["items"][0]["left"], 10, "the last one saving of its pack says its own");
        let g = groups(with_left(vec![saving(1, "a", 100 * MB, rate), saving(2, "b", 100 * MB, None)]));
        assert_eq!(g[0]["left"], Value::Null, "one without a rate: not known");
        assert_eq!(groups(vec![done])[0]["left"], Value::Null);
    }


    const GIB: u64 = 1024 * 1024 * 1024;

    #[test]
    fn what_is_still_to_come_counts_unfinished_items_and_sizes_set_aside() {
        let item = |key: &str, state: &str, size: u64, have: u64| json!({ "key": key, "state": state, "size": size, "have": have });
        let items = vec![
            item("a", "saving", 10 * GIB, 4 * GIB),
            item("b", "saved", 5 * GIB, 5 * GIB),
            // Added, its torrent not read yet: no size of its own.
            item("c", "resolving", 0, 0),
        ];
        let claimed: HashMap<String, u64> = [("c".to_owned(), 3 * GIB), ("a".to_owned(), 10 * GIB), ("gone".to_owned(), 7 * GIB)].into();
        assert_eq!(pending(&items, &claimed, "new"), 6 * GIB + 3 * GIB, "a's 6 left, c's 3 set aside; a counted once, a key with no item and no ask not at all");
        assert_eq!(pending(&items, &claimed, "c"), 6 * GIB, "its own aside");
    }

    #[test]
    fn the_drawer_says_whether_the_ticked_episodes_fit() {
        let free = Some(19 * GIB);
        assert_eq!(picked_fit(0, 0, false, free, 0), Some(true), "nothing ticked");
        assert_eq!(picked_fit(4, 5 * GIB, false, free, 0), Some(true));
        assert_eq!(picked_fit(8, 40 * GIB, false, free, 0), Some(false));
        assert_eq!(picked_fit(8, 40 * GIB, true, free, 0), Some(false), "already over with what is known");
        assert_eq!(picked_fit(8, 5 * GIB, true, free, 0), None, "a size not known yet");
        assert_eq!(picked_fit(4, 5 * GIB, false, None, 0), None, "the free space not known");
        assert_eq!(picked_fit(4, 5 * GIB, false, free, 14 * GIB), Some(false), "with what still saves");
    }
}
