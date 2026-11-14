//! What a release name says about itself: quality, codec, HDR, and which
//! season / episodes it holds. Names are free text, so this is best effort:
//! anything not recognised stays unknown rather than guessed.

use std::sync::LazyLock;

use regex::Regex;
use serde::Serialize;

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
pub struct ReleaseInfo {
    /// Vertical resolution: 2160, 1080, 720, 576, 480.
    pub resolution: Option<u16>,
    pub hdr: bool,
    /// An HDR10 / HDR10+ layer is named (a Dolby Vision release with it falls
    /// back to HDR10 on devices without Dolby Vision).
    pub hdr10: bool,
    pub dolby_vision: bool,
    /// Audio formats the name mentions: "dts", "truehd", "atmos", "eac3", "ac3", "aac", "flac", "opus".
    pub audio: Vec<&'static str>,
    /// "x265", "x264", "av1".
    pub codec: Option<&'static str>,
    /// "remux", "bluray", "web", "hdtv", "dvd".
    pub source: Option<&'static str>,
    pub season: Option<u16>,
    /// The episodes it names (one, a range, or none for a whole season).
    pub episodes: Vec<u16>,
    /// A whole season (or several) without episode numbers in the name.
    pub season_pack: bool,
}

macro_rules! re {
    ($s:expr) => {
        LazyLock::new(|| Regex::new($s).expect("valid regex"))
    };
}

static RES: LazyLock<Regex> = re!(r"(?i)\b(2160|1080|720|576|480)[pi]\b|\b(4k|uhd)\b");
static HDR10: LazyLock<Regex> = re!(r"(?i)\b(hdr10\+?|hdr)\b");
static AUDIO: LazyLock<[(Regex, &'static str); 8]> = LazyLock::new(|| {
    [
        (Regex::new(r"(?i)\bdts(-?(hd|x|ma|es))?\b").unwrap(), "dts"),
        (Regex::new(r"(?i)\btrue-?hd\b").unwrap(), "truehd"),
        (Regex::new(r"(?i)\batmos\b").unwrap(), "atmos"),
        (Regex::new(r"(?i)\b(e-?ac-?3|ddp|dd\+|dd5\.1\+)").unwrap(), "eac3"),
        (Regex::new(r"(?i)\b(ac-?3|dd[ ._]?[25]\.[01]|dolby[ ._]digital)\b").unwrap(), "ac3"),
        (Regex::new(r"(?i)\baac(2\.0|5\.1)?\b").unwrap(), "aac"),
        (Regex::new(r"(?i)\bflac\b").unwrap(), "flac"),
        (Regex::new(r"(?i)\bopus\b").unwrap(), "opus"),
    ]
});
static DV: LazyLock<Regex> = re!(r"(?i)\b(dv|dovi|dolby[ ._-]?vision)\b");
static X265: LazyLock<Regex> = re!(r"(?i)\b(x265|h\.?265|hevc)\b");
static X264: LazyLock<Regex> = re!(r"(?i)\b(x264|h\.?264|avc)\b");
static AV1: LazyLock<Regex> = re!(r"(?i)\bav1\b");
static REMUX: LazyLock<Regex> = re!(r"(?i)\bremux\b");
static BLURAY: LazyLock<Regex> = re!(r"(?i)\b(blu-?ray|bdrip|brrip|bdremux)\b");
static WEB: LazyLock<Regex> = re!(r"(?i)\b(web-?dl|webrip|web)\b");
static HDTV: LazyLock<Regex> = re!(r"(?i)\bhdtv(rip)?\b");
static DVD: LazyLock<Regex> = re!(r"(?i)\bdvd(rip|5|9)?\b");
/// S01E03, S01E03E04, S01E03-E05, S01E03-05.
static SXEY: LazyLock<Regex> = re!(r"(?i)\bS(\d{1,2})[ ._-]?E(\d{1,3})(?:[ ._-]?-?[ ._-]?E?(\d{1,3}))?\b");
/// 1x03.
static NXM: LazyLock<Regex> = re!(r"(?i)\b(\d{1,2})x(\d{2,3})\b");
/// S01, S01-S03, Season 1, Сезон 1, 1 сезон.
static SEASON: LazyLock<Regex> =
    re!(r"(?i)\bS(\d{1,2})(?:[ ._-]?-[ ._-]?S?\d{1,2})?\b|\bseason[ ._-]?(\d{1,2})\b|сезон[ ._-]?(\d{1,2})|\b(\d{1,2})[ ._-]?сезон");

