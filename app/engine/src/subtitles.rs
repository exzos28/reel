//! Subtitle files from the torrent that plays: the files that go with its video
//! (`files::find`) are fetched whole through the engine (a stream, so their pieces come
//! first), decoded and parsed into cues (`parse`); the player's overlay asks for the cues on
//! screen at its position (`cues`). The tracks panel built on them is the application's
//! (reel-app's `tracks`).

use std::{
    collections::HashMap,
    sync::{LazyLock, Mutex},
    time::Duration,
};

use serde_json::{Value, json};
use tokio::io::AsyncReadExt;

use crate::engine;
use reel_domain::subtitles::{
    files::{self, SubFile},
    parse::{self, Cue},
};

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
}

static JOBS: LazyLock<Mutex<HashMap<u32, JobSubs>>> = LazyLock::new(Default::default);

/// The job ended: its cues go.
pub fn forget(job: u32) {
    JOBS.lock().unwrap().remove(&job);
}

/// The job's subtitle files, finding them (and starting their download) the
/// first time the torrent's metadata is there. None while it is not.
pub fn job_files(job: u32) -> Option<Vec<SubFile>> {
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

#[cfg(test)]
mod tests {
    use super::*;

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
        let srt = parse::parse(parse::Format::Srt, include_str!("../../domain/src/subtitles/fixtures/sample.srt"));
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
