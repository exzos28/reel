//! Which subtitle files of a torrent go with the video that plays, and what
//! language each is in, read from its name ("Film.en.srt", "Film.Rus.srt",
//! "Subs/2_English.srt", "[ENG] Film.ass").

use serde::Serialize;

use super::parse::Format;
use crate::{episode, release};

/// Bigger than this is not a subtitle file (a few MB holds a long film's ASS).
pub const MAX_BYTES: u64 = 8 * 1024 * 1024;

/// A subtitle file in the torrent.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct SubFile {
    /// The file's index in the torrent: the id the UI picks it by.
    pub id: usize,
    pub path: String,
    pub format: Format,
    /// ISO 639-1 ("en", "ru"), when the name says it.
    pub language: Option<&'static str>,
    /// What else the name says ("Forced", "SDH", a group), may be empty.
    pub label: String,
}

/// Languages by the names files and containers use for them: ISO 639-1 and
/// 639-2 (both B and T) codes and English names.
const LANGUAGES: &[(&str, &[&str])] = &[
    ("en", &["en", "eng", "english"]),
    ("ru", &["ru", "rus", "russian"]),
    ("uk", &["uk", "ukr", "ukrainian"]),
    ("be", &["be", "bel", "belarusian"]),
    ("de", &["de", "ger", "deu", "german"]),
    ("fr", &["fr", "fre", "fra", "french"]),
    ("es", &["es", "spa", "spanish"]),
    ("it", &["it", "ita", "italian"]),
    ("pt", &["pt", "por", "portuguese"]),
    ("pl", &["pl", "pol", "polish"]),
    ("cs", &["cs", "cze", "ces", "czech"]),
    ("nl", &["nl", "dut", "nld", "dutch"]),
    ("sv", &["sv", "swe", "swedish"]),
    ("no", &["no", "nor", "nob", "norwegian"]),
    ("da", &["da", "dan", "danish"]),
    ("fi", &["fi", "fin", "finnish"]),
    ("hu", &["hu", "hun", "hungarian"]),
    ("ro", &["ro", "rum", "ron", "romanian"]),
    ("el", &["el", "gre", "ell", "greek"]),
    ("tr", &["tr", "tur", "turkish"]),
    ("ar", &["ar", "ara", "arabic"]),
    ("he", &["he", "heb", "hebrew"]),
    ("ja", &["ja", "jpn", "japanese"]),
    ("zh", &["zh", "chi", "zho", "chinese"]),
    ("ko", &["ko", "kor", "korean"]),
];

/// A language name or code as ISO 639-1; None for one we do not know.
pub fn language(name: &str) -> Option<&'static str> {
    let name = name.trim().to_ascii_lowercase();
    // "en-US", "pt_BR": the language part.
    let name = name.split(['-', '_']).next().unwrap_or("");
    LANGUAGES.iter().find(|(_, names)| names.contains(&name)).map(|(code, _)| *code)
}

/// The words of a name: split at dots, spaces, brackets, dashes and underscores.
fn words(name: &str) -> Vec<&str> {
    name.split(|c: char| matches!(c, '.' | ' ' | '_' | '-' | '[' | ']' | '(' | ')' | ',' | '+'))
        .filter(|w| !w.is_empty())
        .collect()
}

fn file_name(path: &str) -> &str {
    path.rsplit(['/', '\\']).next().unwrap_or(path)
}

fn stem(name: &str) -> &str {
    name.rsplit_once('.').map_or(name, |(s, _)| s)
}

/// The same episode, when both names give episode numbers.
fn same_episode(a: &str, b: &str) -> bool {
    let (a, b) = (release::parse(a), release::parse(b));
    let seasons_agree = match (a.season, b.season) {
        (Some(x), Some(y)) => x == y,
        _ => true,
    };
    seasons_agree && !a.episodes.is_empty() && a.episodes.iter().any(|e| b.episodes.contains(e))
}

