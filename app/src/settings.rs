//! The user's settings, kept by the core in `settings.json` in the app's data
//! directory (the UI hands the directory over once, from `process.dataDir`:
//! NSH's own storage cannot be used from a `#[module]`, which runs off the
//! UI thread). The engine reads the buffer size from here.

use std::{
    path::{Path, PathBuf},
    sync::{
        Mutex,
        atomic::{AtomicU64, Ordering},
    },
    time::Duration,
};

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::engine;

/// Choices for the playback buffer, MiB.
pub const BUFFER_CHOICES: [u32; 5] = [128, 256, 512, 1024, 2048];
pub const DEFAULT_BUFFER_MB: u32 = 256;
pub const DEFAULT_LANGUAGE: &str = "en";
pub const DEFAULT_CONTENT_LANGUAGE: &str = "en-US";

/// Languages titles, descriptions and episode names can be shown in (TMDB
/// translations): the tag and the language's own name, which is data, not UI text.
pub const CONTENT_LANGUAGES: [(&str, &str); 12] = [
    ("en-US", "English"),
    ("ru-RU", "Русский"),
    ("uk-UA", "Українська"),
    ("pl-PL", "Polski"),
    ("de-DE", "Deutsch"),
    ("fr-FR", "Français"),
    ("es-ES", "Español"),
    ("it-IT", "Italiano"),
    ("pt-BR", "Português (Brasil)"),
    ("tr-TR", "Türkçe"),
    ("ja-JP", "日本語"),
    ("zh-CN", "中文"),
];

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct Saved {
    buffer_mb: u32,
    language: String,
    /// The language of titles, descriptions and episode names (a TMDB tag).
    content_language: String,
    /// The user's search source: a Torznab endpoint and its key (may be empty).
    source_url: String,
    source_key: String,
    /// The player shows the stream's speed, people and what is ready ahead.
    stream_details: bool,
    /// The build's default source (`DEFAULT_SOURCE`) was put in once; clearing it later keeps it out.
    default_source_used: bool,
}

/// A search source compiled into a developer's own build (scripts/tizen-local.sh, from
/// their .env): put in on the first start that has none. Release builds have none.
const DEFAULT_SOURCE: Option<(&str, &str)> = match (option_env!("REEL_DEFAULT_SOURCE_URL"), option_env!("REEL_DEFAULT_SOURCE_KEY")) {
    (Some(url), Some(key)) => Some((url, key)),
    (Some(url), None) => Some((url, "")),
    _ => None,
};

/// `saved` with the build's default source, the first time there is one and no source.
fn with_default_source(mut saved: Saved, default: Option<(&str, &str)>) -> Saved {
    if let Some((url, key)) = default.filter(|(url, _)| !url.trim().is_empty()) {
        if !saved.default_source_used && saved.source_url.is_empty() {
            saved.source_url = url.trim().to_owned();
            saved.source_key = key.trim().to_owned();
        }
        saved.default_source_used = true;
    }
    saved
}

impl Default for Saved {
    fn default() -> Self {
        Saved {
            buffer_mb: DEFAULT_BUFFER_MB,
            language: DEFAULT_LANGUAGE.to_owned(),
            content_language: DEFAULT_CONTENT_LANGUAGE.to_owned(),
            source_url: String::new(),
            source_key: String::new(),
            stream_details: false,
            default_source_used: false,
        }
    }
}

impl Saved {
    /// Values no longer offered fall back to the defaults.
    fn sanitized(mut self) -> Self {
        if !BUFFER_CHOICES.contains(&self.buffer_mb) {
            self.buffer_mb = DEFAULT_BUFFER_MB;
        }
        if !CONTENT_LANGUAGES.iter().any(|(tag, _)| *tag == self.content_language) {
            self.content_language = DEFAULT_CONTENT_LANGUAGE.to_owned();
        }
        if self.language.is_empty() {
            self.language = DEFAULT_LANGUAGE.to_owned();
        }
        self
    }
}

