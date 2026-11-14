//! Subtitles and the tracks panel.
//!
//! - Files: the subtitle files of the playing torrent that go with its video
//!   (`files::find`) are fetched whole through the engine (a stream, so their
//!   pieces come first), decoded and parsed into cues (`parse`); the player's
//!   overlay asks for the cues on screen at its position (`cues`).
//! - The menu: Audio and Subtitles columns of the tracks panel, merged from
//!   the tracks the video view reports (mpv: embedded audio and subtitles)
//!   and the files above, with what is in use and what the view should apply.
//!   The subtitles chosen are remembered per title (`progress`).

pub mod files;
pub mod parse;
pub mod tracks;

use std::{
    collections::HashMap,
    sync::{LazyLock, Mutex},
    time::Duration,
};

use serde_json::{Value, json};
use tokio::io::AsyncReadExt;

use crate::{catalog, engine, progress};
use files::SubFile;
use parse::Cue;
use tracks::{Embedded, Track};

/// At most this many files are fetched for one video.
const MAX_FILES: usize = 16;
const FETCH_TIMEOUT: Duration = Duration::from_secs(180);

enum Loaded {
    Pending,
    Ready(Vec<Cue>),
    Failed(String),
}

#[derive(Default)]
struct JobSubs {
    /// None until the torrent's metadata is in.
    files: Option<Vec<SubFile>>,
    loaded: HashMap<usize, Loaded>,
    /// What the viewer picked in this film, by menu key.
    audio: Option<String>,
    subtitle: Option<String>,
}

static JOBS: LazyLock<Mutex<HashMap<u32, JobSubs>>> = LazyLock::new(Default::default);

/// The job ended: its cues go.
pub fn forget(job: u32) {
    JOBS.lock().unwrap().remove(&job);
}

/// The job's subtitle files, finding them (and starting their download) the
/// first time the torrent's metadata is there. None while it is not.
fn job_files(job: u32) -> Option<Vec<SubFile>> {
    if let Some(files) = JOBS.lock().unwrap().get(&job).and_then(|j| j.files.clone()) {
        return Some(files);
    }
    let (handle, video, all) = engine::playing_files(job)?;
    let found: Vec<SubFile> = files::find(&all, video).into_iter().take(MAX_FILES).collect();
    {
        let mut jobs = JOBS.lock().unwrap();
        let state = jobs.entry(job).or_default();
        if let Some(files) = &state.files {
            return Some(files.clone()); // found meanwhile by another call
        }
        state.files = Some(found.clone());
        for f in &found {
            state.loaded.insert(f.id, Loaded::Pending);
        }
    }
    // One after another: each is a reader of the engine's ring buffer, which
    // splits its readahead among readers, so the video keeps most of it.
    let files = found.clone();
    engine::spawn(async move {
        for file in files {
            if !JOBS.lock().unwrap().contains_key(&job) {
                return; // the film was closed
            }
            let result = tokio::time::timeout(FETCH_TIMEOUT, async {
                let mut stream = handle.clone().stream(file.id).await?;
                let mut bytes = Vec::new();
                stream.read_to_end(&mut bytes).await?;
                anyhow::Ok(bytes)
            })
            .await;
            let loaded = match result {
                Ok(Ok(bytes)) => Loaded::Ready(parse::parse(file.format, &parse::decode(&bytes, file.language))),
                Ok(Err(e)) => Loaded::Failed(format!("{e:#}")),
                Err(_) => Loaded::Failed("timed out".into()),
            };
            if let Loaded::Failed(e) = &loaded {
                eprintln!("reel subtitles: {}: {e}", file.path);
            }
            if let Some(state) = JOBS.lock().unwrap().get_mut(&job) {
                state.loaded.insert(file.id, loaded);
            }
        }
    });
    Some(found)
}

/// The subtitle files of what job `job` plays: `{"state":"pending"}` until
/// the torrent's metadata is in, then `{"state":"ready","files":[{"id",
/// "language" (ISO 639-1 or null),"label","format"}]}`. The first ready
/// answer starts fetching them all.
pub fn list(job: u32) -> Value {
    match job_files(job) {
        None => json!({ "state": "pending", "files": [] }),
        Some(files) => json!({
            "state": "ready",
            "files": files.iter().map(|f| json!({ "id": f.id, "language": f.language, "label": f.label, "format": f.format })).collect::<Vec<_>>(),
        }),
    }
}

