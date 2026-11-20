//! What a release name says about itself: quality, codec, HDR, and which
//! season / episodes it holds. Names are free text, so this is best effort:
//! anything not recognised stays unknown rather than guessed.

use std::sync::LazyLock;

use regex::Regex;
use serde::Serialize;

mod languages;
pub use languages::{AudioLanguage, audio_languages};

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
    /// The audio languages the name says, and how each is voiced (`audio_languages`).
    pub languages: Vec<AudioLanguage>,
    /// "x265", "x264", "av1".
    pub codec: Option<&'static str>,
    /// "remux", "bluray", "web", "hdtv", "dvd".
    pub source: Option<&'static str>,
    pub season: Option<u16>,
    /// The episodes it names (one, a range, or none for a whole season).
    pub episodes: Vec<u16>,
    /// A whole season (or several) without episode numbers in the name.
    pub season_pack: bool,
    /// How many episodes the name says the season (or show) has: the N of "[001-053 из 500]",
    /// "S1E1-22 of 22". None when it does not say.
    pub total: Option<u16>,
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
/// What anime trackers write in brackets, in any language: "[E25 of 25]", "[001-053 из 500]",
/// "[362-500 из 500]", "[E28+11 of 28+11]": E, the first episode (or the count of those out),
/// "-" and the last, one short word of any language, then the total. The structure, not the
/// word: no list of languages to keep.
static BRACKET_RANGE: LazyLock<Regex> =
    re!(r"\[\s*E?(\d{1,4})(?:\+\d+)?(?:\s*-\s*E?(\d{1,4}))?\s+\p{L}{1,4}\s+(\d{1,4})(?:\+\d+)?\s*\]");
/// "(S3, часть 1)", "Part 2", "Cour 2": a season told in parts, whose episodes count from 1
/// in each part, not the season's numbers.
static PART: LazyLock<Regex> = re!(r"(?i)(?:часть|part|cour)[ ._-]?\d");
/// The total after a Jackett-style range: "S1E1-22 of 22", "S1E1-7 (7)".
static OF_TOTAL: LazyLock<Regex> = re!(r"(?i)\bS\d{1,2}E\d{1,4}(?:-\d{1,4})?\s+(?:\p{L}{1,4}\s+)?\(?(\d{1,4})\)?");
/// 1x03.
static NXM: LazyLock<Regex> = re!(r"(?i)\b(\d{1,2})x(\d{2,3})\b");
/// S01, S01-S03, Season 1, Сезон 1, 1 сезон.
static SEASON: LazyLock<Regex> =
    re!(r"(?i)\bS(\d{1,2})(?:[ ._-]?-[ ._-]?S?\d{1,2})?\b|\bseason[ ._-]?(\d{1,2})\b|сезон[ ._-]?(\d{1,2})|\b(\d{1,2})[ ._-]?сезон");

pub fn parse(name: &str) -> ReleaseInfo {
    // An underscore separates words in many names ("s01e01_Pilot.avi", "Show_1080p_WEB"), but
    // regex's word boundary counts it as a letter: read it as a space.
    let spaced = name.replace('_', " ");
    let name = spaced.as_str();
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
    info.languages = audio_languages(name);
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
    if !info.episodes.is_empty() {
        info.total = OF_TOTAL.captures(name).and_then(|c| c[1].parse().ok()).filter(|t: &u16| info.episodes.last().is_some_and(|l| l <= t));
    } else if let Some(c) = BRACKET_RANGE.captures(name).filter(|_| !PART.is_match(name)) {
        // "[E25 of 25]": the first 25; "[001-053 из 500]": 1 to 53 of 500. Never past the total
        // (a year range "[2005-2020, …" has no total after it anyway).
        let a: u16 = c[1].parse().unwrap_or(0);
        let b: Option<u16> = c.get(2).and_then(|m| m.as_str().parse().ok());
        let total: u16 = c[3].parse().unwrap_or(0);
        let (first, last) = match b {
            Some(b) => (a, b),
            None => (1, a),
        };
        if first >= 1 && first <= last && last <= total {
            info.episodes = (first..=last).collect();
            info.total = Some(total);
            info.season_pack = false;
        }
    }
    info
}

