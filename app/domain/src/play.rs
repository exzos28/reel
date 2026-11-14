//! What a playback job starts from.

/// What the engine opens for a catalog key: the catalog decides (`PlaybackHost::play_source`).
pub enum PlaySource {
    /// No source set, no release found, or no such title.
    None,
    /// Still finding out (the title or the search): ask again.
    Searching,
    /// A magnet or .torrent URL, and the episode to pick in a pack.
    Ready(String, Option<(u16, u16)>),
    /// The episode is not in the release chosen for its season: the viewer picks one for it.
    NotInRelease,
}

/// Where the viewer stopped in what a job plays (the watch progress), seconds.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Resume {
    pub position: f64,
    pub duration: f64,
    pub watched: bool,
}

/// A torrent's files: (index, path, length).
pub type Files = Vec<(usize, String, u64)>;

/// How far ahead of the picture the player reads into its own cache (mpv's
/// `demuxer-max-bytes`): the reader's position is that far ahead of what is on
/// screen, so at least this much is kept behind it (what is being watched stays
/// on disk, and the scrubber shows it as ready). The engine's cache and the video view agree on it.
pub const PLAYER_CACHE: u64 = 64 * 1024 * 1024;
