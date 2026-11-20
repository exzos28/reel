//! Which file of a multi-file torrent is a given episode.

use crate::numbering::Through;
use crate::release;

const VIDEO: [&str; 8] = ["mp4", "m4v", "mov", "mkv", "webm", "avi", "ts", "m2ts"];

pub fn is_video(name: &str) -> bool {
    name.rsplit_once('.').is_some_and(|(_, ext)| VIDEO.iter().any(|v| ext.eq_ignore_ascii_case(v)))
}

/// The file (index into the torrent) to play: for a film, the largest video; for an episode,
/// one way of numbering decided once for the whole pack (not one tried after another, which
/// would play a wrong episode when the right one is missing):
/// - names that say the season and episode ("S01E03", the season maybe only in a folder);
/// - else the number that changes from file to file ("Title - 03 [1080p]", "Title 03.mkv",
///   "Shippuuden 362 RAW"): the episode's own number;
/// - else, when no name carries a number at all, the `episode`-th video in name order.
///
/// Extras beside the episodes (openings, endings, specials, trailers, samples) are never an
/// episode. `files` are (index, path, length).
///
/// `through` is the season's place in the show's numbering (`Numbering::through_of`): a pack
/// whose numbers reach past the season's size, up to where the season starts, is numbered
/// through the show (`Интерны_143` is S8E3), and its numbers are read so. A file in a folder
/// of another season is never this season's.
pub fn pick(files: &[(usize, String, u64)], episode: Option<(u16, u16)>, through: Option<Through>) -> Option<usize> {
    let videos: Vec<&(usize, String, u64)> = files.iter().filter(|(_, n, _)| is_video(n)).collect();
    let Some((season, ep)) = episode else {
        return videos.iter().max_by_key(|(_, _, len)| *len).map(|(i, _, _)| *i);
    };
    let episodes: Vec<&(usize, String, u64)> = videos.into_iter().filter(|(_, p, _)| !is_extra(p)).collect();
    // The episode's own number in its season (TMDB numbers some shows through the show).
    let ep = match through {
        Some(t) => t.local(ep)?,
        None => ep,
    };

    // Names with the season and episode.
    let said: Vec<(&(usize, String, u64), crate::release::ReleaseInfo, Option<u16>)> = episodes
        .iter()
        .map(|f| {
            let file = file_name(&f.1);
            (*f, release::parse(file), release::parse(&f.1).season)
        })
        .filter(|(_, info, _)| !info.episodes.is_empty())
        .collect();
    if !said.is_empty() {
        return said
            .iter()
            .find(|(_, info, folder)| info.season.or(*folder).is_none_or(|s| s == season) && info.episodes.contains(&ep))
            .map(|(f, _, _)| f.0);
    }

    // The number that changes from file to file: the season's own, or the show's when the pack
    // numbers through it.
    if let Some(numbers) = varying_numbers(&episodes) {
        let most = numbers.iter().copied().max().unwrap_or(0);
        let wanted = match through {
            Some(t) if most > t.size && most >= t.start => t.start + ep - 1,
            _ => ep,
        };
        return episodes
            .iter()
            .zip(numbers)
            .find(|(f, n)| *n == wanted && folder_season(&f.1).is_none_or(|s| s == season))
            .map(|(f, _)| f.0);
    }

    // No number anywhere: the n-th video in name order.
    let mut sorted = episodes;
    sorted.sort_by(|a, b| a.1.cmp(&b.1));
    sorted.get(ep.checked_sub(1)? as usize).map(|(i, _, _)| *i)
}

/// The season a file's folders name ("07 сезон/…", "Season 2/…"), if any.
fn folder_season(path: &str) -> Option<u16> {
    let folder = path.rsplit_once(['/', '\\']).map(|(f, _)| f)?;
    release::parse(folder).season
}

fn file_name(path: &str) -> &str {
    path.rsplit(['/', '\\']).next().unwrap_or(path)
}

/// Folder names that hold extras, whole words in any case ("OP-ED [Creditless]", "Extras",
/// "Special", "Bonus").
const EXTRA_FOLDERS: [&str; 16] =
    ["op", "ed", "ncop", "nced", "creditless", "opening", "openings", "ending", "endings", "extra", "extras", "bonus", "special", "specials", "trailers", "samples"];
/// The same in a file's own name, only as tags release groups write in capitals ("Naruto ED - 01",
/// "NCOP1", "Creditless"): a word like "Ending" or "Special" may be an episode's title.
const EXTRA_TAGS: [&str; 9] = ["OP", "ED", "NCOP", "NCED", "Creditless", "CREDITLESS", "PV", "Trailer", "Sample"];