/// The cues of file `id` on screen at some moment of `from..=to` seconds:
/// `{"state":"pending"|"ready"|"failed","cues":[{"start","end","text"}],
/// "text"}` (`text`: what the overlay shows, the cues' lines together).
/// The overlay asks with `from == to` at its position (the cues on screen
/// now); a wider window serves a UI that keeps a few ahead.
pub fn cues(job: u32, id: usize, from: f64, to: f64) -> Value {
    let jobs = JOBS.lock().unwrap();
    match jobs.get(&job).and_then(|j| j.loaded.get(&id)) {
        None | Some(Loaded::Pending) => json!({ "state": "pending", "cues": [] }),
        Some(Loaded::Failed(message)) => json!({ "state": "failed", "message": message, "cues": [] }),
        Some(Loaded::Ready(cues)) => {
            let on = parse::window(cues, from, to);
            let text = on.iter().map(|c| c.text.as_str()).collect::<Vec<_>>().join("\n");
            json!({ "state": "ready", "cues": on, "text": text })
        }
    }
}

/// One subtitle choice of the menu.
#[derive(Debug, Clone, PartialEq)]
enum SubOption {
    Off,
    Embedded(Track),
    External(SubFile),
}

impl SubOption {
    fn key(&self) -> String {
        match self {
            SubOption::Off => "off".into(),
            SubOption::Embedded(t) => format!("e:{}", t.id),
            SubOption::External(f) => format!("x:{}", f.id),
        }
    }

    fn language(&self) -> Option<&str> {
        match self {
            SubOption::Off => None,
            SubOption::Embedded(t) => t.language.as_deref(),
            SubOption::External(f) => f.language,
        }
    }

    /// What is remembered for the title when the viewer picks it.
    fn pref(&self) -> String {
        match self {
            SubOption::Off => "off".into(),
            _ => self.language().unwrap_or("?").to_owned(),
        }
    }

    fn json(&self, selected: bool) -> Value {
        match self {
            SubOption::Off => json!({ "key": "off", "kind": "off", "selected": selected }),
            SubOption::Embedded(t) => json!({
                "key": self.key(), "kind": "embedded", "language": t.language, "title": t.title,
                "codec": t.codec, "detail": tracks::detail(t), "forced": t.forced, "selected": selected,
            }),
            SubOption::External(f) => json!({
                "key": self.key(), "kind": "external", "language": f.language, "title": f.label,
                "format": f.format, "forced": false, "selected": selected,
            }),
        }
    }
}

/// Which subtitle option is in use: the viewer's pick in this film; else the
/// one remembered for the title (by language: an embedded track first, then a
/// file; a forced track only when nothing else has it); else an embedded
/// track the file marks as default; else off.
fn pick_subtitle(options: &[SubOption], chosen: Option<&str>, pref: Option<&str>) -> usize {
    if let Some(i) = chosen.and_then(|k| options.iter().position(|o| o.key() == k)) {
        return i;
    }
    if let Some(pref) = pref {
        if pref == "off" {
            return 0;
        }
        let wanted = (pref != "?").then_some(pref);
        let by_language = |forced_ok: bool| {
            options.iter().position(|o| {
                let forced = matches!(o, SubOption::Embedded(t) if t.forced);
                !matches!(o, SubOption::Off) && o.language() == wanted && (forced_ok || !forced)
            })
        };
        if let Some(i) = by_language(false).or_else(|| by_language(true)) {
            return i;
        }
    }
    options.iter().position(|o| matches!(o, SubOption::Embedded(t) if t.default)).unwrap_or(0)
}

/// Which audio track is in use: the viewer's pick, else the one the view
/// plays (selected), else the default one, else the first.
fn pick_audio(audio: &[Track], chosen: Option<&str>) -> Option<usize> {
    if audio.is_empty() {
        return None;
    }
    chosen
        .and_then(|k| audio.iter().position(|t| format!("a:{}", t.id) == k))
        .or_else(|| audio.iter().position(|t| t.selected))
        .or_else(|| audio.iter().position(|t| t.default))
        .or(Some(0))
}

