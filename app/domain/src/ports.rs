//! The boundaries: traits the application calls (`Playback`, `Metadata`) and the one the
//! engine calls back (`PlaybackHost`). Adapters implement them; the composition root
//! (reel-app's `wiring`) picks which. Answers are the JSON the UI already reads, so a remote
//! implementation can pass them through as they are.

use std::{future::Future, path::Path, pin::Pin};

use serde_json::Value;

use crate::{
    discover::{DiscoverKind, Filter},
    play::{Files, PlaySource, Resume},
    search::{Request, Source},
    subtitles::files::SubFile,
};

/// Finding releases and playing them: the torrent engine with its cache and the search
/// source. Every method answers at once; work runs in the background and is polled.
///
/// Ids: searches and jobs are numbered by the implementation; 0 is never a valid one.
pub trait Playback: Send + Sync {
    // ---- Releases on the user's search source.

    /// Starts a search; an id for `search_result`.
    fn search(&self, source: Source, request: Request) -> u32;
    /// Starts checking the source (`t=caps`); an id for `search_result`.
    fn check_source(&self, source: Source) -> u32;
    /// `{"state":"pending"}`, `{"state":"done","releases":[…],"hidden":[…]}`,
    /// `{"state":"done","caps":{…}}` for a check, or `{"state":"failed","message"}`.
    fn search_result(&self, id: u32) -> Value;

    // ---- Jobs: what plays.

    /// Starts playing what a catalog key names (the engine asks `PlaybackHost::play_source`
    /// which release); a job id for `status`. Err: the engine could not start.
    fn open(&self, key: &str) -> Result<u32, String>;
    /// Starts playing a release (its magnet or .torrent URL); `episode` picks the file in a
    /// pack. A job id for `status`. Err: the engine could not start.
    fn open_release(&self, source: &str, episode: Option<(u16, u16)>) -> Result<u32, String>;
    /// What the player shows for the job, JSON with a `phase` (`no_source`,
    /// `not_in_release`, `no_space`, `resolving`, `ready`, `unsupported`, `failed`).
    fn status(&self, job: u32) -> Value;
    /// What the scrubber draws: `{"ranges":[[from,to],…],"ahead":seconds}`.
    fn timeline(&self, job: u32, position: f64, duration: f64, cached: f64, read_byte: f64, read_time: f64) -> Value;
    /// The player shows the job's first frame (warming stops; the timing log notes it).
    fn first_frame(&self, job: u32);
    /// Stops the job and deletes what it downloaded.
    fn close(&self, job: u32);

    // ---- The cache.

    /// Whether there is room to start playing: `{"ok","free","needed","buffer"}`.
    fn check_space(&self) -> Value;
    /// The most a film keeps in the cache, MiB (the user's setting).
    fn set_buffer_mb(&self, mb: u64);
    /// The buffer in effect, MiB.
    fn buffer_mb(&self) -> u64;
    /// Whether a buffer of `mb` MiB fits on this device next to the reserve.
    fn buffer_fits(&self, mb: u64) -> bool;

    // ---- Torrents before they play.

    /// A torrent's files (a source link or a magnet): None while they are read (the
    /// host's `files_known` says when they are in).
    fn torrent_files(&self, url: &str) -> Option<Files>;
    /// Opens a source's link in the background, so Play does not wait for it.
    fn prefetch(&self, url: &str);

    // ---- Subtitles from the torrent that plays.

    /// The job's subtitle files (fetching them starts with the first answer); None until
    /// the torrent's metadata is in.
    fn subtitle_files(&self, job: u32) -> Option<Vec<SubFile>>;
    /// `{"state":"pending"|"ready","files":[{"id","language","label","format"}]}`.
    fn subtitles(&self, job: u32) -> Value;
    /// The cues of file `id` on screen at some moment of `from..=to` seconds:
    /// `{"state":"pending"|"ready"|"failed","cues":[…],"text"}`.
    fn cues(&self, job: u32, id: usize, from: f64, to: f64) -> Value;
}

/// What the engine needs from the application: the catalog's decision and the progress.
pub trait PlaybackHost: Send + Sync {
    /// The release a catalog key plays, starting what is needed to know it.
    fn play_source(&self, key: &str) -> PlaySource;
    /// Where the viewer stopped in a catalog key.
    fn resume(&self, key: &str) -> Option<Resume>;
    /// A torrent's file list came in (`Playback::torrent_files`): what the catalog shows
    /// may have changed.
    fn files_known(&self);
}

/// An answer of a metadata call: the envelope `{"data","stale","fetchedAt","error",
/// "warnings","revision"}` as JSON text.
pub type Answer = Pin<Box<dyn Future<Output = String> + Send>>;

/// Titles, seasons, images and ratings (TMDB, AniList, Jikan behind a cache).
pub trait Metadata: Send + Sync {
    /// Opens the cache in `data_dir` (None: in memory); the status.
    fn init(&self, data_dir: Option<&Path>) -> Value;
    /// The user's own TMDB key (empty clears it); the status.
    fn set_tmdb_key(&self, key: &str) -> Value;
    /// Which sources work, and the cache.
    fn status(&self) -> Value;
    /// Goes up whenever a background refresh stored newer data.
    fn revision(&self) -> u64;
    /// What the About screen must show of each source.
    fn attribution(&self) -> Value;
    fn trending(&self, kind: String, language: String) -> Answer;
    fn title(&self, id: String, language: String) -> Answer;
    fn season(&self, id: String, season: u32, language: String) -> Answer;
    fn search(&self, query: String, language: String) -> Answer;
    /// A page (from 1) of a catalog through a filter.
    fn discover(&self, kind: DiscoverKind, filter: Filter, language: String, page: u32) -> Answer;
    /// What the filters of a catalog offer.
    fn filter_options(&self, kind: DiscoverKind, language: String) -> Answer;
}
