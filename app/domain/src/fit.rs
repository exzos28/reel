//! What a release costs a device, and whether it fits (design/offline-downloads.md, "Fit").
//!
//! Play picks a release by itself; on a phone or a tablet the best one that plays now is often a
//! remux of 25 GB, which costs the device time, data and space for nothing its screen shows.
//! `limits` says what such a device picks by itself: the viewer can still choose any release from
//! the list. `fits` says whether saving something leaves the device room.

/// What Play (and Save) pick by themselves on a kind of device. None: any.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Limits {
    /// The tallest picture, in lines.
    pub lines: Option<u32>,
    /// The most bytes per hour of runtime.
    pub bytes_per_hour: Option<f64>,
}

impl Limits {
    pub const NONE: Limits = Limits { lines: None, bytes_per_hour: None };
}

/// Bytes per hour a phone or a tablet picks at most by itself: 5 GB (about 11 Mbit/s). Every
/// 1080p WEB-DL (2–4 GB an hour) and the usual 1080p BluRay encodes (3–5 GB an hour) are under
/// it; a 1080p remux or an untouched disc (12–20 GB an hour) and any 4K are over it. A two-hour
/// film is then at most 10 GB.
pub const HANDHELD_BYTES_PER_HOUR: f64 = 5e9;

/// The tallest picture a phone or a tablet picks by itself: 1080p is as much as its screen shows.
pub const HANDHELD_LINES: u32 = 1080;

/// The limits of a kind of device (`compat::device`): a phone or a tablet keeps to 1080p and
/// `HANDHELD_BYTES_PER_HOUR`; a TV, a desktop and an unknown one pick any.
pub fn limits(device: Option<&str>) -> Limits {
    match device {
        Some("phone" | "tablet") => Limits { lines: Some(HANDHELD_LINES), bytes_per_hour: Some(HANDHELD_BYTES_PER_HOUR) },
        _ => Limits::NONE,
    }
}

/// Whether a release keeps to `limits`: its picture (`lines`, None: the name does not say) and
/// its bytes per hour, `bytes` over `minutes` of runtime (a season pack's share of it already
/// taken). What is not known passes: only what a release clearly is keeps it out.
pub fn within(limits: Limits, lines: Option<u32>, bytes: f64, minutes: u32) -> bool {
    let picture = limits.lines.is_none_or(|cap| lines.is_none_or(|l| l <= cap));
    let size = match limits.bytes_per_hour {
        Some(most) if bytes > 0.0 && minutes > 0 => bytes / (minutes as f64 / 60.0) <= most,
        _ => true,
    };
    picture && size
}

/// Kept free on the volume of saved films, past what they take: room for the system and the
/// other apps (a phone short of space stops working well well before it is full).
pub const RESERVE: u64 = 1024 * 1024 * 1024;

/// Whether saving `needed` bytes fits in `free` with `pending` (what is left of the items
/// still saving) and a margin: a tenth of it (the pieces at a file's edges write into the files
/// beside it, subtitles come along) and `RESERVE`.
pub fn fits(needed: u64, free: u64, pending: u64) -> bool {
    needed.saturating_add(needed / 10).saturating_add(pending).saturating_add(RESERVE) <= free
}

#[cfg(test)]
mod tests {
    use super::*;

    const GB: f64 = 1e9;

    #[test]
    fn a_phone_keeps_to_1080p_and_five_gb_an_hour() {
        let phone = limits(Some("phone"));
        assert_eq!(phone, limits(Some("tablet")));
        assert!(within(phone, Some(1080), 2.5 * GB, 96), "a 1080p WEB-DL");
        assert!(within(phone, Some(1080), 9.0 * GB, 120), "a 1080p encode, 4.5 GB an hour");
        assert!(!within(phone, Some(1080), 25.0 * GB, 96), "a 1080p remux");
        assert!(!within(phone, Some(2160), 6.0 * GB, 120), "4K, small or not");
        assert!(within(phone, None, 1.4 * GB, 96), "a name without its picture");
        assert!(within(phone, Some(1080), 25.0 * GB, 0), "no runtime: the size says nothing");
    }

    #[test]
    fn a_tv_and_a_desktop_pick_any() {
        for d in [Some("tv"), Some("mac"), Some("windows"), Some("linux"), None] {
            assert!(within(limits(d), Some(2160), 80.0 * GB, 120), "{d:?}");
        }
    }

    #[test]
    fn saving_leaves_a_tenth_and_the_reserve() {
        let gib = 1024 * 1024 * 1024u64;
        assert!(!fits(25 * gib, 19 * gib, 0), "25 GB in 19 GB free");
        assert!(fits(10 * gib, 19 * gib, 0));
        assert!(!fits(10 * gib, 19 * gib, 8 * gib), "with 8 GB still to come");
        assert!(!fits(17 * gib, 19 * gib, 0), "17 GB + a tenth + the reserve is over 19");
        assert!(!fits(u64::MAX, 19 * gib, 0));
    }
}