/// The subtitle files of `files` ((index, path, length), as the torrent lists
/// them) that go with video `video`: all of them when it is the only video;
/// else those named like it ("Film.mkv" → "Film.en.srt"), in a folder named
/// like it, or naming the same episode. Ordered by language, then name.
pub fn find(files: &[(usize, String, u64)], video: usize) -> Vec<SubFile> {
    let Some((_, video_path, _)) = files.iter().find(|(i, _, _)| *i == video) else {
        return Vec::new();
    };
    let videos = files.iter().filter(|(_, p, _)| episode::is_video(p)).count();
    let video_stem = stem(file_name(video_path)).to_lowercase();
    let video_words: Vec<String> = words(&video_stem).into_iter().map(str::to_owned).collect();

    let mut found: Vec<SubFile> = files
        .iter()
        .filter(|(_, _, len)| *len > 0 && *len <= MAX_BYTES)
        .filter_map(|(id, path, _)| {
            let format = Format::of(path)?;
            let name = file_name(path);
            let sub_stem = stem(name);
            let lower = sub_stem.to_lowercase();
            let in_folder = path.to_lowercase().split(['/', '\\']).rev().skip(1).any(|dir| dir == video_stem);
            let matches = videos <= 1 || lower.starts_with(&video_stem) || in_folder || same_episode(path, video_path);
            if !matches {
                return None;
            }
            // What the name adds to the video's: the language and a label.
            let extra: Vec<&str> = words(sub_stem)
                .into_iter()
                .filter(|w| !video_words.iter().any(|v| v.eq_ignore_ascii_case(w)))
                .collect();
            // Prefer a longer name ("English") over a two-letter code that may be a word.
            let lang_at = extra
                .iter()
                .enumerate()
                .filter_map(|(i, w)| language(w).map(|l| (i, l, w.len())))
                .max_by_key(|(_, _, len)| (*len).min(3));
            let language = lang_at.map(|(_, l, _)| l);
            let label = extra
                .iter()
                .enumerate()
                .filter(|(i, w)| Some(*i) != lang_at.map(|(i, _, _)| i) && !w.chars().all(|c| c.is_ascii_digit()))
                .map(|(_, w)| *w)
                .collect::<Vec<_>>()
                .join(" ");
            Some(SubFile { id: *id, path: path.clone(), format, language, label })
        })
        .collect();
    found.sort_by(|a, b| (a.language.is_none(), a.language, &a.path).cmp(&(b.language.is_none(), b.language, &b.path)));
    found
}

#[cfg(test)]
mod tests {
    use super::*;

    fn files(names: &[&str]) -> Vec<(usize, String, u64)> {
        names.iter().enumerate().map(|(i, n)| (i, n.to_string(), if episode::is_video(n) { 1 << 30 } else { 40_000 })).collect()
    }

    fn langs(found: &[SubFile]) -> Vec<(usize, Option<&str>, &str)> {
        found.iter().map(|s| (s.id, s.language, s.label.as_str())).collect()
    }

    #[test]
    fn languages_from_codes_and_names() {
        assert_eq!(language("Rus"), Some("ru"));
        assert_eq!(language("ENG"), Some("en"));
        assert_eq!(language("english"), Some("en"));
        assert_eq!(language("pt-BR"), Some("pt"));
        assert_eq!(language("ger"), Some("de"));
        assert_eq!(language("SDH"), None);
    }

    #[test]
    fn a_film_with_subtitles_beside_it() {
        let f = files(&[
            "Sea.Story.2019.1080p/Sea.Story.2019.1080p.mkv",
            "Sea.Story.2019.1080p/Sea.Story.2019.1080p.en.srt",
            "Sea.Story.2019.1080p/Sea.Story.2019.1080p.Rus.Forced.srt",
            "Sea.Story.2019.1080p/Subs/[ENG] SDH.ass",
            "Sea.Story.2019.1080p/cover.jpg",
        ]);
        let found = find(&f, 0);
        assert_eq!(langs(&found), vec![(1, Some("en"), ""), (3, Some("en"), "SDH"), (2, Some("ru"), "Forced")]);
        assert_eq!(found[1].format, Format::Ass);
    }

    #[test]
    fn episodes_take_their_own_subtitles() {
        let f = files(&[
            "Show S01/Show.S01E01.720p.mkv",
            "Show S01/Show.S01E02.720p.mkv",
            "Show S01/Subs/Show.S01E01.rus.srt",
            "Show S01/Subs/Show.S01E02.rus.srt",
            "Show S01/Subs/Show.S01E02.eng.vtt",
            "Show S01/Subs/Show.S01E02.720p/2_English.srt",
        ]);
        let found = find(&f, 1);
        let ids: Vec<usize> = found.iter().map(|s| s.id).collect();
        assert_eq!(ids, vec![5, 4, 3], "English first, then Russian; nothing of episode 1");
        assert_eq!(found[0].language, Some("en"), "in a folder named like the video");
        assert!(find(&f, 0).iter().all(|s| s.id == 2));
    }

    #[test]
    fn unknown_language_and_size_limit() {
        let mut f = files(&["Film.mkv", "Film.srt", "Film.commentary.srt", "Film.huge.srt"]);
        f[3].2 = MAX_BYTES + 1;
        let found = find(&f, 0);
        assert_eq!(langs(&found), vec![(2, None, "commentary"), (1, None, "")]);
    }
}
