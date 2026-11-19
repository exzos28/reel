//! `Playback` on a build without the engine (`--no-default-features`): nothing plays here.
//! Every call answers at once, in the shapes the UI already reads for a failure, with
//! `NO_ENGINE` as the message.

use std::{
    future::Future,
    pin::Pin,
    sync::atomic::{AtomicU32, AtomicU64, Ordering},
};

use serde_json::{Value, json};

use reel_domain::{
    play::{Files, SeekReady},
    ports::Playback,
    search::{Request, Source},
    subtitles::files::SubFile,
};

pub const NO_ENGINE: &str = "no engine on this device";

/// Hands out ids (searches and jobs, never 0) whose answers say there is no engine.
pub struct NoEngine {
    next: AtomicU32,
    buffer_mb: AtomicU64,
}

impl Default for NoEngine {
    fn default() -> Self {
        NoEngine { next: AtomicU32::new(1), buffer_mb: AtomicU64::new(256) }
    }
}

impl NoEngine {
    fn id(&self) -> u32 {
        self.next.fetch_add(1, Ordering::Relaxed)
    }
}

impl Playback for NoEngine {
    fn search(&self, _source: Source, _request: Request) -> u32 {
        self.id()
    }

    fn check_source(&self, _source: Source) -> u32 {
        self.id()
    }

    fn search_result(&self, _id: u32) -> Value {
        json!({ "state": "failed", "message": NO_ENGINE })
    }

    fn open(&self, _key: &str) -> Result<u32, String> {
        Ok(self.id())
    }

    fn open_release(&self, _source: &str, _episode: Option<(u16, u16)>) -> Result<u32, String> {
        Ok(self.id())
    }

    fn status(&self, _job: u32) -> Value {
        json!({ "phase": "failed", "message": NO_ENGINE })
    }

    fn timeline(&self, _job: u32, _position: f64, _duration: f64, _cached: f64, _read_byte: f64, _read_time: f64) -> Value {
        json!({ "ranges": [], "ahead": 0 })
    }

    fn first_frame(&self, _job: u32) {}

    /// Nothing streams here: nothing to wait for.
    fn seek(&self, _job: u32, _seconds: f64) -> Pin<Box<dyn Future<Output = SeekReady> + Send>> {
        Box::pin(async { SeekReady::Unknown })
    }

    fn close(&self, _job: u32) {}

    /// Nothing is cached here, so nothing is needed: Play goes on to `status`, which says why.
    fn check_space(&self) -> Value {
        json!({ "ok": true, "free": null, "needed": 0, "buffer": self.buffer_mb() })
    }

    fn set_buffer_mb(&self, mb: u64) {
        self.buffer_mb.store(mb, Ordering::Relaxed);
    }

    fn buffer_mb(&self) -> u64 {
        self.buffer_mb.load(Ordering::Relaxed)
    }

    fn buffer_fits(&self, _mb: u64) -> bool {
        true
    }

    fn torrent_files(&self, _url: &str) -> Option<Files> {
        None
    }

    fn prefetch(&self, _url: &str) {}

    fn subtitle_files(&self, _job: u32) -> Option<Vec<SubFile>> {
        None
    }

    fn subtitles(&self, _job: u32) -> Value {
        json!({ "state": "pending", "files": [] })
    }

    fn cues(&self, _job: u32, _id: usize, _from: f64, _to: f64) -> Value {
        json!({ "state": "failed", "message": NO_ENGINE, "cues": [] })
    }
}

/// `Keep` where nothing is saved: no engine, or a TV (no room, no offline use).
#[derive(Default)]
pub struct NoKeep;

impl reel_domain::ports::Keep for NoKeep {
    fn supported(&self) -> bool {
        false
    }

    fn init(&self, _data_dir: &std::path::Path) {}

    fn folder(&self) -> Option<std::path::PathBuf> {
        None
    }

    fn set_folder(&self, _folder: &std::path::Path) -> Result<(), String> {
        Err(NO_ENGINE.into())
    }

    fn add(&self, _request: reel_domain::ports::KeepRequest) -> Result<u32, String> {
        Err(NO_ENGINE.into())
    }

    fn list(&self) -> Value {
        json!([])
    }

    fn set_running(&self, _id: u32, _on: bool) {}

    fn remove(&self, _id: u32) {}

    fn local_file(&self, _key: &str) -> Option<std::path::PathBuf> {
        None
    }

    fn space(&self) -> Value {
        json!({ "saved": 0, "free": null, "folder": null })
    }

    fn revision(&self) -> u64 {
        0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_answer_says_there_is_no_engine() {
        let p = NoEngine::default();
        let job = p.open("tmdb:movie:603").unwrap();
        assert_ne!(job, 0);
        assert_eq!(p.status(job), json!({ "phase": "failed", "message": NO_ENGINE }));
        let search = p.check_source(Source { url: "http://localhost/api".into(), key: None });
        assert_ne!(search, 0);
        assert_eq!(p.search_result(search)["message"], NO_ENGINE);
        assert_eq!(p.check_space()["ok"], true);
        assert_eq!(p.cues(job, 1, 0.0, 0.0)["state"], "failed");
    }
}
