//! The Watchlist: titles the viewer keeps to watch later ("+ Watchlist" on a title), newest
//! first, kept in `watchlist.json` in the app's data directory (handed over once by
//! `Settings.load`, as the watch progress is). Home shows it as a shelf while it has anything.

use std::{
    path::{Path, PathBuf},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
struct Entry {
    /// The title's catalog id (`tmdb:movie:603`).
    id: String,
    /// Seconds since 1970.
    added: u64,
}

#[derive(Default)]
struct List {
    file: Option<PathBuf>,
    entries: Vec<Entry>,
}

impl List {
    /// The list kept in `data_dir` (None: in memory only).
    fn open(data_dir: Option<&Path>) -> List {
        let file = data_dir.map(|d| d.join("watchlist.json"));
        let entries = file
            .as_deref()
            .and_then(|f| std::fs::read(f).ok())
            .and_then(|b| serde_json::from_slice(&b).ok())
            .unwrap_or_default();
        List { file, entries }
    }

    fn write(&self) {
        let Some(file) = &self.file else { return };
        let tmp = file.with_extension("json.tmp");
        let Ok(text) = serde_json::to_vec_pretty(&self.entries) else { return };
        if std::fs::write(&tmp, text).and_then(|_| std::fs::rename(&tmp, file)).is_err() {
            tracing::warn!("reel watchlist: writing {} failed", file.display());
        }
    }

    fn contains(&self, id: &str) -> bool {
        self.entries.iter().any(|e| e.id == id)
    }

    /// Adds the title (first) or takes it off; whether it is on the list now. Written at once.
    fn toggle(&mut self, id: &str) -> bool {
        let on = if let Some(at) = self.entries.iter().position(|e| e.id == id) {
            self.entries.remove(at);
            false
        } else {
            let added = SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs());
            self.entries.insert(0, Entry { id: id.to_owned(), added });
            true
        };
        self.write();
        on
    }

    fn ids(&self) -> Vec<String> {
        self.entries.iter().map(|e| e.id.clone()).collect()
    }
}

static LIST: Mutex<List> = Mutex::new(List { file: None, entries: Vec::new() });

/// Reads `watchlist.json` from `data_dir` (None: kept in memory only).
pub fn init(data_dir: Option<&Path>) {
    *LIST.lock().unwrap() = List::open(data_dir);
}

pub fn contains(id: &str) -> bool {
    LIST.lock().unwrap().contains(id)
}

/// Adds the title or takes it off; whether it is on the list now.
pub fn toggle(id: &str) -> bool {
    LIST.lock().unwrap().toggle(id)
}

/// The titles on the list, newest first.
pub fn ids() -> Vec<String> {
    LIST.lock().unwrap().ids()
}

/// Empties the list (tests start from nothing).
#[cfg(test)]
pub fn clear() {
    LIST.lock().unwrap().entries.clear();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_list_is_kept_newest_first_and_survives_a_restart() {
        let dir = std::env::temp_dir().join(format!("reel-watchlist-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let mut list = List::open(Some(&dir));
        assert!(list.toggle("tmdb:movie:1"));
        assert!(list.toggle("tmdb:tv:2"));
        assert_eq!(list.ids(), ["tmdb:tv:2", "tmdb:movie:1"]);
        assert!(!list.toggle("tmdb:tv:2"));
        let again = List::open(Some(&dir));
        assert_eq!(again.ids(), ["tmdb:movie:1"]);
        assert!(again.contains("tmdb:movie:1"));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