/// Whether the file is an extra beside the episodes: in a folder named so, or tagged so.
pub fn is_extra(path: &str) -> bool {
    let mut parts: Vec<&str> = path.split(['/', '\\']).collect();
    let file = parts.pop().unwrap_or("");
    let words = |s: &str| s.split(|c: char| !c.is_alphanumeric()).filter(|w| !w.is_empty()).map(str::to_owned).collect::<Vec<_>>();
    let in_folder = parts.iter().any(|folder| words(folder).iter().any(|w| EXTRA_FOLDERS.contains(&w.to_lowercase().as_str())));
    let tagged = words(file).iter().any(|w| {
        let bare = w.trim_end_matches(|c: char| c.is_ascii_digit());
        EXTRA_TAGS.contains(&bare) && (bare.len() > 2 || bare.chars().all(|c| c.is_ascii_uppercase()))
    });
    in_folder || tagged
}

/// The numbers in a file's name, in order, except those of tags around them: a resolution
/// ("1080p", "768x576"), a codec's ("H.264", "x265", "10bit", "DDP2.0"), a hash ("[A1B2C3D4]").
fn numbers(file: &str) -> Vec<u16> {
    let stem = file.rsplit_once('.').map_or(file, |(s, _)| s);
    let mut out = Vec::new();
    let chars: Vec<char> = stem.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        if chars[i].is_ascii_digit() {
            let start = i;
            while i < chars.len() && chars[i].is_ascii_digit() {
                i += 1;
            }
            // Glued to a letter on either side ("x264", "10bit", "1080p", "S3", "P1"): a tag, not an episode.
            let before = start.checked_sub(1).map(|j| chars[j]);
            let after = chars.get(i).copied();
            // An episode's own E ("E01", "- E12") is no tag.
            let episode_e = matches!(before, Some('E' | 'e')) && (start < 2 || !chars[start - 2].is_alphabetic());
            let glued = (before.is_some_and(char::is_alphabetic) && !episode_e) || after.is_some_and(char::is_alphabetic);
            // A decimal ("2.0", "5.1", "H.264"): part of an audio or codec tag.
            let decimal = before == Some('.') && start >= 2 && chars[start - 2].is_ascii_digit()
                || after == Some('.') && chars.get(i + 1).is_some_and(char::is_ascii_digit)
                || before == Some('.') && start >= 2 && chars[start - 2].is_alphabetic();
            let digits: String = chars[start..i].iter().collect();
            if !glued && !decimal && digits.len() <= 4 {
                if let Ok(n) = digits.parse() {
                    out.push(n);
                }
            }
        } else {
            i += 1;
        }
    }
    out
}

