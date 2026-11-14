//! The user's settings, kept by the core in `settings.json` in the app's data
//! directory (the UI hands the directory over once, from `process.dataDir`:
//! NSH's own storage cannot be used from a `#[module]`, which runs off the
//! UI thread). The engine reads the buffer size from here.

use std::{
    path::{Path, PathBuf},
    sync::Mutex,
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
}

static STATE: Mutex<Option<State>> = Mutex::new(None);

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
    let state = guard.get_or_insert_with(|| State { file: None, saved: Saved::default() });
    f(state)
}

/// Reads the settings from `data_dir` (None: defaults, kept in memory),
/// configures the engine from them and returns what the UI needs:
/// `{"language","bufferMB","bufferChoices":[{"mb","default"}]}`.
pub fn load(data_dir: Option<&Path>) -> Value {
    let file = data_dir.map(|d| d.join("settings.json"));
    if file.is_none() {
        eprintln!("reel settings: no data directory, settings last until the app closes");
    }
    let saved = file.as_deref().map(read).unwrap_or_default();
    engine::set_buffer_mb(saved.buffer_mb as u64);
    with(|s| {
        s.file = file;
        s.saved = saved.clone();
    });
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
        "bufferChoices": BUFFER_CHOICES
            .iter()
            .map(|c| json!({ "mb": c, "default": *c == DEFAULT_BUFFER_MB }))
            .collect::<Vec<_>>(),
    })
}

/// Saves a buffer size from `BUFFER_CHOICES` and hands it to the engine;
/// another value is refused. The size in effect.
pub fn set_buffer_mb(mb: u32) -> u32 {
    let mb = with(|s| {
        if BUFFER_CHOICES.contains(&mb) {
            s.saved.buffer_mb = mb;
            if let Some(file) = &s.file {
                write(file, &s.saved);
            }
        }
        s.saved.buffer_mb
    });
    engine::set_buffer_mb(mb as u64);
    mb
}

/// Saves whether the player shows the stream's details; the value in effect.
pub fn set_stream_details(on: bool) -> bool {
    with(|s| {
        s.saved.stream_details = on;
        if let Some(file) = &s.file {
            write(file, &s.saved);
        }
        on
    })
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
    let url = url.trim();
    if !url.is_empty() {
        let parsed = reqwest::Url::parse(url).map_err(|e| format!("not an address: {e}"))?;
        if !matches!(parsed.scheme(), "http" | "https") {
            return Err("the address must start with http:// or https://".into());
        }
    }
    Ok(with(|s| {
        s.saved.source_url = url.to_owned();
        s.saved.source_key = key.trim().to_owned();
        if let Some(file) = &s.file {
            write(file, &s.saved);
        }
        source_json(&s.saved)
    }))
}

/// The language titles and descriptions are asked for (a TMDB tag like "ru-RU").
pub fn content_language() -> String {
    with(|s| s.saved.content_language.clone())
}

/// Saves the content language if it is one of `CONTENT_LANGUAGES`; the one in effect.
pub fn set_content_language(tag: &str) -> String {
    with(|s| {
        if CONTENT_LANGUAGES.iter().any(|(t, _)| *t == tag) {
            s.saved.content_language = tag.to_owned();
            if let Some(file) = &s.file {
                write(file, &s.saved);
            }
        }
        s.saved.content_language.clone()
    })
}

pub fn set_language(tag: &str) {
    with(|s| {
        s.saved.language = tag.to_owned();
        if let Some(file) = &s.file {
            write(file, &s.saved);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn saves_and_loads_from_the_data_dir() {
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
}
