//! Watch progress: where the viewer stopped in each film and episode, kept in
//! `progress.json` in the app's data directory (handed over once by
//! `Settings.load`; NSH's storage cannot be used from a `#[module]`). The
//! player reports the position every few seconds and on stop; Continue
//! watching, "Resume …" and the start position come from here.

use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::Mutex,
};

use serde::{Deserialize, Serialize};

/// Watched to here (of the duration), the film or episode counts as seen.
pub const WATCHED_AT: f64 = 0.9;
/// Less than this into something new is not worth remembering, seconds.
const MIN_POSITION: f64 = 10.0;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    /// The title ("tmdb:movie:603", "tmdb:tv:1399").
    pub title: String,
    pub season: Option<u32>,
    pub episode: Option<u32>,
    /// Seconds.
    pub position: f64,
    pub duration: f64,
    /// Unix seconds.
    pub updated_at: i64,
    /// Order of the saves (several can share a second).
    #[serde(default)]
    pub seq: u64,
    pub watched: bool,
}

impl Entry {
    fn order(&self) -> (i64, u64) {
        (self.updated_at, self.seq)
    }
}

impl Entry {
    /// Watched part, 0..1.
    pub fn fraction(&self) -> f64 {
        if self.watched {
            1.0
        } else if self.duration > 0.0 {
            (self.position / self.duration).clamp(0.0, 1.0)
        } else {
            0.0
        }
    }

    /// Whole minutes left (at least 1 while not watched).
    pub fn minutes_left(&self) -> u32 {
        ((self.duration - self.position).max(0.0) / 60.0).ceil().max(1.0) as u32
    }
}

#[derive(Default, Serialize, Deserialize)]
struct Saved {
    /// By what plays: a title id, or `<title>:s<season>e<episode>`.
    entries: HashMap<String, Entry>,
    /// The subtitles chosen per title (not per episode): "off", a language
    /// ("en"), or "?" for a track whose language is unknown.
    #[serde(default)]
    subtitles: HashMap<String, String>,
}

struct Store {
    file: Option<PathBuf>,
    saved: Saved,
}

static STORE: Mutex<Option<Store>> = Mutex::new(None);

fn with<R>(f: impl FnOnce(&mut Store) -> R) -> R {
    let mut guard = STORE.lock().unwrap();
    f(guard.get_or_insert_with(|| Store { file: None, saved: Saved::default() }))
}

fn write(file: &Path, saved: &Saved) {
    let tmp = file.with_extension("json.tmp");
    let result = std::fs::create_dir_all(file.parent().unwrap_or(Path::new(".")))
        .and_then(|_| std::fs::write(&tmp, serde_json::to_vec(saved).expect("plain data")))
        .and_then(|_| std::fs::rename(&tmp, file));
    if let Err(e) = result {
        eprintln!("reel progress: writing {}: {e}", file.display());
    }
}

/// Reads `progress.json` from `data_dir` (None: kept in memory only). What
/// was recorded in memory before keeps, unless the file has it newer.
pub fn init(data_dir: Option<&Path>) {
    let file = data_dir.map(|d| d.join("progress.json"));
    let read: Saved = file
        .as_deref()
        .and_then(|f| std::fs::read_to_string(f).ok())
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default();
    with(|s| {
        for (k, e) in read.entries {
            match s.saved.entries.get(&k) {
                Some(mine) if mine.order() >= e.order() => {}
                _ => {
                    s.saved.entries.insert(k, e);
                }
            }
        }
        for (title, pref) in read.subtitles {
            s.saved.subtitles.entry(title).or_insert(pref);
        }
        s.file = file;
    });
}

/// Records `position` of `duration` seconds of `key` (what plays: title
/// `title`, and the episode if it is one). Whether it now counts as watched.
pub fn save(key: &str, title: &str, episode: Option<(u32, u32)>, position: f64, duration: f64, now: i64) -> bool {
    if !position.is_finite() || !duration.is_finite() || duration <= 0.0 {
        return false;
    }
    let position = position.clamp(0.0, duration);
    let watched = position >= duration * WATCHED_AT;
    with(|s| {
        if position < MIN_POSITION && !s.saved.entries.contains_key(key) {
            return;
        }
        // Once seen, starting it again from the top does not unsee it.
        let was = s.saved.entries.get(key).is_some_and(|e| e.watched);
        let seq = s.saved.entries.values().map(|e| e.seq).max().unwrap_or(0) + 1;
        s.saved.entries.insert(
            key.to_owned(),
            Entry {
                title: title.to_owned(),
                season: episode.map(|e| e.0),
                episode: episode.map(|e| e.1),
                position,
                duration,
                updated_at: now,
                seq,
                watched: watched || (was && position < MIN_POSITION),
            },
        );
        if let Some(file) = &s.file {
            write(file, &s.saved);
        }
    });
    watched
}

