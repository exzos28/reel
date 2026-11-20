//! What a playback job starts from.

/// What the engine opens for a catalog key: the catalog decides (`PlaybackHost::play_source`).
pub enum PlaySource {
    /// No source set, no release found, or no such title.
    None,
    /// Still finding out (the title or the search): ask again.
    Searching,
    /// A magnet or .torrent URL, the episode to pick in a pack, and its season's place in the
    /// show's numbering (a pack may number through the show).
    Ready(String, Option<(u16, u16)>, Option<crate::numbering::Through>),
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

/// What a seek waits for before the player goes there (`Playback::seek`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SeekReady {
    /// The place is on disk (it was, or it came): the player can seek without waiting in it.
    Ready,
    /// A newer seek of the same job, or the job closed: this one is not wanted any more.
    Replaced,
    /// The engine does not know where the place is (the player has not said how long the
    /// film is, or the job does not stream): the player seeks as it is.
    Unknown,
}

impl SeekReady {
    /// The word the UI reads.
    pub fn as_str(self) -> &'static str {
        match self {
            SeekReady::Ready => "ready",
            SeekReady::Replaced => "replaced",
            SeekReady::Unknown => "unknown",
        }
    }
}
