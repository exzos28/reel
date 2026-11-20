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
use reel_domain::{episode, keys::episode_key};

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
        std::thread::spawn(move || {
            let started = Instant::now();
            loop {
                match catalog::save_request(&key) {
                    SaveAsk::Ready(request) => {
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
pub fn plan(show: &str, season: u32) -> Value {
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
    json!({ "episodes": episodes, "saved": saved, "total": episodes.len(), "size": size })
}

/// The Saved screen: `{"saving":[group…],"ready":[group…],"failed":[group…],"space"}`.
/// A group is one title, `{"id","title","image","show","count","size","have","progress",
/// "speed","peers","items":[item…]}` (speed and people of its torrents, each counted once): a film's holds its one item, a show's its episodes (by season and
/// number); groups newest first. Items as `Keep::list` gives them.
pub fn list() -> Value {
    let all = items();
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
                "items": items,
            })
        })
        .collect()
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

/// Goes up when anything the screens show changed.
pub fn revision() -> u64 {
    keep().revision() + REVISION.load(Ordering::Relaxed)
}

#[cfg(test)]
mod tests {
    use super::*;

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
}
