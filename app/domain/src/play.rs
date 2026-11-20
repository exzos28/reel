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

/// Whether a phone's player plays sideways for a picture this size (the video view's width and
/// height once loaded, pixels). A phone held upright turns sideways as the player opens, before
/// the picture is known (mpv's output then starts at the sideways size); once loaded, only a
/// picture taller than wide (a phone's vertical clip) turns it back upright. Any picture wider
/// than tall plays sideways, 4:3 too (larger on a phone than upright); a square one, or one not
/// known (0), stays sideways as it turned.
pub fn starts_sideways(width: f64, height: f64) -> bool {
    !(width > 0.0 && height > width)
}

/// A video track's picture as shown, from what its container says: the stored size, its pixel
/// aspect (0 or less: square) and its rotation in degrees (a phone's upright clip is stored
/// sideways and turned a quarter).
pub fn shown_size(width: f64, height: f64, pixel_aspect: f64, rotation: f64) -> (f64, f64) {
    let w = width * if pixel_aspect > 0.0 { pixel_aspect } else { 1.0 };
    let quarter = (rotation.rem_euclid(180.0) - 90.0).abs() < 1.0;
    if quarter { (height, w) } else { (w, height) }
}

#[cfg(test)]
mod tests {
    use super::{shown_size, starts_sideways};

    #[test]
    fn shown_size_applies_the_pixel_aspect_and_a_quarter_turn() {
        assert_eq!(shown_size(1920.0, 1080.0, 1.0, 0.0), (1920.0, 1080.0));
        let (w, h) = shown_size(720.0, 576.0, 64.0 / 45.0, 0.0); // anamorphic PAL 16:9
        assert_eq!((w.round(), h), (1024.0, 576.0));
        assert_eq!(shown_size(1920.0, 1080.0, 0.0, 90.0), (1080.0, 1920.0));
        assert_eq!(shown_size(1920.0, 1080.0, 1.0, 270.0), (1080.0, 1920.0));
        assert_eq!(shown_size(1920.0, 1080.0, 1.0, 180.0), (1920.0, 1080.0));
        let (w, h) = shown_size(1920.0, 1080.0, 1.0, 90.0); // an upright phone clip
        assert!(!starts_sideways(w, h));
    }

    #[test]
    fn a_picture_wider_than_tall_plays_sideways_4_3_too() {
        assert!(starts_sideways(1920.0, 1080.0));
        assert!(starts_sideways(1920.0, 800.0));
        assert!(starts_sideways(3840.0, 1600.0));
        assert!(starts_sideways(1440.0, 1080.0)); // 4:3
        assert!(starts_sideways(720.0, 576.0)); // PAL's stored size
    }

    #[test]
    fn only_a_picture_taller_than_wide_turns_back_upright() {
        assert!(!starts_sideways(1080.0, 1920.0));
        assert!(!starts_sideways(1080.0, 1081.0));
        // Square, or not known yet: it stays sideways as the player turned.
        assert!(starts_sideways(1080.0, 1080.0));
        assert!(starts_sideways(0.0, 0.0));
        assert!(starts_sideways(1920.0, 0.0));
        assert!(starts_sideways(0.0, 1080.0));
    }
}
