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

use crate::wiring::playback;
use reel_domain::subtitles::files;
use reel_domain::{redact::redact_keys, search::Source};

/// Choices for the playback buffer, MiB.
pub const BUFFER_CHOICES: [u32; 5] = [128, 256, 512, 1024, 2048];
/// The buffer when the free space cannot be read.
pub const DEFAULT_BUFFER_MB: u32 = 256;
/// The share of the free space the recommended buffer may take: a TV with about 1.5 GB to spare
/// gets 256 MB, a computer with tens of gigabytes the largest choice.
const RECOMMENDED_SHARE: f64 = 0.2;

/// The buffer recommended for `free` bytes of free space: the largest choice within
/// `RECOMMENDED_SHARE` of it, at least the smallest; `DEFAULT_BUFFER_MB` when it is unknown.
fn recommended_mb(free: Option<u64>) -> u32 {
    let Some(free) = free else { return DEFAULT_BUFFER_MB };
    let room = free as f64 * RECOMMENDED_SHARE / (1024.0 * 1024.0);
    BUFFER_CHOICES.iter().copied().filter(|c| f64::from(*c) <= room).max().unwrap_or(BUFFER_CHOICES[0])
}

/// The buffer recommended for this device's free space (where the engine keeps its cache).
pub fn recommended_buffer() -> u32 {
    recommended_mb(playback().check_space()["free"].as_u64())
}
pub const DEFAULT_LANGUAGE: &str = "en";

/// Where the top nav's group (the pills and the round buttons after them) sits in its bar on a
/// TV and a desktop: after the logo, in the middle, or at the right edge.
pub const NAV_POSITIONS: [&str; 3] = ["left", "center", "right"];
pub const DEFAULT_NAV_POSITION: &str = "right";
/// What shows on the player's stage while a film starts: nothing but its lines (the default), or
/// the running dinosaur.
pub const LOADERS: [&str; 2] = ["none", "dinosaur"];
pub const DEFAULT_LOADER: &str = "none";
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
    /// The audio language (ISO 639-1) the viewer last picked a track in; empty: the app's.
    audio_language: String,
    /// The user's search source: a Torznab endpoint and its key (may be empty).
    source_url: String,
    source_key: String,
    /// The player shows the stream's speed, people and what is ready ahead.
    stream_details: bool,
    /// Where the top nav sits (one of `NAV_POSITIONS`).
    nav_position: String,
    /// The loading animation (one of `LOADERS`).
    loader: String,
    /// The build's default source (`DEFAULT_SOURCE`) was put in once; clearing it later keeps it out.
    default_source_used: bool,
    /// The first-run setup (language, buffer, source) was gone through. None in a file written
    /// before the setup existed: `load` takes such a file for set up.
    setup_done: Option<bool>,
}