/// The tracks panel's Audio and Subtitles columns for job `job` playing `key`
/// (a title or an episode; the subtitles are remembered per title).
/// `embedded` is what the video view reports (None where it reports no
/// tracks: then Audio is the one "original" track).
///
/// `{"pending": bool (the files are not known yet), "audio":[{"key","kind",
/// "language","title","codec","channels","selected"}], "subtitles":[{"key",
/// "kind":"off"|"embedded"|"external","language","title","codec"|"format",
/// "forced","selected"}], "apply":{"audio": track id|null, "subtitle": track
/// id|"no"|null (null: the view has no tracks), "external": file id|null (the
/// overlay shows it)}}`.
pub fn menu(job: u32, key: &str, embedded: Option<&Embedded>) -> Value {
    let files = job_files(job);
    let (title, _) = catalog::parse_key(key);
    let (chosen_audio, chosen_sub) = {
        let jobs = JOBS.lock().unwrap();
        let j = jobs.get(&job);
        (j.and_then(|j| j.audio.clone()), j.and_then(|j| j.subtitle.clone()))
    };
    let options = sub_options(embedded, files.as_deref().unwrap_or_default());
    let pref = progress::subtitle_pref(title);
    let sub = pick_subtitle(&options, chosen_sub.as_deref(), pref.as_deref());

    let (audio_json, audio_id) = match embedded {
        Some(e) if !e.audio.is_empty() => {
            let at = pick_audio(&e.audio, chosen_audio.as_deref());
            let rows: Vec<Value> = e
                .audio
                .iter()
                .enumerate()
                .map(|(i, t)| {
                    json!({
                        "key": format!("a:{}", t.id), "kind": "embedded", "language": t.language, "title": t.title,
                        "codec": t.codec, "channels": t.channels, "detail": tracks::detail(t), "selected": Some(i) == at,
                    })
                })
                .collect();
            (rows, at.map(|i| json!(e.audio[i].id)).unwrap_or(Value::Null))
        }
        _ => (vec![json!({ "key": "original", "kind": "original", "selected": true })], Value::Null),
    };
    let subtitle = match (&options[sub], embedded) {
        (_, None) => Value::Null,
        (SubOption::Embedded(t), Some(_)) => json!(t.id),
        _ => json!("no"),
    };
    let external = match &options[sub] {
        SubOption::External(f) => json!(f.id),
        _ => Value::Null,
    };
    json!({
        "pending": files.is_none(),
        "audio": audio_json,
        "subtitles": options.iter().enumerate().map(|(i, o)| o.json(i == sub)).collect::<Vec<_>>(),
        "apply": { "audio": audio_id, "subtitle": subtitle, "external": external },
    })
}

fn sub_options(embedded: Option<&Embedded>, files: &[SubFile]) -> Vec<SubOption> {
    let mut options = vec![SubOption::Off];
    if let Some(e) = embedded {
        // Files mpv loaded itself are ours to show, not its.
        options.extend(e.subtitles.iter().filter(|t| !t.external).cloned().map(SubOption::Embedded));
    }
    options.extend(files.iter().cloned().map(SubOption::External));
    options
}

