//! What the current device can play, and whether a release fits it. The
//! profile is the player the platform uses; release names only say so much,
//! so a release is refused only for what its name clearly states, and the
//! container is checked once the file is known (`file_ok`).

use std::sync::Mutex;

use serde::Serialize;

use crate::release::ReleaseInfo;

/// The player a platform plays through.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Profile {
    /// libmpv: plays practically everything.
    Mpv,
    /// Apple's AVPlayer: MP4/MOV only, no DTS or TrueHD.
    AppleAvPlayer,
    /// Android's MediaPlayer: MKV and MP4; no DTS or TrueHD; Dolby Vision only on some devices.
    AndroidMediaPlayer,
    /// Samsung Tizen TV player (AVPlay): MKV and MP4; no DTS (removed ~2018), no TrueHD,
    /// no Dolby Vision (HDR10/HDR10+ only).
    Tizen,
}

impl Profile {
    pub fn parse(name: &str) -> Option<Profile> {
        Some(match name {
            "mpv" => Profile::Mpv,
            "apple_avplayer" => Profile::AppleAvPlayer,
            "android_mediaplayer" => Profile::AndroidMediaPlayer,
            "tizen" => Profile::Tizen,
            _ => return None,
        })
    }

    /// The video view that draws for this profile when the host's own player
    /// is not a view of the UI's: a Samsung TV's AVPlay, which the TV shell
    /// plays on the video plane under the web UI (`"avplay"`). None: the UI's
    /// own view decides (mpv or the platform's `<Video>`).
    pub fn host_video(self) -> Option<&'static str> {
        match self {
            Profile::Tizen => Some("avplay"),
            Profile::Mpv | Profile::AppleAvPlayer | Profile::AndroidMediaPlayer => None,
        }
    }

    /// The kind of device this host is when the system cannot say: "tv" for a TV's
    /// player (the web build on a Samsung TV looks like a desktop browser to NSH).
    pub fn device(self) -> Option<&'static str> {
        match self {
            Profile::Tizen => Some("tv"),
            Profile::Mpv | Profile::AppleAvPlayer | Profile::AndroidMediaPlayer => None,
        }
    }

    /// The default for the platform this core was built for; a host with a
    /// different player (mpv on macOS, the Tizen service) sets its own.
    fn default_for_target() -> Profile {
        if cfg!(any(target_os = "macos", target_os = "ios")) {
            Profile::AppleAvPlayer
        } else if cfg!(target_os = "android") {
            Profile::AndroidMediaPlayer
        } else {
            Profile::Mpv
        }
    }
}

static PROFILE: Mutex<Option<Profile>> = Mutex::new(None);

pub fn profile() -> Profile {
    PROFILE.lock().unwrap().unwrap_or_else(Profile::default_for_target)
}

pub fn set_profile(p: Profile) {
    *PROFILE.lock().unwrap() = Some(p);
}

/// The kinds of device a development host may stand in for (`set_device`), as the UI names its
/// platform families.
pub const DEVICES: [&str; 6] = ["tv", "mac", "windows", "linux", "tablet", "phone"];

static DEVICE: Mutex<Option<&'static str>> = Mutex::new(None);

/// The kind of device the UI is told it runs on, past what the profile says: a development host
/// (platforms/tizen's reel-core with `--device`) serving the web build in a browser as a Mac, a
/// phone, a TV… for screenshots (dev/screens.sh). Never set on a real device. `None` for one not
/// in `DEVICES`.
pub fn set_device(name: &str) -> Option<&'static str> {
    let known = DEVICES.iter().copied().find(|d| *d == name)?;
    *DEVICE.lock().unwrap() = Some(known);
    Some(known)
}

/// The kind of device: the one a development host stands in for, else the profile's ("tv" on a
/// Samsung TV), else none.
pub fn device() -> Option<&'static str> {
    DEVICE.lock().unwrap().or_else(|| profile().device())
}

static FAMILY: Mutex<Option<&'static str>> = Mutex::new(None);

/// The platform family the UI lays itself out for (`platform/index.ts`: a phone, a tablet, a
/// Mac…), as it reports it once at start: the core cannot tell a phone from a tablet itself
/// (NSH's idiom is the UI thread's). A fact, not a policy: what follows from it (`fit::limits`)
/// is decided here. `None` for one not in `DEVICES`. One per process: a core serving several
/// screens (a remote server, later) will need it per client.
pub fn set_family(name: &str) -> Option<&'static str> {
    let known = DEVICES.iter().copied().find(|d| *d == name)?;
    *FAMILY.lock().unwrap() = Some(known);
    Some(known)
}

/// The kind of device Play's and Save's own picks are for: what `device` says (a development
/// host's stand-in, a Samsung TV), else the family the UI reported, else none.
pub fn family() -> Option<&'static str> {
    device().or_else(|| *FAMILY.lock().unwrap())
}

/// What the screen shows, as the host reads it from the system once at start (Android: the
/// display's modes and HDR types). A fact, not a policy: what follows from it (`fit::limits`) is
/// decided there. `None` where the host does not say (every field unknown: nothing is held back).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Display {
    /// The tallest picture it shows, in lines (1080 on a Full HD screen, 2160 on a 4K one).
    pub lines: Option<u32>,
    /// It shows HDR10 (or HDR10+).
    pub hdr: Option<bool>,
    /// It shows Dolby Vision.
    pub dolby_vision: Option<bool>,
}

static DISPLAY: Mutex<Display> = Mutex::new(Display { lines: None, hdr: None, dolby_vision: None });

/// The screen's facts, as the host found them. One per process, as `set_family`.
pub fn set_display(d: Display) {
    *DISPLAY.lock().unwrap() = d;
}

