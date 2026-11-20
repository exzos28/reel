//! What a release costs a device, and whether it fits (design/offline-downloads.md, "Fit").
//!
//! Play picks a release by itself; on a phone or a tablet the best one that plays now is often a
//! remux of 25 GB, which costs the device time, data and space for nothing its screen shows; on a
//! Full HD screen without HDR a 4K Dolby Vision release is 40 GB of picture it cannot show.
//! `limits` says what such a device picks by itself: the viewer can still choose any release from
//! the list. `fits` says whether saving something leaves the device room.

use crate::compat::Display;

/// What Play (and Save) pick by themselves on a kind of device. None, true: any.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Limits {
    /// The tallest picture, in lines.
    pub lines: Option<u32>,
    /// The most bytes per hour of runtime.
    pub bytes_per_hour: Option<f64>,
    /// HDR pictures (HDR10, Dolby Vision): false where the screen shows none, which would show
    /// them dull or tone-mapped down from a bigger file for nothing.
    pub hdr: bool,
    /// Dolby Vision without an HDR10 layer: false where the screen has no Dolby Vision.
    pub dolby_vision: bool,
}

impl Limits {
    pub const NONE: Limits = Limits { lines: None, bytes_per_hour: None, hdr: true, dolby_vision: true };
}

/// A release's picture as its name says it, for `within`.
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct Picture {
    /// Its height in lines (None: the name does not say).
    pub lines: Option<u32>,
    /// HDR10 or Dolby Vision.
    pub hdr: bool,
    /// Dolby Vision with no HDR10 layer to fall back on.
    pub dolby_vision_only: bool,
}

/// Bytes per hour a phone or a tablet picks at most by itself: 5 GB (about 11 Mbit/s). Every
/// 1080p WEB-DL (2–4 GB an hour) and the usual 1080p BluRay encodes (3–5 GB an hour) are under
/// it; a 1080p remux or an untouched disc (12–20 GB an hour) and any 4K are over it. A two-hour
/// film is then at most 10 GB.
pub const HANDHELD_BYTES_PER_HOUR: f64 = 5e9;

/// The tallest picture a phone or a tablet picks by itself: 1080p is as much as its screen shows.
pub const HANDHELD_LINES: u32 = 1080;

/// The limits of a kind of device (`compat::family`) on its screen (`compat::display`): a phone
/// or a tablet keeps to 1080p and `HANDHELD_BYTES_PER_HOUR`; any device keeps to what its screen
/// shows, when the host says (no taller picture, no HDR on a screen without it, no Dolby Vision
/// alone on one without Dolby Vision). A TV, a desktop and an unknown one with a screen not known
/// pick any.
pub fn limits(device: Option<&str>, display: Display) -> Limits {
    let mut l = match device {
        Some("phone" | "tablet") => Limits { lines: Some(HANDHELD_LINES), bytes_per_hour: Some(HANDHELD_BYTES_PER_HOUR), ..Limits::NONE },
        _ => Limits::NONE,
    };
    if let Some(screen) = display.lines.filter(|l| *l > 0) {
        l.lines = Some(l.lines.map_or(screen, |cap| cap.min(screen)));
    }
    l.hdr = display.hdr != Some(false);
    l.dolby_vision = l.hdr && display.dolby_vision != Some(false);
    l
}

/// Whether a release keeps to `limits`: its picture (what its name does not say passes) and its
/// bytes per hour, `bytes` over `minutes` of runtime (a season pack's share of it already taken).
/// What is not known passes: only what a release clearly is keeps it out.
pub fn within(limits: Limits, picture: Picture, bytes: f64, minutes: u32) -> bool {
    let tall = limits.lines.is_none_or(|cap| picture.lines.is_none_or(|l| l <= cap));
    let shown = (limits.hdr || !picture.hdr) && (limits.dolby_vision || !picture.dolby_vision_only);
    let size = match limits.bytes_per_hour {
        Some(most) if bytes > 0.0 && minutes > 0 => bytes / (minutes as f64 / 60.0) <= most,
        _ => true,
    };
    tall && shown && size
}

/// Whether a kind of device (`compat::family`) saves films to watch offline: not a TV, whatever
/// its player (a Samsung TV's, Android TV's), design/offline-downloads.md. An unknown one does.
pub fn saves(device: Option<&str>) -> bool {
    device != Some("tv")
}

/// Kept free on the volume of saved films, past what they take: room for the system and the
/// other apps (a phone short of space stops working well well before it is full).
pub const RESERVE: u64 = 1024 * 1024 * 1024;

/// Whether saving `needed` bytes fits in `free` with `pending` (what is left of the items
/// still saving) and a margin: a fiftieth of it (the pieces at a file's edges write into the files
/// beside it, a few MB each; subtitles come along) and `RESERVE`.
pub fn fits(needed: u64, free: u64, pending: u64) -> bool {
    needed.saturating_add(needed / 50).saturating_add(pending).saturating_add(RESERVE) <= free
}

#[cfg(test)]
mod tests {
    use super::*;

    const GB: f64 = 1e9;

    const UNKNOWN: Display = Display { lines: None, hdr: None, dolby_vision: None };

