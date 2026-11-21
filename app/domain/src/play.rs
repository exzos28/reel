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

/// A release the viewer chose (or watched in), as another search finds it again: by its info
/// hash, else by its name and size. A .torrent link is no mark (a source signs it anew for each
/// search), and an index into one search's list says nothing of the next one's.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct Pick {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub infohash: Option<String>,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub size: Option<u64>,
}

impl Pick {
    /// Whether a release (its info hash, name and size) is this one.
    pub fn is(&self, infohash: Option<&str>, title: &str, size: Option<u64>) -> bool {
        match (self.infohash.as_deref(), infohash) {
            (Some(mine), Some(theirs)) => mine.eq_ignore_ascii_case(theirs),
            _ => self.title == title && self.size == size,
        }
    }
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
/// height once loaded, pixels). A phone's player opens drawn sideways, before the picture is
/// known; once loaded, only a picture taller than wide (a phone's vertical clip) stands it back
/// upright. Any picture wider than tall plays sideways, 4:3 too (larger on a phone than upright);
/// a square one, or one not known (0), stays sideways as it opened.
pub fn starts_sideways(width: f64, height: f64) -> bool {
    !(width > 0.0 && height > width)
}

/// The scale a phone's player starts a turn at, from `from` to `to` degrees (0 upright, 90 or -90
/// sideways), in a window `width` x `height` points, for a picture of `aspect` (its width over its
/// height; 0 or less: 16:9). The player is laid out for the new angle at once and drawn at the old
/// one, scaled so that its picture is as large as it showed: upright the picture is as wide as the
/// window, sideways as long as the window is tall (or as its height lets it be). It then turns and
/// scales to 1. Between two sideways angles, and for no turn, 1.
pub fn turn_start_scale(from: i32, to: i32, width: f64, height: f64, aspect: f64) -> f64 {
    let aspect = if aspect > 0.0 { aspect } else { 16.0 / 9.0 };
    // The picture's width in a box, laid unturned (fitted, centred).
    let fitted = |w: f64, h: f64| w.min(h * aspect);
    let (short, long) = (width.min(height), width.max(height));
    let upright = fitted(short, long);
    let sideways = fitted(long, short);
    if upright <= 0.0 || sideways <= 0.0 {
        return 1.0;
    }
    match (from == 0, to == 0) {
        (true, false) => upright / sideways,
        (false, true) => sideways / upright,
        _ => 1.0,
    }
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
    use super::{Pick, shown_size, starts_sideways, turn_start_scale};

    #[test]
    fn a_pick_is_found_again_by_its_hash_else_its_name_and_size() {
        let sd = Pick { infohash: Some("ab12".into()), title: "Nosferatu.1922.DVDRip".into(), size: Some(1_500_000_000) };
        assert!(sd.is(Some("AB12"), "Nosferatu 1922 (another indexer's name)", Some(1)), "the hash says it");
        assert!(!sd.is(Some("cd34"), "Nosferatu.1922.DVDRip", Some(1_500_000_000)), "another torrent of the same name");
        assert!(sd.is(None, "Nosferatu.1922.DVDRip", Some(1_500_000_000)), "a source that gives no hash");
        assert!(!sd.is(None, "Nosferatu.1922.DVDRip", Some(1_400_000_000)));
        assert!(!sd.is(None, "Nosferatu.1922.1080p.BluRay", Some(1_500_000_000)));
        let json = serde_json::to_string(&sd).unwrap();
        assert_eq!(serde_json::from_str::<Pick>(&json).unwrap(), sd);
        let bare: Pick = serde_json::from_str(r#"{"title":"Film"}"#).unwrap();
        assert!(bare.is(None, "Film", None));
    }

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

    #[test]
    fn a_turn_starts_as_large_as_the_picture_showed() {
        // 16:9 on a 393 x 852 phone: 393 wide upright, 698.7 sideways (as high as the window).
        let turn = turn_start_scale(0, 90, 393.0, 852.0, 16.0 / 9.0);
        assert!((turn - 393.0 / 698.67).abs() < 1e-3, "{turn}");
        let back = turn_start_scale(90, 0, 393.0, 852.0, 16.0 / 9.0);
        assert!((back * turn - 1.0).abs() < 1e-9, "back is the inverse");
        // The other side, and the window's sides either way round: the same.
        assert_eq!(turn_start_scale(0, -90, 852.0, 393.0, 16.0 / 9.0), turn);
        // 2.39:1 is as wide as the window's height sideways: 393 / 852.
        assert!((turn_start_scale(0, 90, 393.0, 852.0, 2.39) - 393.0 / 852.0).abs() < 1e-9);
        // Not known: 16:9.
        assert_eq!(turn_start_scale(0, 90, 393.0, 852.0, 0.0), turn);
    }

    #[test]
    fn a_turn_between_the_sides_or_none_keeps_its_scale() {
        assert_eq!(turn_start_scale(90, -90, 393.0, 852.0, 16.0 / 9.0), 1.0);
        assert_eq!(turn_start_scale(0, 0, 393.0, 852.0, 16.0 / 9.0), 1.0);
        assert_eq!(turn_start_scale(0, 90, 0.0, 0.0, 16.0 / 9.0), 1.0);
    }
}