/// What the screen shows (unknown until the host says).
pub fn display() -> Display {
    *DISPLAY.lock().unwrap()
}

/// Why a release or file will not play here. The UI words it (`compat.<key>`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Reason {
    AudioDts,
    AudioTruehd,
    DolbyVisionOnly,
    Container,
}

/// Whether mpv shows Dolby Vision alone (profile 5: no HDR10 base layer) in the right colours
/// where this core runs. Android's draws with `vo=gpu` and MediaCodec
/// (`app/src/adapters/mpv/android.rs`), which shows it in the wrong colours whatever the screen.
const MPV_SHOWS_DOLBY_VISION_ONLY: bool = !cfg!(target_os = "android");

/// A release that is Dolby Vision alone, on a player that does not show it (`shown`), is refused.
fn dolby_vision_ok(info: &ReleaseInfo, shown: bool) -> Result<(), Reason> {
    if info.dolby_vision && !info.hdr10 && !shown { Err(Reason::DolbyVisionOnly) } else { Ok(()) }
}

/// Whether a release, as its name describes it, plays on `profile`.
pub fn release_ok(info: &ReleaseInfo, profile: Profile) -> Result<(), Reason> {
    if profile == Profile::Mpv {
        return dolby_vision_ok(info, MPV_SHOWS_DOLBY_VISION_ONLY);
    }
    // A release naming several audio formats usually carries several tracks;
    // refuse it only when every named format is unsupported.
    let unsupported = |a: &&str| matches!(*a, "dts" | "truehd");
    if !info.audio.is_empty() && info.audio.iter().filter(|a| **a != "atmos").all(unsupported) {
        return Err(if info.audio.contains(&"dts") { Reason::AudioDts } else { Reason::AudioTruehd });
    }
    dolby_vision_ok(info, profile == Profile::AppleAvPlayer)
}

/// Whether the chosen file's container plays on `profile`.
pub fn file_ok(name: &str, profile: Profile) -> Result<(), Reason> {
    let ext = name.rsplit_once('.').map(|(_, e)| e.to_ascii_lowercase()).unwrap_or_default();
    let ok = match profile {
        Profile::Mpv => true,
        Profile::AppleAvPlayer => matches!(ext.as_str(), "mp4" | "m4v" | "mov"),
        Profile::AndroidMediaPlayer | Profile::Tizen => matches!(ext.as_str(), "mp4" | "m4v" | "mkv" | "webm" | "ts" | "mov"),
    };
    if ok { Ok(()) } else { Err(Reason::Container) }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::release::parse;

    #[test]
    fn a_stand_in_device_is_one_of_the_families() {
        // A known one is not set here: the stand-in is the process's, and other tests read it.
        assert_eq!(set_device("watch"), None);
        assert_eq!(set_device(""), None);
        assert!(DEVICES.contains(&"mac") && DEVICES.contains(&"phone") && DEVICES.contains(&"tv"));
    }

    #[test]
    fn dolby_vision_alone_plays_only_where_the_player_shows_it() {
        let alone = parse("Film 2160p WEB-DL DV HEVC DDP5.1");
        let with_hdr10 = parse("Film 2160p WEB-DL DV HDR10 HEVC DDP5.1");
        assert_eq!(dolby_vision_ok(&alone, false), Err(Reason::DolbyVisionOnly));
        assert_eq!(dolby_vision_ok(&alone, true), Ok(()));
        assert_eq!(dolby_vision_ok(&with_hdr10, false), Ok(()), "its HDR10 base plays");
        // mpv everywhere but Android (this test's host is not one).
        assert_eq!(release_ok(&alone, Profile::Mpv), Ok(()));
    }

    #[test]
    fn tizen_refuses_what_it_cannot_decode() {
        let t = Profile::Tizen;
        assert_eq!(release_ok(&parse("Film 1080p BluRay DTS-HD MA"), t), Err(Reason::AudioDts));
        assert_eq!(release_ok(&parse("Film 2160p BluRay TrueHD Atmos"), t), Err(Reason::AudioTruehd));
        assert_eq!(release_ok(&parse("Film 2160p WEB-DL DV HEVC DDP5.1"), t), Err(Reason::DolbyVisionOnly));
        assert_eq!(release_ok(&parse("Film 2160p WEB-DL DV HDR10 HEVC DDP5.1"), t), Ok(()), "HDR10 fallback");
        assert_eq!(release_ok(&parse("Film 1080p BluRay DTS AC3"), t), Ok(()), "an AC-3 track as well");
        assert_eq!(release_ok(&parse("Film 1080p WEB x264"), t), Ok(()), "unknown audio is not refused");
    }

    #[test]
    fn mpv_plays_everything_and_avplayer_needs_mp4() {
        assert_eq!(release_ok(&parse("Film DV TrueHD DTS"), Profile::Mpv), Ok(()));
        assert_eq!(release_ok(&parse("Film 2160p DV DDP5.1"), Profile::AppleAvPlayer), Ok(()));
        assert_eq!(file_ok("Film/film.mkv", Profile::AppleAvPlayer), Err(Reason::Container));
        assert_eq!(file_ok("Film/film.mp4", Profile::AppleAvPlayer), Ok(()));
        assert_eq!(file_ok("Film/film.mkv", Profile::Tizen), Ok(()));
        assert_eq!(file_ok("Film/film.avi", Profile::Mpv), Ok(()));
    }

    #[test]
    fn only_the_tv_draws_video_under_the_ui() {
        assert_eq!(Profile::Tizen.host_video(), Some("avplay"));
        assert_eq!(Profile::Mpv.host_video(), None);
        assert_eq!(Profile::AppleAvPlayer.host_video(), None);
    }
}