    fn sdr(lines: u32) -> Picture {
        Picture { lines: Some(lines), ..Picture::default() }
    }

    fn hdr(lines: u32) -> Picture {
        Picture { lines: Some(lines), hdr: true, dolby_vision_only: false }
    }

    fn dv_only(lines: u32) -> Picture {
        Picture { lines: Some(lines), hdr: true, dolby_vision_only: true }
    }

    #[test]
    fn a_phone_keeps_to_1080p_and_five_gb_an_hour() {
        let phone = limits(Some("phone"), UNKNOWN);
        assert_eq!(phone, limits(Some("tablet"), UNKNOWN));
        assert!(within(phone, sdr(1080), 2.5 * GB, 96), "a 1080p WEB-DL");
        assert!(within(phone, sdr(1080), 9.0 * GB, 120), "a 1080p encode, 4.5 GB an hour");
        assert!(!within(phone, sdr(1080), 25.0 * GB, 96), "a 1080p remux");
        assert!(!within(phone, sdr(2160), 6.0 * GB, 120), "4K, small or not");
        assert!(within(phone, Picture::default(), 1.4 * GB, 96), "a name without its picture");
        assert!(within(phone, sdr(1080), 25.0 * GB, 0), "no runtime: the size says nothing");
    }

    #[test]
    fn a_tv_and_a_desktop_pick_any_on_a_screen_not_known() {
        for d in [Some("tv"), Some("mac"), Some("windows"), Some("linux"), None] {
            assert_eq!(limits(d, UNKNOWN), Limits::NONE, "{d:?}");
            assert!(within(limits(d, UNKNOWN), dv_only(2160), 80.0 * GB, 120), "{d:?}");
        }
    }

    #[test]
    fn a_full_hd_screen_without_hdr_keeps_to_1080p_sdr() {
        let screen = Display { lines: Some(1080), hdr: Some(false), dolby_vision: Some(false) };
        let tv = limits(Some("tv"), screen);
        assert!(within(tv, sdr(1080), 28.0 * GB, 94), "a 1080p remux: a TV has no size limit");
        assert!(within(tv, sdr(720), 8.7 * GB, 94));
        assert!(!within(tv, sdr(2160), 20.0 * GB, 120), "4K on a Full HD screen");
        assert!(!within(tv, hdr(1080), 10.0 * GB, 120), "HDR on a screen without it");
        assert!(!within(tv, dv_only(2160), 38.0 * GB, 120));
        assert!(within(tv, Picture::default(), 1.5 * GB, 94), "a name that says nothing of its picture");
    }

    #[test]
    fn an_hdr10_screen_takes_hdr_but_not_dolby_vision_alone() {
        let screen = Display { lines: Some(2160), hdr: Some(true), dolby_vision: Some(false) };
        let tv = limits(Some("tv"), screen);
        assert!(within(tv, hdr(2160), 38.0 * GB, 120), "4K HDR10, or Dolby Vision with its HDR10 layer");
        assert!(!within(tv, dv_only(2160), 38.0 * GB, 120));
        let dv = limits(Some("tv"), Display { dolby_vision: Some(true), ..screen });
        assert!(within(dv, dv_only(2160), 38.0 * GB, 120));
        // Dolby Vision said, HDR not said: still no HDR to show it with.
        let odd = limits(Some("tv"), Display { lines: Some(2160), hdr: Some(false), dolby_vision: Some(true) });
        assert!(!within(odd, dv_only(2160), 38.0 * GB, 120));
    }

    #[test]
    fn a_phone_keeps_to_the_smaller_of_its_cap_and_its_screen() {
        let small = limits(Some("phone"), Display { lines: Some(720), ..UNKNOWN });
        assert_eq!(small.lines, Some(720));
        let big = limits(Some("tablet"), Display { lines: Some(1640), ..UNKNOWN });
        assert_eq!(big.lines, Some(HANDHELD_LINES));
        assert_eq!(limits(Some("phone"), Display { lines: Some(0), ..UNKNOWN }).lines, Some(HANDHELD_LINES), "a screen of no lines is not known");
    }

    #[test]
    fn a_tv_saves_nothing() {
        assert!(!saves(Some("tv")), "a Samsung TV and an Android TV alike");
        for d in [Some("phone"), Some("tablet"), Some("mac"), Some("windows"), Some("linux"), None] {
            assert!(saves(d), "{d:?}");
        }
    }

    #[test]
    fn saving_leaves_a_fiftieth_and_the_reserve() {
        let gib = 1024 * 1024 * 1024u64;
        assert!(!fits(25 * gib, 19 * gib, 0), "25 GB in 19 GB free");
        assert!(fits(10 * gib, 19 * gib, 0));
        assert!(!fits(10 * gib, 19 * gib, 8 * gib), "with 8 GB still to come");
        assert!(fits(17 * gib, 19 * gib, 0), "17 GB + a fiftieth + the reserve is under 19");
        assert!(!fits(18 * gib, 19 * gib, 0), "18 GB + a fiftieth + the reserve is over 19");
        assert!(!fits(u64::MAX, 19 * gib, 0));
    }
}