struct State {
    /// Where `settings.json` lives; None keeps the settings in memory only.
    file: Option<PathBuf>,
    saved: Saved,
    /// `load` ran: what is here is the user's, not the defaults.
    loaded: bool,
}

static STATE: Mutex<Option<State>> = Mutex::new(None);

/// Goes up with every change of the settings (from this device's UI or the hosted page) and
/// whenever the hosted page's pairing code appears or goes: the UI reads again.
static REV: AtomicU64 = AtomicU64::new(0);
static CHANGED: tokio::sync::Notify = tokio::sync::Notify::const_new();
/// How long `changed` waits before answering with the same revision.
const CHANGED_WAIT: Duration = Duration::from_secs(25);

pub fn revision() -> u64 {
    REV.load(Ordering::Relaxed)
}

/// Something the UI shows from here changed.
pub(crate) fn bump() {
    REV.fetch_add(1, Ordering::Relaxed);
    CHANGED.notify_waiters();
}

/// The revision once it is past `after` (at once if it already is), or the same one after
/// `CHANGED_WAIT`: the UI waits on it, so a change made on a phone shows on the TV at once.
pub async fn changed(after: u64) -> u64 {
    let waiting = crate::catalog::runtime().spawn(async move {
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

fn read(file: &Path) -> Saved {
    std::fs::read_to_string(file)
        .ok()
        .and_then(|text| serde_json::from_str::<Saved>(&text).ok())
        .unwrap_or_default()
        .sanitized()
}

fn write(file: &Path, saved: &Saved) {
    let result = std::fs::create_dir_all(file.parent().unwrap_or(Path::new(".")))
        .and_then(|_| std::fs::write(file, serde_json::to_string_pretty(saved).expect("plain data")));
    if let Err(e) = result {
        eprintln!("reel settings: writing {}: {e}", file.display());
    }
}

fn with<R>(f: impl FnOnce(&mut State) -> R) -> R {
    let mut guard = STATE.lock().unwrap();
    let state = guard.get_or_insert_with(|| State { file: None, saved: Saved::default(), loaded: false });
    f(state)
}

/// Writes the settings to their file, when they have one.
fn save(s: &State) {
    if let Some(file) = &s.file {
        write(file, &s.saved);
    }
}

/// Whether `load` ran (before it, a write would be overwritten by the file).
pub fn loaded() -> bool {
    with(|s| s.loaded)
}

/// Reads the settings from `data_dir` (None: defaults, kept in memory),
/// configures the engine from them and returns what the UI needs (`current`).
pub fn load(data_dir: Option<&Path>) -> Value {
    let file = data_dir.map(|d| d.join("settings.json"));
    if file.is_none() {
        eprintln!("reel settings: no data directory, settings last until the app closes");
    }
    let before = file.as_deref().map(read).unwrap_or_default();
    let saved = with_default_source(before.clone(), DEFAULT_SOURCE);
    if let (Some(f), true) = (&file, saved.default_source_used != before.default_source_used) {
        write(f, &saved);
    }
    engine::set_buffer_mb(saved.buffer_mb as u64);
    with(|s| {
        s.file = file;
        s.saved = saved;
        s.loaded = true;
    });
    bump();
    current()
}

/// The settings as the UI shows them, from memory:
/// `{"language","contentLanguage","contentLanguages":[{"tag","name"}],"bufferMB",
/// "streamDetails","source":{"url","hasKey"},"bufferChoices":[{"mb","default"}]}`.
pub fn current() -> Value {
    let saved = with(|s| s.saved.clone());
    json!({
        "language": saved.language,
        "contentLanguage": saved.content_language,
        "contentLanguages": CONTENT_LANGUAGES
            .iter()
            .map(|(tag, name)| json!({ "tag": tag, "name": name }))
            .collect::<Vec<_>>(),
        "bufferMB": saved.buffer_mb,
        "streamDetails": saved.stream_details,
        "source": source_json(&saved),
        "bufferChoices": buffer_choices()
            .into_iter()
            .map(|c| json!({ "mb": c, "default": c == DEFAULT_BUFFER_MB }))
            .collect::<Vec<_>>(),
    })
}

/// The buffer sizes this device has room for (the smallest always).
pub fn buffer_choices() -> Vec<u32> {
    BUFFER_CHOICES
        .iter()
        .enumerate()
        .filter(|(i, c)| *i == 0 || engine::buffer_fits(**c as u64))
        .map(|(_, c)| *c)
        .collect()
}

/// Saves a buffer size from `BUFFER_CHOICES` and hands it to the engine;
/// another value is refused. The size in effect.
pub fn set_buffer_mb(mb: u32) -> u32 {
    let mb = with(|s| {
        if BUFFER_CHOICES.contains(&mb) {
            s.saved.buffer_mb = mb;
            save(s);
        }
        s.saved.buffer_mb
    });
    engine::set_buffer_mb(mb as u64);
    bump();
    mb
}

/// Saves whether the player shows the stream's details; the value in effect.
pub fn set_stream_details(on: bool) -> bool {
    with(|s| {
        s.saved.stream_details = on;
        save(s);
    });
    bump();
    on
}

/// The search source as the UI may show it: the address, and whether a key is
/// set (never the key itself).
fn source_json(saved: &Saved) -> Value {
    json!({ "url": saved.source_url, "hasKey": !saved.source_key.is_empty() })
}

/// The user's search source, if they entered one.
pub fn source() -> Option<crate::sources::Source> {
    with(|s| {
        let url = s.saved.source_url.trim().to_owned();
        (!url.is_empty()).then(|| crate::sources::Source {
            url,
            key: (!s.saved.source_key.is_empty()).then(|| s.saved.source_key.clone()),
        })
    })
}

/// Saves the search source. A URL that does not parse is refused with an error.
pub fn set_source(url: &str, key: &str) -> Result<Value, String> {
    set_source_with(url, Some(key))
}

/// Saves the search source; `key` None keeps the saved key. A URL that does not parse is
/// refused with an error. A new source drops what the catalog found on the old one.
pub fn set_source_with(url: &str, key: Option<&str>) -> Result<Value, String> {
    let url = url.trim();
    check_url(url)?;
    let (shown, changed) = with(|s| {
        let before = (s.saved.source_url.clone(), s.saved.source_key.clone());
        s.saved.source_url = url.to_owned();
        if let Some(key) = key {
            s.saved.source_key = key.trim().to_owned();
        }
        save(s);
        (source_json(&s.saved), before != (s.saved.source_url.clone(), s.saved.source_key.clone()))
    });
    if changed {
        crate::catalog::source_changed();
    }
    bump();
    Ok(shown)
}

/// An address the source may have: empty (none), or http(s).
fn check_url(url: &str) -> Result<(), String> {
    if !url.is_empty() {
        let parsed = reqwest::Url::parse(url).map_err(|e| format!("not an address: {e}"))?;
        if !matches!(parsed.scheme(), "http" | "https") {
            return Err("the address must start with http:// or https://".into());
        }
    }
    Ok(())
}

/// The saved source's address with key-like parameters cut out (`apikey=…`): what a page
/// off this device may see of it.
pub fn source_url_redacted() -> String {
    with(|s| engine::redact_keys(&s.saved.source_url))
}

/// As before `load` (tests of what answers only once the settings are loaded).
#[cfg(test)]
pub(crate) fn forget_loaded_for_test() {
    with(|s| s.loaded = false);
}

/// The language titles and descriptions are asked for (a TMDB tag like "ru-RU").
pub fn content_language() -> String {
    with(|s| s.saved.content_language.clone())
}

/// Whether `tag` is one of `CONTENT_LANGUAGES`.
pub fn is_content_language(tag: &str) -> bool {
    CONTENT_LANGUAGES.iter().any(|(t, _)| *t == tag)
}

/// Saves the content language if it is one of `CONTENT_LANGUAGES`; the one in effect.
pub fn set_content_language(tag: &str) -> String {
    let now = with(|s| {
        if is_content_language(tag) {
            s.saved.content_language = tag.to_owned();
            save(s);
        }
        s.saved.content_language.clone()
    });
    bump();
    now
}

pub fn set_language(tag: &str) {
    with(|s| {
        s.saved.language = tag.to_owned();
        save(s);
    });
    bump();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn saves_and_loads_from_the_data_dir() {
        let _guard = crate::catalog::TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let dir = std::env::temp_dir().join(format!("reel-settings-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);

        let first = load(Some(&dir));
        assert_eq!(first["bufferMB"], DEFAULT_BUFFER_MB);
        assert_eq!(first["language"], "en");
        assert_eq!(first["bufferChoices"].as_array().unwrap().len(), BUFFER_CHOICES.len());

        assert_eq!(set_buffer_mb(1024), 1024);
        assert_eq!(set_buffer_mb(333), 1024, "a size not offered is refused");
        assert_eq!(engine::buffer_mb(), 1024);

        let again = load(Some(&dir));
        assert_eq!(again["bufferMB"], 1024);

        // A broken file falls back to the defaults.
        std::fs::write(dir.join("settings.json"), "{ not json").unwrap();
        assert_eq!(load(Some(&dir))["bufferMB"], DEFAULT_BUFFER_MB);

        // The source: a bad address is refused, the key is never shown.
        load(Some(&dir));
        assert!(set_source("not a url", "").is_err());
        let shown = set_source("http://192.168.1.10:9117/api/v2.0/indexers/all/results/torznab/api", "secret").unwrap();
        assert_eq!(shown["hasKey"], true);
        assert!(!shown.to_string().contains("secret"));
        assert_eq!(source().unwrap().key.as_deref(), Some("secret"));
        assert_eq!(load(Some(&dir))["source"]["hasKey"], true);
        set_source("", "").unwrap();
        assert!(source().is_none());

        // Content language: one of the list, kept across loads.
        assert_eq!(load(Some(&dir))["contentLanguage"], DEFAULT_CONTENT_LANGUAGE);
        assert_eq!(set_content_language("ru-RU"), "ru-RU");
        assert_eq!(set_content_language("xx-XX"), "ru-RU", "an unknown tag is refused");
        assert_eq!(load(Some(&dir))["contentLanguage"], "ru-RU");
        set_content_language(DEFAULT_CONTENT_LANGUAGE);

        std::fs::remove_dir_all(&dir).unwrap();
        engine::set_buffer_mb(DEFAULT_BUFFER_MB as u64);
    }

    #[test]
    fn only_buffers_the_device_has_room_for_are_offered() {
        assert!(engine::buffer_fits(1));
        assert!(!engine::buffer_fits(1 << 30), "a petabyte fits nowhere");
    }

    #[test]
    fn a_builds_default_source_goes_in_once_and_never_over_the_users() {
        let d = Some(("http://192.168.1.2:9117/api", "k"));
        let first = with_default_source(Saved::default(), d);
        assert_eq!((first.source_url.as_str(), first.source_key.as_str()), ("http://192.168.1.2:9117/api", "k"));
        let cleared = Saved { source_url: String::new(), source_key: String::new(), ..first };
        assert_eq!(with_default_source(cleared, d).source_url, "", "cleared by the user: stays cleared");
        let own = Saved { source_url: "http://mine/api".into(), ..Saved::default() };
        assert_eq!(with_default_source(own, d).source_url, "http://mine/api");
        assert_eq!(with_default_source(Saved::default(), None).source_url, "");
    }

    #[test]
    fn every_change_wakes_whoever_waits() {
        let _guard = crate::catalog::TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let rt = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
        let seen = revision();
        // Already past: answers at once.
        set_stream_details(false);
        assert!(rt.block_on(changed(seen)) > seen);
        // Waiting: a change from elsewhere (a phone) wakes it.
        let now = revision();
        let waiter = std::thread::spawn(move || {
            tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap().block_on(changed(now))
        });
        std::thread::sleep(Duration::from_millis(50));
        set_buffer_mb(DEFAULT_BUFFER_MB);
        assert!(waiter.join().unwrap() > now);
        assert_eq!(current()["bufferMB"], DEFAULT_BUFFER_MB);
    }
}
