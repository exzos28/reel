//! What the current device can play, and whether a release fits it. The
//! profile is the player the platform uses; release names only say so much,
//! so a release is refused only for what its name clearly states, and the
//! container is checked once the file is known (`file_ok`).

use std::sync::Mutex;

use serde::Serialize;

use super::release::ReleaseInfo;

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

/// Why a release or file will not play here. The UI words it (`compat.<key>`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Reason {
    AudioDts,
    AudioTruehd,
    DolbyVisionOnly,
    Container,
}

/// Whether a release, as its name describes it, plays on `profile`.
pub fn release_ok(info: &ReleaseInfo, profile: Profile) -> Result<(), Reason> {
    if profile == Profile::Mpv {
        return Ok(());
    }
    // A release naming several audio formats usually carries several tracks;
    // refuse it only when every named format is unsupported.
    let unsupported = |a: &&str| matches!(*a, "dts" | "truehd");
    if !info.audio.is_empty() && info.audio.iter().filter(|a| **a != "atmos").all(unsupported) {
        return Err(if info.audio.contains(&"dts") { Reason::AudioDts } else { Reason::AudioTruehd });
    }
    let dv_ok = profile == Profile::AppleAvPlayer;
    if info.dolby_vision && !info.hdr10 && !dv_ok {
        return Err(Reason::DolbyVisionOnly);
    }
    Ok(())
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
    use crate::sources::release::parse;

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
}