/// A search source compiled into a developer's own build (dev/tizen-local.sh, from
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
            audio_language: String::new(),
            source_url: String::new(),
            source_key: String::new(),
            stream_details: false,
            nav_position: DEFAULT_NAV_POSITION.to_owned(),
            loader: DEFAULT_LOADER.to_owned(),
            default_source_used: false,
            setup_done: None,
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
        if !NAV_POSITIONS.contains(&self.nav_position.as_str()) {
            self.nav_position = DEFAULT_NAV_POSITION.to_owned();
        }
        // The blinking "reel" logotype was a loader once: a file that kept it shows none.
        if self.loader == "logo" {
            self.loader = "none".to_owned();
        }
        if !LOADERS.contains(&self.loader.as_str()) {
            self.loader = DEFAULT_LOADER.to_owned();
        }
        if !self.audio_language.is_empty() && !is_audio_language(&self.audio_language) {
            self.audio_language.clear();
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
    let waiting = crate::application::catalog::runtime().spawn(async move {
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
        tracing::warn!("reel settings: writing {}: {e}", file.display());
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

/// Android: the process's temp dir (`std::env::temp_dir`, where the engine keeps its cache and
/// the TV's card pictures go) is /data/local/tmp, which an app may not write, so the engine
/// could not start. It goes into the app's own data dir, as the TV's host does with TMPDIR.
#[cfg(target_os = "android")]
fn android_temp_dir(data_dir: &Path) {
    if std::env::var_os("TMPDIR").is_some() {
        return;
    }
    let tmp = data_dir.join("tmp");
    if std::fs::create_dir_all(&tmp).is_ok() {
        // Set once, at the first load, before the engine or anything reads it.
        unsafe { std::env::set_var("TMPDIR", &tmp) };
    }
}

/// The content language a new install starts with: the first of the system's `languages`
/// (BCP 47 tags, most preferred first) that `CONTENT_LANGUAGES` has, by its full tag, else by its
/// base language ("ru" → "ru-RU"); else `DEFAULT_CONTENT_LANGUAGE`.
pub fn system_content_language(languages: &[String]) -> &'static str {
    let base = |tag: &str| tag.split(['-', '_']).next().unwrap_or_default().to_ascii_lowercase();
    languages
        .iter()
        .find_map(|l| {
            let l = l.replace('_', "-");
            CONTENT_LANGUAGES
                .iter()
                .find(|(tag, _)| tag.eq_ignore_ascii_case(&l))
                .or_else(|| CONTENT_LANGUAGES.iter().find(|(tag, _)| base(tag) == base(&l)))
                .map(|(tag, _)| *tag)
        })
        .unwrap_or(DEFAULT_CONTENT_LANGUAGE)
}

/// Reads the settings from `data_dir` (None: defaults, kept in memory),
/// configures the engine from them and returns what the UI needs (`current`). A new install
/// starts in the system's language (`languages`, see `system_content_language`).
pub fn load(data_dir: Option<&Path>, languages: &[String]) -> Value {
    #[cfg(target_os = "android")]
    if let Some(dir) = data_dir {
        android_temp_dir(dir);
    }
    let file = data_dir.map(|d| d.join("settings.json"));
    if file.is_none() {
        tracing::warn!("reel settings: no data directory, settings last until the app closes");
    }
    let existed = file.as_deref().is_some_and(Path::exists);
    let before = file.as_deref().map(read).unwrap_or_default();
    let mut saved = with_default_source(before.clone(), DEFAULT_SOURCE);
    // Settings from before the setup existed: that viewer has set reel up already. Without a
    // data dir nothing would remember the setup either: it would show on every start, so none.
    saved.setup_done = Some(saved.setup_done.unwrap_or(existed || file.is_none()));
    // A new install starts with the buffer its free space recommends.
    if !existed {
        saved.buffer_mb = recommended_buffer();
        saved.content_language = system_content_language(languages).to_owned();
    }
    if let (Some(f), true) = (&file, saved.default_source_used != before.default_source_used) {
        write(f, &saved);
    }
    playback().set_buffer_mb(saved.buffer_mb as u64);
    with(|s| {
        s.file = file;
        s.saved = saved;
        s.loaded = true;
    });
    bump();
    current()
}

/// The settings as the UI shows them, from memory:
/// `{"language","contentLanguage","contentLanguages":[{"tag","name"}],"audioLanguage" (ISO
/// 639-1, "": the app's),"audioLanguages":[codes],"bufferMB",
/// "streamDetails","navPosition","loader","setupDone","source":{"url","hasKey"},"bufferChoices":[{"mb","default"}]}`.
pub fn current() -> Value {
    let saved = with(|s| s.saved.clone());
    let recommended = recommended_buffer();
    let choices: Vec<Value> = buffer_choices().into_iter().map(|c| json!({ "mb": c, "default": c == recommended })).collect();
    json!({
        "language": saved.language,
        "contentLanguage": saved.content_language,
        "contentLanguages": CONTENT_LANGUAGES
            .iter()
            .map(|(tag, name)| json!({ "tag": tag, "name": name }))
            .collect::<Vec<_>>(),
        "audioLanguage": saved.audio_language,
        "audioLanguages": files::known().collect::<Vec<_>>(),
        "bufferMB": saved.buffer_mb,
        "streamDetails": saved.stream_details,
        "navPosition": saved.nav_position,
        "loader": saved.loader,
        "setupDone": saved.setup_done.unwrap_or(false),
        "source": source_json(&saved),
        "bufferChoices": choices,
    })
}

/// The buffer sizes this device has room for (the smallest always).
pub fn buffer_choices() -> Vec<u32> {
    BUFFER_CHOICES
        .iter()
        .enumerate()
        .filter(|(i, c)| *i == 0 || playback().buffer_fits(**c as u64))
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
    playback().set_buffer_mb(mb as u64);
    bump();
    mb
}

/// The first-run setup is done: it does not show again.
pub fn finish_setup() {
    with(|s| {
        s.saved.setup_done = Some(true);
        save(s);
    });
    bump();
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

/// Saves where the top nav sits if it is one of `NAV_POSITIONS`; the position in effect.
pub fn set_nav_position(position: &str) -> String {
    let now = with(|s| {
        if NAV_POSITIONS.contains(&position) {
            s.saved.nav_position = position.to_owned();
            save(s);
        }
        s.saved.nav_position.clone()
    });
    bump();
    now
}

/// Saves the loading animation if it is one of `LOADERS`; the one in effect.
pub fn set_loader(loader: &str) -> String {
    let now = with(|s| {
        if LOADERS.contains(&loader) {
            s.saved.loader = loader.to_owned();
            save(s);
        }
        s.saved.loader.clone()
    });
    bump();
    now
}

/// The search source as the UI may show it: the address, and whether a key is
/// set (never the key itself).
fn source_json(saved: &Saved) -> Value {
    json!({ "url": saved.source_url, "hasKey": !saved.source_key.is_empty() })
}

/// The user's search source, if they entered one.
pub fn source() -> Option<Source> {
    with(|s| {
        let url = s.saved.source_url.trim().to_owned();
        (!url.is_empty()).then(|| Source {
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
        crate::application::catalog::source_changed();
    }
    bump();
    Ok(shown)
}

/// An address the source may have: empty (none), or http(s).
pub fn check_url(url: &str) -> Result<(), String> {
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
    with(|s| redact_keys(&s.saved.source_url))
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

/// The app's language (ISO 639-1): the UI shows the content language's (`showUiIn` in
/// ui/preferences.ts: one setting for both), so its base, "pt" for "pt-BR".
pub fn ui_language() -> String {
    let tag = content_language();
    tag.split('-').next().unwrap_or("en").to_owned()
}

/// Whether `code` is a language a track can be told to be in (`files::known`).
pub fn is_audio_language(code: &str) -> bool {
    files::known().any(|c| c == code)
}

/// The audio language the viewer picked last; None: the app's (`ui_language`).
pub fn audio_language() -> Option<String> {
    with(|s| (!s.saved.audio_language.is_empty()).then(|| s.saved.audio_language.clone()))
}

/// The language audio is looked for in: the one picked last, else the app's.
pub fn wanted_audio_language() -> String {
    audio_language().unwrap_or_else(ui_language)
}

/// Saves the audio language (a code of `files::known`; "" goes back to the app's; another value is
/// refused); the setting in effect ("" for the app's).
pub fn set_audio_language(code: &str) -> String {
    let now = with(|s| {
        if code.is_empty() || is_audio_language(code) {
            if s.saved.audio_language != code {
                s.saved.audio_language = code.to_owned();
                save(s);
            }
        }
        s.saved.audio_language.clone()
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
mod system_language_tests {
    use super::{DEFAULT_CONTENT_LANGUAGE, system_content_language};

    fn pick(languages: &[&str]) -> &'static str {
        system_content_language(&languages.iter().map(|l| (*l).to_owned()).collect::<Vec<_>>())
    }

    #[test]
    fn a_new_install_takes_the_first_system_language_reel_has() {
        assert_eq!(pick(&["pt-BR"]), "pt-BR", "the full tag");
        assert_eq!(pick(&["ru"]), "ru-RU", "the base language");
        assert_eq!(pick(&["de-AT"]), "de-DE");
        assert_eq!(pick(&["zh_CN"]), "zh-CN");
        assert_eq!(pick(&["xx-XX", "uk-UA", "en-US"]), "uk-UA", "the first one it has");
        assert_eq!(pick(&["en-GB", "ru-RU"]), "en-US", "the most preferred wins over a full tag further down");
        assert_eq!(pick(&["xx"]), DEFAULT_CONTENT_LANGUAGE);
        assert_eq!(pick(&[]), DEFAULT_CONTENT_LANGUAGE);
    }
}

#[cfg(test)]
mod recommended_tests {
    use super::recommended_mb;
    const GB: u64 = 1024 * 1024 * 1024;

    #[test]
    fn the_recommended_buffer_follows_the_free_space() {
        assert_eq!(recommended_mb(None), 256, "unknown: the default");
        assert_eq!(recommended_mb(Some(GB / 2)), 128, "little room: the smallest");
        assert_eq!(recommended_mb(Some(GB + GB / 2)), 256, "a TV's 1.5 GB");
        assert_eq!(recommended_mb(Some(6 * GB)), 1024);
        assert_eq!(recommended_mb(Some(100 * GB)), 2048, "a computer: the largest");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn setup_shows_once_on_a_new_install_and_never_to_who_had_settings() {
        let _guard = crate::application::catalog::TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let dir = std::env::temp_dir().join(format!("reel-setup-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        // A new install: setup shows, and still after a setting is saved before it is done.
        assert_eq!(load(Some(&dir), &[])["setupDone"], false);
        set_buffer_mb(512);
        assert_eq!(load(Some(&dir), &[])["setupDone"], false);
        finish_setup();
        assert_eq!(load(Some(&dir), &[])["setupDone"], true);
        // Without a data dir (nothing remembers it): no setup.
        assert_eq!(load(None, &[])["setupDone"], true);
        // Settings written before the setup existed (no setupDone in the file): set up already.
        std::fs::write(dir.join("settings.json"), r#"{"bufferMb":512,"language":"en"}"#).unwrap();
        assert_eq!(load(Some(&dir), &[])["setupDone"], true);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn saves_and_loads_from_the_data_dir() {
        let _guard = crate::application::catalog::TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let dir = std::env::temp_dir().join(format!("reel-settings-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);

        let first = load(Some(&dir), &[]);
        // A new install: the buffer its free space recommends (the one the choices mark).
        assert_eq!(first["bufferMB"], recommended_buffer());
        assert!(first["bufferChoices"].as_array().unwrap().iter().any(|c| c["default"] == true && c["mb"] == first["bufferMB"]));
        assert_eq!(first["language"], "en");
        assert_eq!(first["bufferChoices"].as_array().unwrap().len(), BUFFER_CHOICES.len());

        assert_eq!(set_buffer_mb(1024), 1024);
        assert_eq!(set_buffer_mb(333), 1024, "a size not offered is refused");
        assert_eq!(playback().buffer_mb(), 1024);

        let again = load(Some(&dir), &[]);
        assert_eq!(again["bufferMB"], 1024);

        // A broken file falls back to the defaults.
        std::fs::write(dir.join("settings.json"), "{ not json").unwrap();
        assert_eq!(load(Some(&dir), &[])["bufferMB"], DEFAULT_BUFFER_MB);

        // The source: a bad address is refused, the key is never shown.
        load(Some(&dir), &[]);
        assert!(set_source("not a url", "").is_err());
        let shown = set_source("http://192.168.1.10:9117/api/v2.0/indexers/all/results/torznab/api", "secret").unwrap();
        assert_eq!(shown["hasKey"], true);
        assert!(!shown.to_string().contains("secret"));
        assert_eq!(source().unwrap().key.as_deref(), Some("secret"));
        assert_eq!(load(Some(&dir), &[])["source"]["hasKey"], true);
        set_source("", "").unwrap();
        assert!(source().is_none());

        // Content language: one of the list, kept across loads.
        assert_eq!(load(Some(&dir), &[])["contentLanguage"], DEFAULT_CONTENT_LANGUAGE);
        assert_eq!(set_content_language("ru-RU"), "ru-RU");
        assert_eq!(set_content_language("xx-XX"), "ru-RU", "an unknown tag is refused");
        assert_eq!(load(Some(&dir), &[])["contentLanguage"], "ru-RU");
        set_content_language(DEFAULT_CONTENT_LANGUAGE);
        // A kept content language stays whatever the system's.
        assert_eq!(load(Some(&dir), &["ru-RU".to_owned()])["contentLanguage"], DEFAULT_CONTENT_LANGUAGE);

        // Audio language: the app's until one is picked; a known code, kept across loads.
        assert_eq!(load(Some(&dir), &[])["audioLanguage"], "");
        assert_eq!(wanted_audio_language(), "en");
        set_content_language("pt-BR");
        assert_eq!(wanted_audio_language(), "pt", "the app's language, the content language's base");
        set_content_language(DEFAULT_CONTENT_LANGUAGE);
        assert_eq!(set_audio_language("kk"), "kk");
        assert_eq!(set_audio_language("jav"), "kk", "an unknown code is refused");
        assert_eq!(load(Some(&dir), &[])["audioLanguage"], "kk");
        assert_eq!(wanted_audio_language(), "kk");
        assert_eq!(set_audio_language(""), "", "back to the app's");
        assert_eq!(audio_language(), None);
        assert!(current()["audioLanguages"].as_array().unwrap().iter().any(|c| c == "uz"));

        // Nav position and loader: one of their lists, kept across loads; missing or unknown
        // in the file: the defaults.
        assert_eq!(load(Some(&dir), &[])["navPosition"], DEFAULT_NAV_POSITION);
        assert_eq!(current()["loader"], DEFAULT_LOADER);
        assert_eq!(set_nav_position("center"), "center");
        assert_eq!(set_nav_position("top"), "center", "an unknown position is refused");
        assert_eq!(set_loader("dinosaur"), "dinosaur");
        assert_eq!(set_loader("spinner"), "dinosaur", "an unknown loader is refused");
        assert_eq!(set_loader("logo"), "dinosaur", "the logotype is no longer one");
        let again = load(Some(&dir), &[]);
        assert_eq!((again["navPosition"].as_str(), again["loader"].as_str()), (Some("center"), Some("dinosaur")));
        assert_eq!(set_loader("none"), "none");
        std::fs::write(dir.join("settings.json"), r#"{"navPosition":"top","loader":"spinner"}"#).unwrap();
        let unknown = load(Some(&dir), &[]);
        assert_eq!((unknown["navPosition"].as_str(), unknown["loader"].as_str()), (Some(DEFAULT_NAV_POSITION), Some(DEFAULT_LOADER)));

        std::fs::remove_dir_all(&dir).unwrap();
        playback().set_buffer_mb(DEFAULT_BUFFER_MB as u64);
    }

    /// The engine's cache measures the disk; without the engine every size is offered.
    #[cfg(feature = "engine")]
    #[test]
    fn only_buffers_the_device_has_room_for_are_offered() {
        assert!(playback().buffer_fits(1));
        assert!(!playback().buffer_fits(1 << 30), "a petabyte fits nowhere");
    }

    #[test]
    fn a_kept_logo_loader_reads_as_none() {
        let read = |json: &str| serde_json::from_str::<Saved>(json).unwrap().sanitized().loader;
        assert_eq!(read(r#"{"loader":"logo"}"#), "none", "the logotype loader is gone");
        assert_eq!(read(r#"{"loader":"dinosaur"}"#), "dinosaur");
        assert_eq!(read("{}"), "none", "a new install shows none");
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
        let _guard = crate::application::catalog::TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
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