pub fn get(key: &str) -> Option<Entry> {
    with(|s| s.saved.entries.get(key).cloned())
}

/// Where to start `key`: where the viewer stopped, unless they watched it.
pub fn start_at(key: &str) -> f64 {
    get(key).filter(|e| !e.watched).map_or(0.0, |e| e.position)
}

/// The latest entry of each title, newest first: `(key, entry)`.
pub fn recent() -> Vec<(String, Entry)> {
    let mut latest: HashMap<String, (String, Entry)> = HashMap::new();
    with(|s| {
        for (k, e) in &s.saved.entries {
            match latest.get(&e.title) {
                Some((_, l)) if l.order() >= e.order() => {}
                _ => {
                    latest.insert(e.title.clone(), (k.clone(), e.clone()));
                }
            }
        }
    });
    let mut out: Vec<_> = latest.into_values().collect();
    out.sort_by(|a, b| b.1.order().cmp(&a.1.order()));
    out
}

/// The subtitles last chosen for `title` (see `Saved::subtitles`).
pub fn subtitle_pref(title: &str) -> Option<String> {
    with(|s| s.saved.subtitles.get(title).cloned())
}

/// Remembers the subtitles chosen for `title`.
pub fn set_subtitle_pref(title: &str, pref: &str) {
    with(|s| {
        if s.saved.subtitles.get(title).map(String::as_str) == Some(pref) {
            return;
        }
        s.saved.subtitles.insert(title.to_owned(), pref.to_owned());
        if let Some(file) = &s.file {
            write(file, &s.saved);
        }
    });
}

/// The latest entry of `title`.
pub fn latest(title: &str) -> Option<(String, Entry)> {
    recent().into_iter().find(|(_, e)| e.title == title)
}

#[cfg(test)]
pub fn clear() {
    with(|s| {
        s.file = None;
        s.saved = Saved::default();
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    // One test: the store is process-wide.
    #[test]
    fn records_resumes_marks_watched_and_persists() {
        let _guard = crate::application::catalog::TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        clear();
        let dir = std::env::temp_dir().join(format!("reel-progress-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        init(Some(&dir));

        // A few seconds in is not remembered.
        assert!(!save("tmdb:movie:603", "tmdb:movie:603", None, 4.0, 8160.0, 100));
        assert!(get("tmdb:movie:603").is_none());

        assert!(!save("tmdb:movie:603", "tmdb:movie:603", None, 2472.0, 8160.0, 110));
        assert_eq!(start_at("tmdb:movie:603"), 2472.0);
        let e = get("tmdb:movie:603").unwrap();
        assert_eq!(e.minutes_left(), 95);
        assert!((e.fraction() - 0.303).abs() < 0.001);

        // Episodes of a show: the latest one is where the viewer is.
        save("tmdb:tv:1399:s1e1", "tmdb:tv:1399", Some((1, 1)), 3000.0, 3200.0, 120);
        save("tmdb:tv:1399:s1e2", "tmdb:tv:1399", Some((1, 2)), 600.0, 3200.0, 130);
        assert!(get("tmdb:tv:1399:s1e1").unwrap().watched, "94% is watched");
        assert_eq!(start_at("tmdb:tv:1399:s1e1"), 0.0, "a watched episode starts over");
        let (key, latest) = latest("tmdb:tv:1399").unwrap();
        assert_eq!((key.as_str(), latest.episode), ("tmdb:tv:1399:s1e2", Some(2)));
        let order: Vec<_> = recent().into_iter().map(|(_, e)| e.title).collect();
        assert_eq!(order, vec!["tmdb:tv:1399", "tmdb:movie:603"]);

        // Watched at 90%.
        assert!(save("tmdb:movie:603", "tmdb:movie:603", None, 7400.0, 8160.0, 140));
        assert_eq!(start_at("tmdb:movie:603"), 0.0);

        // Bad numbers are ignored.
        assert!(!save("x", "x", None, f64::NAN, 100.0, 150));
        assert!(get("x").is_none());

        // Saved to the data directory and read back.
        clear();
        assert!(get("tmdb:movie:603").is_none());
        init(Some(&dir));
        assert!(get("tmdb:movie:603").unwrap().watched);
        assert_eq!(get("tmdb:tv:1399:s1e2").unwrap().position, 600.0);

        clear();
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