/// Each file's episode number, when the pack numbers its files: the first position where the
/// files' numbers differ (and every file has a number there). None when they do not.
fn varying_numbers(files: &[&(usize, String, u64)]) -> Option<Vec<u16>> {
    if files.len() < 2 {
        return None;
    }
    let all: Vec<Vec<u16>> = files.iter().map(|f| numbers(file_name(&f.1))).collect();
    let shortest = all.iter().map(Vec::len).min()?;
    let at = (0..shortest).find(|&k| all.iter().any(|n| n[k] != all[0][k]))?;
    Some(all.iter().map(|n| n[at]).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn files(names: &[&str]) -> Vec<(usize, String, u64)> {
        names.iter().enumerate().map(|(i, n)| (i, n.to_string(), 1000 + i as u64)).collect()
    }

    #[test]
    fn episodes_named_with_underscores() {
        // A whole show's pack: "Season_01/s01e01_Pilot.avi" (seen on a 327-episode release).
        let f = files(&["Season_13/s13e15_A.Most.Holy.Man.avi", "Season_01/s01e02_Wendigo.avi", "Season_01/s01e01_Pilot.avi", "Season_02/s02e01_In.My.Time.of.Dying.avi"]);
        assert_eq!(pick(&f, Some((1, 1)), None), Some(2));
        assert_eq!(pick(&f, Some((2, 1)), None), Some(3));
        assert_eq!(pick(&f, Some((13, 15)), None), Some(0));
    }

    #[test]
    fn film_takes_the_largest_video() {
        let f = vec![(0, "a/sample.mkv".into(), 10), (1, "a/film.mkv".into(), 900), (2, "a/cover.jpg".into(), 5000)];
        assert_eq!(pick(&f, None, None), Some(1));
    }

    #[test]
    fn episode_by_sxxeyy() {
        let f = files(&["Show S01/Show.S01E01.mkv", "Show S01/Show.S01E02.mkv", "Show S01/Show.S01E03.mkv", "Show S01/poster.jpg"]);
        assert_eq!(pick(&f, Some((1, 2)), None), Some(1));
        assert_eq!(pick(&f, Some((2, 2)), None), None, "another season is not in this pack");
        assert_eq!(pick(&f, Some((1, 9)), None), None, "a missing episode is not a guess");
    }

    #[test]
    fn episode_by_leading_number_or_order() {
        let f = files(&["Season 1/01 - Planet of Peril.mkv", "Season 1/02 - The Tunnel of Terror.mkv"]);
        assert_eq!(pick(&f, Some((1, 2)), None), Some(1));
        let plain = files(&["Season 1/a.mkv", "Season 1/b.mkv", "Season 1/c.mkv"]);
        assert_eq!(pick(&plain, Some((1, 3)), None), Some(2));
        assert_eq!(pick(&plain, Some((1, 9)), None), None);
    }

    #[test]
    fn numbers_that_are_not_episodes() {
        assert_eq!(numbers("[SOFCJ-Raws] Naruto - 096 (DVDRip 768x576 HEVC VFR 10bit FLAC).mkv"), vec![96]);
        assert_eq!(numbers("Frieren.S02.WEB-DL.JPN.DDP2.0.H.264.mkv"), Vec::<u16>::new());
        assert_eq!(numbers("[SOFCJ-Raws] Shingeki no Kyojin - S3 - P1 - E05 [WEB-DL KP 1080p].mkv"), vec![5]);
        assert_eq!(numbers("Доктор кто 02 - 01 - Новая Земля.mkv"), vec![2, 1]);
        assert_eq!(numbers("E12.mkv"), vec![12]);
    }

    // Packs as they are on a tracker (docs/release-names.md).
    #[test]
    fn extras_are_never_an_episode() {
        let naruto = files(&[
            "OP-ED [Creditless]/Endings/[SOFCJ-Raws] Naruto ED - 01 (DVDRip 768x576 HEVC VFR 10bit FLAC).mkv",
            "OP-ED [Creditless]/Openings/[SOFCJ-Raws] Naruto OP - 07 (DVDRip 768x576 HEVC VFR 10bit FLAC).mkv",
            "[SOFCJ-Raws] Naruto - 001 (DVDRip 768x576 HEVC VFR 10bit FLAC).mkv",
            "[SOFCJ-Raws] Naruto - 002 (DVDRip 768x576 HEVC VFR 10bit FLAC).mkv",
            "[SOFCJ-Raws] Naruto - 023 (DVDRip 768x576 HEVC VFR 10bit FLAC).mkv",
        ]);
        assert_eq!(pick(&naruto, Some((1, 1)), None), Some(2));
        assert_eq!(pick(&naruto, Some((1, 23)), None), Some(4));
        assert_eq!(pick(&naruto, Some((1, 7)), None), None, "an opening's number is not an episode");
        let frieren = files(&[
            "Special/[Beatrice-Raws] Sousou no Frieren - 01 [BDRip 1080p x265 Dolby TrueHD].mkv",
            "[Beatrice-Raws] Sousou no Frieren - 01 [BDRip 1080p x265 Dolby TrueHD].mkv",
            "[Beatrice-Raws] Sousou no Frieren - 02 [BDRip 1080p x265 Dolby TrueHD].mkv",
        ]);
        assert_eq!(pick(&frieren, Some((1, 1)), None), Some(1));
        let shippuuden = files(&[
            "Creditless OP-ED/[SOFCJ-Raws] Naruto Shippuuden - ED 01 Creditless (DVDRip 768x576 x264 10bit FLAC).mkv",
            "Extras/Naruto Super Hits 2006-2008 Promo [DVDRip].mkv",
            "[SOFCJ-Raws] Naruto Shippuuden - 001 (DVDRip 768x576 x264 VFR 10bit AC3).mkv",
            "[SOFCJ-Raws] Naruto Shippuuden - 002 (DVDRip 768x576 x264 VFR 10bit AC3).mkv",
        ]);
        assert_eq!(pick(&shippuuden, Some((1, 1)), None), Some(2));
        // A word like "Ending" in an episode's own title is no extra.
        assert!(!is_extra("Show.S01E10.The.Ending.mkv"));
        assert!(!is_extra("Criminal.Minds.S01E01.mkv"));
    }

    #[test]
    fn a_pack_numbered_through_the_show() {
        use crate::numbering::Numbering;
        // Интерны S7–9 (seasons of 20): S8E3 is the show's 143, in "08 сезон".
        let n = Numbering(vec![20; 14]);
        let f = files(&["07 сезон/Интерны_121.avi", "07 сезон/Интерны_122.avi", "08 сезон/Интерны_141.avi", "08 сезон/Интерны_143.avi", "09 сезон/Интерны_163.avi"]);
        assert_eq!(pick(&f, Some((8, 3)), n.through_of(8)), Some(3));
        assert_eq!(pick(&f, Some((7, 2)), n.through_of(7)), Some(1));
        // A file numbered so but in another season's folder is not it.
        let wrong = files(&["07 сезон/Интерны_121.avi", "07 сезон/Интерны_143.avi"]);
        assert_eq!(pick(&wrong, Some((8, 3)), n.through_of(8)), None);
        // Naruto, TMDB's five seasons in one pack numbered 001–220: S2E1 is 058.
        let naruto = Numbering(vec![57, 43, 41, 42, 37]);
        let f = files(&["[SOFCJ-Raws] Naruto - 001 (DVDRip).mkv", "[SOFCJ-Raws] Naruto - 057 (DVDRip).mkv", "[SOFCJ-Raws] Naruto - 058 (DVDRip).mkv"]);
        assert_eq!(pick(&f, Some((2, 1)), naruto.through_of(2)), Some(2));
        assert_eq!(pick(&f, Some((1, 57)), naruto.through_of(1)), Some(1));
        // TMDB's own Naruto numbers its seasons through: S2's first is 53, in the pack's 053.
        let tmdb = Numbering(vec![52, 52, 54, 62]);
        let f = files(&["[SOFCJ-Raws] Naruto - 052 (DVDRip).mkv", "[SOFCJ-Raws] Naruto - 053 (DVDRip).mkv", "[SOFCJ-Raws] Naruto - 054 (DVDRip).mkv"]);
        assert_eq!(pick(&f, Some((2, 53)), tmdb.through_of(2)), Some(1));
        let own = files(&["Naruto.S02E01.mkv", "Naruto.S02E02.mkv"]);
        assert_eq!(pick(&own, Some((2, 54)), tmdb.through_of(2)), Some(1), "S2E54 is the season's second");
        // A season's own pack keeps its own numbers, even when TMDB counts it one short.
        let own = files(&["Show - 01.mkv", "Show - 02.mkv", "Show - 24.mkv"]);
        assert_eq!(pick(&own, Some((3, 2)), Numbering(vec![20, 20, 23]).through_of(3)), Some(1));
    }

    #[test]
    fn the_number_that_changes_is_the_episode() {
        let raw = files(&["17# War [362-372]/NARUTO Shippuuden 362 RAW.mp4", "17# War [362-372]/NARUTO Shippuuden 363 RAW.mp4"]);
        assert_eq!(pick(&raw, Some((1, 363)), None), Some(1));
        let aot = files(&["[SOFCJ-Raws] Shingeki no Kyojin - S3 - P1 - E01 [WEB-DL KP 1080p].mkv", "[SOFCJ-Raws] Shingeki no Kyojin - S3 - P1 - E02 [WEB-DL KP 1080p].mkv"]);
        assert_eq!(pick(&aot, Some((3, 2)), None), Some(1));
        let who = files(&["Доктор кто 02 - 00 - Рождественское вторжение.mkv", "Доктор кто 02 - 01 - Новая Земля.mkv", "Доктор кто 02 - 02 - Зуб и коготь.mkv"]);
        assert_eq!(pick(&who, Some((2, 1)), None), Some(1), "02 - 01 is the first episode, not the special 00");
        let jjk = files(&["[BudLightSubs] Jujutsu Kaisen S3 - 01 [1080p].mkv", "[BudLightSubs] Jujutsu Kaisen S3 - 02 [1080p].mkv"]);
        assert_eq!(pick(&jjk, Some((3, 2)), None), Some(1));
        // A missing episode is not another one by order.
        let gap = files(&["Show - 01.mkv", "Show - 02.mkv", "Show - 04.mkv"]);
        assert_eq!(pick(&gap, Some((1, 3)), None), None);
    }
}

