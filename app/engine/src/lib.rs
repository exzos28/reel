//! reel's local engine, the adapter behind `Playback` (docs/architecture.md):
//!
//! - `engine`: the librqbit session and its stream server on 127.0.0.1, the jobs, warm-up,
//!   prefetch, a torrent's file list, the timing log;
//! - `buffer`: the ring-buffer storage that keeps only a window of the film on disk;
//! - `disk`: free space where the cache lives;
//! - `sources`: the user's Torznab source (search, ranking, caps);
//! - `subtitles`: subtitle files read from the torrent that plays.
//!
//! It knows nothing of the catalog: what a catalog key plays and where the viewer stopped
//! come from the `PlaybackHost` it is built with.

mod buffer;
mod http_client;
mod disk;
mod engine;
mod keep;
mod leases;
mod sources;
mod subtitles;

use std::{future::Future, pin::Pin, sync::Arc};

use serde_json::Value;

use reel_domain::{
    play::{Files, SeekReady},
    ports::{Keep, KeepRequest, Playback, PlaybackHost},
    search::{Request, Source},
    subtitles::files::SubFile,
};

/// The local engine. Its state is process-wide (one session, one cache); building it again
/// keeps the first host.
pub struct Local;

impl Local {
    /// `host`: what the engine asks the application (which release a catalog key plays,
    /// where the viewer stopped, who to tell when a torrent's files are known).
    pub fn new(host: Arc<dyn PlaybackHost>) -> Local {
        engine::set_host(host);
        Local
    }
}

impl Playback for Local {
    fn search(&self, source: Source, request: Request) -> u32 {
        sources::start_search(source, request)
    }

    fn check_source(&self, source: Source) -> u32 {
        sources::start_check(source)
    }

    fn search_result(&self, id: u32) -> Value {
        sources::result(id)
    }

    fn open(&self, key: &str) -> Result<u32, String> {
        engine::open(key).map_err(|e| format!("{e:#}"))
    }

    fn open_release(&self, source: &str, episode: Option<(u16, u16)>, through: Option<reel_domain::numbering::Through>) -> Result<u32, String> {
        engine::open_release(source, episode, through).map_err(|e| format!("{e:#}"))
    }

    fn status(&self, job: u32) -> Value {
        engine::status(job)
    }

    fn timeline(&self, job: u32, position: f64, duration: f64, cached: f64, read_byte: f64, read_time: f64) -> Value {
        engine::timeline(job, position, duration, cached, read_byte, read_time)
    }

    fn first_frame(&self, job: u32) {
        engine::time_step(job, "first frame on screen");
        engine::first_frame_shown(job);
    }

    fn seek(&self, job: u32, seconds: f64) -> Pin<Box<dyn Future<Output = SeekReady> + Send>> {
        Box::pin(engine::seek(job, seconds))
    }

    fn close(&self, job: u32) {
        engine::close(job);
    }

    fn check_space(&self) -> Value {
        engine::check_space()
    }

    fn set_buffer_mb(&self, mb: u64) {
        engine::set_buffer_mb(mb);
    }

    fn buffer_mb(&self) -> u64 {
        engine::buffer_mb()
    }

    fn buffer_fits(&self, mb: u64) -> bool {
        engine::buffer_fits(mb)
    }

    fn torrent_files(&self, url: &str) -> Option<Files> {
        engine::torrent_files(url)
    }

    fn prefetch(&self, url: &str) {
        engine::prefetch(url);
    }

    fn subtitle_files(&self, job: u32) -> Option<Vec<SubFile>> {
        subtitles::job_files(job)
    }

    fn subtitles(&self, job: u32) -> Value {
        subtitles::list(job)
    }

    fn cues(&self, job: u32, id: usize, from: f64, to: f64) -> Value {
        subtitles::cues(job, id, from, to)
    }
}

/// Saving films on the device (`keep`): the same engine and session as `Playback`.
impl Keep for Local {
    fn supported(&self) -> bool {
        true
    }

    fn init(&self, data_dir: &std::path::Path) {
        keep::init(data_dir);
    }

    fn folder(&self) -> Option<std::path::PathBuf> {
        keep::folder()
    }

    fn set_folder(&self, folder: &std::path::Path) -> Result<(), String> {
        keep::set_folder(folder)
    }

    fn add(&self, request: KeepRequest) -> Result<u32, String> {
        keep::add(request)
    }

    fn list(&self) -> Value {
        keep::list()
    }

    fn set_running(&self, id: u32, on: bool) {
        keep::set_running(id, on);
    }

    fn remove(&self, id: u32) {
        keep::remove(id);
    }

    fn local_file(&self, key: &str) -> Option<std::path::PathBuf> {
        keep::local_file(key)
    }

    fn space(&self) -> Value {
        keep::space()
    }

    fn revision(&self) -> u64 {
        keep::revision()
    }
}