/// How good the picture is, for ranking (higher is better); unknown is low.
pub fn quality_score(info: &ReleaseInfo) -> u32 {
    resolution_score(info) + source_score(info)
}

/// The picture size alone: what ranks releases first (people sharing come next, then the source).
pub fn resolution_score(info: &ReleaseInfo) -> u32 {
    match info.resolution {
        Some(2160) => 40,
        Some(1080) => 30,
        Some(720) => 20,
        Some(576 | 480) => 10,
        _ => 5,
    }
}

/// Remux over BluRay over WEB…: only between releases equal in size and people sharing.
pub fn source_score(info: &ReleaseInfo) -> u32 {
    match info.source {
        Some("remux") => 5,
        Some("bluray") => 4,
        Some("web") => 3,
        Some("hdtv") => 2,
        Some("dvd") => 1,
        _ => 0,
    }
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
    fn underscores_separate_words() {
        let i = parse("s01e01_Pilot.avi");
        assert_eq!((i.season, i.episodes.clone()), (Some(1), vec![1]));
        assert_eq!(parse("Show_S02E05_1080p_WEB").resolution, Some(1080));
        assert_eq!(parse("Season_01").season, Some(1));
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
    fn anime_ranges_in_brackets_in_any_language() {
        let i = parse("Наруто Ураганные Хроники (S2) / Naruto Shippuuden (Датэ Хаято) [TV] [001-053 из 500] [JAP+Sub] [2007, приключения]");
        assert_eq!((i.season, i.episodes.first(), i.episodes.last(), i.total), (Some(2), Some(&1), Some(&53), Some(500)));
        let i = parse("Naruto Shippuuden (S2) [TV] [362-500 из 500] [2007]");
        assert_eq!((i.episodes.first(), i.episodes.last()), (Some(&362), Some(&500)));
        let i = parse("Атака титанов (S1) / Shingeki no Kyojin [TV] [E25 of 25] [RUS(int), JAP+Sub] [2013]");
        assert_eq!((i.season, i.episodes.len(), i.total), (Some(1), 25, Some(25)));
        let i = parse("Фрирен (S1) / Sousou no Frieren [TV+Special] [E28+11 of 28+11] [JAP+Sub] & [E28+0 of 28+0]");
        assert_eq!((i.episodes.len(), i.total), (28, Some(28)), "the first bracket, without the specials");
        // Another language's word: the structure is what counts.
        assert_eq!(parse("Show (S1) [01-12 z 12]").episodes.len(), 12);
        // A year range is no episode range.
        assert!(parse("Show / S1 [2005-2020, США, драма]").episodes.is_empty());
        // A season told in parts: its episodes are the part's, not the season's.
        let i = parse("Атака титанов (S3, часть 1) / Shingeki no Kyojin Season 3 [TV] [E12 of 12]");
        assert_eq!((i.season, i.episodes.is_empty(), i.season_pack), (Some(3), true, true));
        // Jackett's ranges keep their total.
        assert_eq!(parse("Сверхъестественное / Supernatural / S1E1-327 of 327 (…) [2005-2020]").total, Some(327));
        assert_eq!(parse("Во все тяжкие / Breaking Bad / S1E1-7 (7) (Винс Гиллиган)").total, Some(7));
    }

    #[test]
    fn ranges_as_jackett_writes_them() {
        let i = parse("Квест Вижна / VisionQuest / S1E1-8 of 8 [2026, WEB-DL 1080p]");
        assert_eq!((i.season, i.episodes.clone()), (Some(1), (1..=8).collect::<Vec<u16>>()));
        let i = parse("12 12 12 / S1E1 of 8 (Карен Мейн) [2026, WEB-DL 1080p]");
        assert_eq!((i.season, i.episodes.clone()), (Some(1), vec![1]), "an ongoing season: only what is out");
    }
}