/// The viewer picked `choice` (a menu key) in the panel for job `job`
/// playing `key`. A subtitle pick is remembered for the title. The menu
/// after it (as `menu`).
pub fn choose(job: u32, key: &str, embedded: Option<&Embedded>, choice: &str) -> Value {
    if choice.starts_with("a:") {
        JOBS.lock().unwrap().entry(job).or_default().audio = Some(choice.to_owned());
    } else {
        let files = job_files(job).unwrap_or_default();
        let options = sub_options(embedded, &files);
        if let Some(option) = options.iter().find(|o| o.key() == choice) {
            JOBS.lock().unwrap().entry(job).or_default().subtitle = Some(choice.to_owned());
            progress::set_subtitle_pref(catalog::parse_key(key).0, &option.pref());
        }
    }
    menu(job, key, embedded)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn track(id: i64, language: Option<&str>) -> Track {
        Track { id, language: language.map(String::from), ..Default::default() }
    }

    fn file(id: usize, language: Option<&'static str>) -> SubFile {
        SubFile { id, path: format!("f{id}.srt"), format: parse::Format::Srt, language, label: String::new() }
    }

    fn opts() -> Vec<SubOption> {
        let forced = Track { forced: true, ..track(3, Some("en")) };
        vec![
            SubOption::Off,
            SubOption::Embedded(forced),
            SubOption::Embedded(track(4, Some("en"))),
            SubOption::Embedded(Track { default: true, ..track(5, Some("de")) }),
            SubOption::External(file(9, Some("ru"))),
            SubOption::External(file(10, None)),
        ]
    }

    #[test]
    fn subtitle_choice_order() {
        let o = opts();
        // The pick in this film wins.
        assert_eq!(pick_subtitle(&o, Some("x:9"), Some("en")), 4);
        // Remembered by language: a full track before a forced one, an embedded one before a file.
        assert_eq!(pick_subtitle(&o, None, Some("en")), 2);
        assert_eq!(pick_subtitle(&o, None, Some("ru")), 4);
        assert_eq!(pick_subtitle(&o, None, Some("?")), 5);
        assert_eq!(pick_subtitle(&o, None, Some("off")), 0);
        // Nothing remembered: the file's default track; nothing marked: off.
        assert_eq!(pick_subtitle(&o, None, None), 3);
        assert_eq!(pick_subtitle(&o[..3], None, None), 0);
        // A remembered language this film does not have: as if nothing was remembered.
        assert_eq!(pick_subtitle(&o, None, Some("ja")), 3);
    }

    #[test]
    fn audio_choice_order() {
        let a = vec![track(1, Some("en")), Track { default: true, ..track(2, Some("ru")) }, Track { selected: true, ..track(3, None) }];
        assert_eq!(pick_audio(&a, Some("a:1")), Some(0));
        assert_eq!(pick_audio(&a, None), Some(2));
        assert_eq!(pick_audio(&a[..2], None), Some(1));
        assert_eq!(pick_audio(&[], None), None);
    }

    #[test]
    fn menu_without_a_torrent_and_without_tracks() {
        let _lock = catalog::TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        // Job 0 plays nothing: no files yet, the one original audio track.
        let m = menu(0, "tmdb:movie:1", None);
        assert_eq!(m["pending"], true);
        assert_eq!(m["audio"][0]["key"], "original");
        assert_eq!(m["subtitles"].as_array().unwrap().len(), 1);
        assert_eq!(m["apply"]["subtitle"], Value::Null);

        // With mpv's tracks: the remembered language picks the embedded track.
        progress::set_subtitle_pref("tmdb:movie:1", "de");
        let e = Embedded { audio: vec![track(1, Some("en"))], subtitles: vec![track(2, Some("en")), track(3, Some("de"))] };
        let m = menu(0, "tmdb:movie:1:s1e2", Some(&e));
        assert_eq!(m["apply"]["subtitle"], 3);
        assert_eq!(m["apply"]["audio"], 1);
        assert_eq!(m["subtitles"][2]["selected"], true);

        // Choosing off is remembered for the title (not the episode).
        let m = choose(0, "tmdb:movie:1:s1e3", Some(&e), "off");
        assert_eq!(m["apply"]["subtitle"], "no");
        assert_eq!(progress::subtitle_pref("tmdb:movie:1").as_deref(), Some("off"));
        forget(0);
    }

    /// Sintel's open torrent carries .srt files in several languages. Needs
    /// the network: `cargo test -- --ignored smoke_sintel_subtitles --nocapture`.
    #[test]
    #[ignore]
    fn smoke_sintel_subtitles() {
        use std::time::Instant;
        // Sintel (Blender Foundation, CC BY 3.0), as in the engine's smoke test.
        const SINTEL: &str = "magnet:?xt=urn:btih:08ada5a7a6183aae1e09d831df6748d566095a10&dn=Sintel&tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337&tr=udp%3A%2F%2Fexplodie.org%3A6969&xs=https%3A%2F%2Fwebtorrent.io%2Ftorrents%2Fsintel.torrent";
        let job = engine::add(SINTEL).expect("added");
        let started = Instant::now();
        let files = loop {
            let l = list(job);
            if l["state"] == "ready" {
                break l["files"].clone();
            }
            assert!(started.elapsed() < Duration::from_secs(120), "no metadata");
            std::thread::sleep(Duration::from_millis(500));
        };
        println!("files after {:?}: {files}", started.elapsed());
        let en = files.as_array().unwrap().iter().find(|f| f["language"] == "en").expect("an English file");
        let id = en["id"].as_u64().unwrap() as u32;
        let cue = loop {
            let c = cues(job, id as usize, 0.0, 900.0);
            if c["state"] == "ready" {
                break c;
            }
            assert_ne!(c["state"], "failed", "{c}");
            assert!(started.elapsed() < Duration::from_secs(240), "not fetched");
            std::thread::sleep(Duration::from_millis(500));
        };
        println!("fetched after {:?}: {} cues in the first 15 min", started.elapsed(), cue["cues"].as_array().unwrap().len());
        assert!(!cue["cues"].as_array().unwrap().is_empty());
        engine::close(job);
    }

    #[test]
    fn cues_of_an_unknown_job_are_pending() {
        assert_eq!(cues(12345, 1, 0.0, 0.0)["state"], "pending");
        assert_eq!(list(12345)["state"], "pending");
    }

    #[test]
    fn cues_in_a_window_once_loaded() {
        let srt = parse::parse(parse::Format::Srt, include_str!("fixtures/sample.srt"));
        JOBS.lock().unwrap().entry(777).or_default().loaded.insert(4, Loaded::Ready(srt));
        let now = cues(777, 4, 2.0, 2.0);
        assert_eq!(now["state"], "ready");
        assert_eq!(now["cues"][0]["text"], "The lighthouse keeper\nwaves from the rock.");
        assert_eq!(now["text"], now["cues"][0]["text"]);
        assert_eq!(cues(777, 4, 5.0, 5.0)["cues"].as_array().unwrap().len(), 0);
        forget(777);
        assert_eq!(cues(777, 4, 2.0, 2.0)["state"], "pending");
    }
}