pub fn parse(name: &str) -> ReleaseInfo {
    let mut info = ReleaseInfo::default();

    if let Some(c) = RES.captures(name) {
        info.resolution = match c.get(1).map(|m| m.as_str()) {
            Some(r) => r.parse().ok(),
            None => Some(2160),
        };
    }
    info.dolby_vision = DV.is_match(name);
    info.hdr10 = HDR10.is_match(name);
    info.hdr = info.hdr10 || info.dolby_vision;
    info.audio = AUDIO.iter().filter(|(re, _)| re.is_match(name)).map(|(_, a)| *a).collect();
    // "DD+" also matches the plain AC-3 pattern's prefix; E-AC-3 wins.
    if info.audio.contains(&"eac3") {
        info.audio.retain(|a| *a != "ac3");
    }
    info.codec = if AV1.is_match(name) {
        Some("av1")
    } else if X265.is_match(name) {
        Some("x265")
    } else if X264.is_match(name) {
        Some("x264")
    } else {
        None
    };
    info.source = if REMUX.is_match(name) {
        Some("remux")
    } else if BLURAY.is_match(name) {
        Some("bluray")
    } else if WEB.is_match(name) {
        Some("web")
    } else if HDTV.is_match(name) {
        Some("hdtv")
    } else if DVD.is_match(name) {
        Some("dvd")
    } else {
        None
    };

    if let Some(c) = SXEY.captures(name) {
        info.season = c[1].parse().ok();
        let first: u16 = c[2].parse().unwrap_or(0);
        let last: u16 = c.get(3).and_then(|m| m.as_str().parse().ok()).unwrap_or(first);
        info.episodes = (first..=last.max(first)).collect();
    } else if let Some(c) = NXM.captures(name) {
        info.season = c[1].parse().ok();
        info.episodes = c[2].parse().ok().into_iter().collect();
    } else if let Some(c) = SEASON.captures(name) {
        info.season = (1..=4).find_map(|i| c.get(i)).and_then(|m| m.as_str().parse().ok());
        info.season_pack = info.season.is_some();
    }
    info
}

/// How good the picture is, for ranking (higher is better); unknown is low.
pub fn quality_score(info: &ReleaseInfo) -> u32 {
    let res = match info.resolution {
        Some(2160) => 40,
        Some(1080) => 30,
        Some(720) => 20,
        Some(576 | 480) => 10,
        _ => 5,
    };
    let source = match info.source {
        Some("remux") => 5,
        Some("bluray") => 4,
        Some("web") => 3,
        Some("hdtv") => 2,
        Some("dvd") => 1,
        _ => 0,
    };
    res + source
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn film_release() {
        let i = parse("Sintel.2010.1080p.BluRay.x264-OpenFilm");
        assert_eq!(i.resolution, Some(1080));
        assert_eq!(i.source, Some("bluray"));
        assert_eq!(i.codec, Some("x264"));
        assert_eq!(i.season, None);
        assert!(i.episodes.is_empty());
    }

    #[test]
    fn uhd_hdr() {
        let i = parse("Metropolis 1927 2160p UHD BluRay REMUX HDR10 DV HEVC");
        assert_eq!(i.resolution, Some(2160));
        assert!(i.hdr && i.dolby_vision);
        assert_eq!(i.source, Some("remux"));
        assert_eq!(i.codec, Some("x265"));
        assert_eq!(parse("Some Film 4K WEB-DL").resolution, Some(2160));
    }

    #[test]
    fn audio_and_hdr_layers() {
        let i = parse("Film.2160p.UHD.BluRay.REMUX.DV.HDR10.HEVC.TrueHD.Atmos.7.1");
        assert!(i.dolby_vision && i.hdr10);
        assert_eq!(i.audio, vec!["truehd", "atmos"]);
        let dv_only = parse("Film 2160p WEB-DL DV H265 DDP5.1");
        assert!(dv_only.dolby_vision && !dv_only.hdr10);
        assert_eq!(dv_only.audio, vec!["eac3"]);
        assert_eq!(parse("Film 1080p BluRay DTS-HD MA 5.1").audio, vec!["dts"]);
        assert_eq!(parse("Film 1080p WEB AAC2.0 x264").audio, vec!["aac"]);
        assert_eq!(parse("Фильм 1080p AC3").audio, vec!["ac3"]);
    }

    #[test]
    fn episodes() {
        let i = parse("Flash.Gordon.S01E03.720p.WEB");
        assert_eq!((i.season, i.episodes.clone(), i.season_pack), (Some(1), vec![3], false));
        assert_eq!(parse("Show.S02E05-E07.1080p").episodes, vec![5, 6, 7]);
        assert_eq!(parse("Show 1x04 HDTV").episodes, vec![4]);
    }

    #[test]
    fn season_packs() {
        let i = parse("Flash Gordon (1936) Season 1 Complete 1080p");
        assert_eq!((i.season, i.season_pack), (Some(1), true));
        assert_eq!(parse("Flash.Gordon.S03.1080p.BluRay").season, Some(3));
        assert_eq!(parse("Флэш Гордон / Сезон 2 / Серии 1-12").season, Some(2));
        assert_eq!(parse("Флэш Гордон 3 сезон").season, Some(3));
    }

    #[test]
    fn score_orders_quality() {
        assert!(quality_score(&parse("x 2160p remux")) > quality_score(&parse("x 1080p web")));
        assert!(quality_score(&parse("x 1080p web")) > quality_score(&parse("x 720p bluray")));
    }
}

#[cfg(test)]
mod tracker_names {
    use super::parse;

    #[test]
    fn ranges_as_jackett_writes_them() {
        let i = parse("Квест Вижна / VisionQuest / S1E1-8 of 8 [2026, WEB-DL 1080p]");
        assert_eq!((i.season, i.episodes.clone()), (Some(1), (1..=8).collect::<Vec<u16>>()));
        let i = parse("12 12 12 / S1E1 of 8 (Карен Мейн) [2026, WEB-DL 1080p]");
        assert_eq!((i.season, i.episodes.clone()), (Some(1), vec![1]), "an ongoing season: only what is out");
    }
}
