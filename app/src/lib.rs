//! reel's Rust side: what `App.tsx` imports from `app/native`.

mod catalog;
mod disk;
mod engine;
mod settings;
mod timeline;

use nsh_core::prelude::*;

#[native_module("app/native")]
fn native(registry: &mut Registry) {
    registry.module::<Fmt>().module::<Engine>().module::<Catalog>().module::<Settings>();
}

/// The built-in torrent server (librqbit). Results are JSON strings.
#[module]
pub struct Engine;

#[module]
impl Engine {
    /// Starts playing catalog film `film`: a job id for `status`, 0 when the
    /// engine could not start (see the log).
    pub fn open(film: String) -> u32 {
        engine::open(&film).unwrap_or_else(|e| {
            eprintln!("reel engine: {e:#}");
            0
        })
    }

    /// What the player shows for the job, JSON with a `phase` (see `engine::status`).
    pub fn status(job: u32) -> String {
        engine::status(job).to_string()
    }

    /// What the scrubber draws at `position` of `duration` seconds:
    /// `{"ranges":[[from,to],…],"ahead":seconds}` (see `engine::timeline`).
    pub fn timeline(job: u32, position: f64, duration: f64) -> String {
        engine::timeline(job, position, duration).to_string()
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
}

/// The demo catalog.
#[module]
pub struct Catalog;

#[module]
impl Catalog {
    /// The home shelves as JSON: `[{"id","items":[{"id","year","minutes","ink","paper","stoppedAt","playable"}]}]`.
    pub fn shelves() -> String {
        catalog::shelves().to_string()
    }
}

/// The user's settings, kept on the device.
#[module]
pub struct Settings;

#[module]
impl Settings {
    /// Loads the settings from `data_dir` (the app's data directory, empty
    /// when the host has none) and configures the engine from them; JSON
    /// `{"language","bufferMB","bufferChoices":[{"mb","default"}]}`.
    pub fn load(data_dir: String) -> String {
        let dir = (!data_dir.is_empty()).then(|| std::path::PathBuf::from(data_dir));
        settings::load(dir.as_deref()).to_string()
    }

    /// Saves the playback buffer size (one of the choices); the size in effect.
    pub fn set_buffer_mb(mb: u32) -> u32 {
        settings::set_buffer_mb(mb)
    }

    /// Saves the UI language (a BCP 47 tag).
    pub fn set_language(tag: String) {
        settings::set_language(&tag);
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

    /// A size in bytes as "256 MB", "1 GB", "1.4 GB".
    pub fn size(bytes: f64) -> String {
        let mb = bytes / (1024.0 * 1024.0);
        if mb < 1024.0 {
            return format!("{} MB", mb.round() as u64);
        }
        let gb = mb / 1024.0;
        if gb >= 10.0 || gb.fract() == 0.0 {
            format!("{} GB", gb.round() as u64)
        } else {
            format!("{gb:.1} GB")
        }
    }

    /// Minutes as hours and minutes, `[h, m]` (the UI words them).
    pub fn hours_minutes(minutes: u32) -> Vec<u32> {
        vec![minutes / 60, minutes % 60]
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

    #[test]
    fn size() {
        assert_eq!(Fmt::size(306.0 * 1024.0 * 1024.0), "306 MB");
        assert_eq!(Fmt::size(1024.0 * 1024.0 * 1024.0), "1 GB");
        assert_eq!(Fmt::size(1.4 * 1024.0 * 1024.0 * 1024.0), "1.4 GB");
        assert_eq!(Fmt::size(12.3 * 1024.0 * 1024.0 * 1024.0), "12 GB");
    }
}
