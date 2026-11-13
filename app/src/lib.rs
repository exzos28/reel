//! reel's Rust side: what `App.tsx` imports from `app/native`.

mod disk;
mod engine;

use nsh_core::prelude::*;

#[native_module("app/native")]
fn native(registry: &mut Registry) {
    registry.module::<Fmt>().module::<Engine>();
}

/// The built-in torrent server (librqbit). Results are JSON strings or
/// numbers; errors come back as `{"state":"failed","message":…}`.
#[module]
pub struct Engine;

#[module]
impl Engine {
    /// Starts the engine if needed; the port of its stream server on
    /// 127.0.0.1, 0 when it could not start (see the log).
    pub fn start() -> u16 {
        engine::start().unwrap_or_else(|e| {
            eprintln!("reel engine: {e:#}");
            0
        })
    }

    /// Adds a magnet link or a .torrent URL; a job id for `status`, 0 on failure.
    pub fn add(url: String) -> u32 {
        engine::add(&url).unwrap_or_else(|e| {
            eprintln!("reel engine: {e:#}");
            0
        })
    }

    /// The job's state as JSON (see `engine::status`).
    pub fn status(job: u32) -> String {
        engine::status(job).to_string()
    }

    /// Sets the playback buffer size in MiB (clamped to 64..16384).
    pub fn set_buffer_mb(mb: u32) {
        engine::set_buffer_mb(mb as u64);
    }

    /// Whether there is room to start playing, as JSON
    /// `{"ok":bool,"free":bytes|null,"needed":bytes,"buffer":MiB}`.
    pub fn check_space() -> String {
        engine::check_space().to_string()
    }

    /// Stops the job and deletes what it downloaded (the cache is per film).
    pub fn close(job: u32) {
        engine::close(job);
    }

    /// Which parts of file `file` of the job's torrent are downloaded, as JSON
    /// `{"state":"ready","length":bytes,"buckets":[0..1, …]}`: the file cut into
    /// `buckets` equal byte ranges (see `engine::file_map`).
    pub fn file_map(job: u32, file: u32, buckets: u32) -> String {
        engine::file_map(job, file as usize, buckets.min(10_000) as usize).to_string()
    }
}

/// Formatting shared by every platform.
#[module]
pub struct Fmt;

#[module]
impl Fmt {
    /// Playback position in seconds as "1:12:40" / "4:05".
    pub fn position(seconds: u32) -> String {
        let (h, m, s) = (seconds / 3600, seconds / 60 % 60, seconds % 60);
        if h > 0 {
            format!("{h}:{m:02}:{s:02}")
        } else {
            format!("{m}:{s:02}")
        }
    }
}

#[cfg(test)]
mod tests {
    use super::Fmt;

    #[test]
    fn position() {
        assert_eq!(Fmt::position(4360), "1:12:40");
        assert_eq!(Fmt::position(245), "4:05");
    }
}
