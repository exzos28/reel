//! The audio a release name says it carries: its languages and, where the name says it, how
//! each is voiced ("MVO + Original Eng", "[RUS(int), JAP+Sub]", "Film.2010.iTALiAN.1080p").
//! Best effort and never guessed: a name that names no language gives none.

use std::sync::LazyLock;

use regex::Regex;
use serde::Serialize;

use crate::audio::{Voice, voice_word};
use crate::subtitles::files;

/// One audio language of a release.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct AudioLanguage {
    /// ISO 639-1; None for a voice-over whose language the name does not tell.
    pub language: Option<&'static str>,
    /// How it is voiced, when the name says (a dub, a voice-over); None for the original or a
    /// track the name does not describe.
    pub voice: Option<Voice>,
}

/// Where the part of a name after the film's own title starts: its first `[`, year, picture size
/// or source. Words of a title ("The English Patient", "It") are never languages.
static TAIL: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\[|\b(19|20)\d{2}\b").expect("valid regex"));
/// A picture size or source: the release's own words follow.
static TECH: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)\b(2160|1080|720|576|480)[pi]\b|\b(4k|uhd|remux|blu-?ray|bdrip|brrip|web-?dl|webrip|web|hdtv(rip)?|dvd(rip|5|9)?)\b")
        .expect("valid regex")
});
/// An episode's number: its title follows ("S01E03.The.English.Job"), up to the picture size.
static EPISODE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)\bS\d{1,2}[ ._-]?E\d{1,3}\b").expect("valid regex"));

/// The part of `name` its own words are in: from its first `[`, year, picture size or source;
/// an episode's title (between its number and the picture size) left out.
fn tail(name: &str) -> String {
    let start = [TAIL.find(name), TECH.find(name)].into_iter().flatten().map(|m| m.start()).min();
    let Some(start) = start else { return String::new() };
    let tail = &name[start..];
    match EPISODE.find(tail) {
        Some(e) => {
            let after = TECH.find_at(tail, e.end()).map_or(tail.len(), |m| m.start());
            format!("{} {}", &tail[..e.start()], &tail[after..])
        }
        None => tail.to_owned(),
    }
}

/// Words that name subtitles: the languages with or after them are the subtitles'.
fn subtitle_word(w: &str) -> bool {
    matches!(w, "sub" | "subs" | "subtitles" | "субтитры" | "сабы")
}

/// A word as a language: a three-letter code or a name, in Latin ("Eng", "ITA", "iTALiAN") or
/// a Russian or Ukrainian name ("русский", "англійська"). Never a two-letter code: "it", "no",
/// "de" are words too.
fn language_word(w: &str) -> Option<&'static str> {
    match w {
        "jap" => return Some("ja"),
        // French releases' tags for French audio.
        "truefrench" | "vff" | "vfq" | "vfi" | "vf2" => return Some("fr"),
        _ => {}
    }
    for (prefix, code) in [("русск", "ru"), ("англ", "en"), ("украин", "uk"), ("україн", "uk"), ("японск", "ja")] {
        if w.starts_with(prefix) {
            return Some(code);
        }
    }
    (w.chars().count() >= 3).then(|| files::language(w)).flatten()
}

/// The language a name's untold voice-over is in: Russian trackers name the voice alone ("MVO +
/// Original Eng"); a name with Ukrainian letters is Ukrainian; one with letters of other
/// Cyrillic languages (Kazakh) or none says nothing.
fn voiced_language(name: &str) -> Option<&'static str> {
    let lower = name.to_lowercase();
    if lower.chars().any(|c| matches!(c, 'і' | 'ї' | 'є' | 'ґ')) {
        Some("uk")
    } else if lower.chars().any(|c| matches!(c, 'ә' | 'ғ' | 'қ' | 'ң' | 'ө' | 'ұ' | 'ү' | 'һ' | 'ў')) {
        None
    } else if lower.chars().any(|c| matches!(c, 'а'..='я' | 'ё')) {
        Some("ru")
    } else {
        None
    }
}

/// The audio languages `name` says, in the order it names them; a language named twice keeps its
/// best voice. Subtitles ("Sub (Rus, Eng)", "Eng Sub") are not audio.
pub fn audio_languages(name: &str) -> Vec<AudioLanguage> {
    let tail = tail(name);
    let mut found: Vec<AudioLanguage> = Vec::new();
    let mut add = |language: Option<&'static str>, voice: Option<Voice>| match found.iter_mut().find(|a| a.language == language) {
        Some(a) => {
            if voice.is_some_and(|v| a.voice.is_none_or(|b| v < b)) {
                a.voice = voice;
            }
        }
        None => found.push(AudioLanguage { language, voice }),
    };
    // Segments end at `+ | [ ] ;`, which also end a run of subtitles, and at `, ( ) /`, which
    // do not ("Sub (Rus, Eng)" is all subtitles).
    let mut in_subtitles = false;
    let mut segment: Vec<String> = Vec::new();
    let mut word = String::new();
    let mut flush = |segment: &mut Vec<String>, in_subtitles: &mut bool| {
        let words = std::mem::take(segment);
        if words.iter().any(|w| subtitle_word(w)) {
            *in_subtitles = true;
        }
        if *in_subtitles {
            return;
        }
        let languages: Vec<&'static str> = words.iter().filter_map(|w| language_word(w)).collect();
        let voice = words.iter().filter_map(|w| voice_word(w)).min();
        match (languages.is_empty(), voice) {
            (false, _) => languages.into_iter().for_each(|l| add(Some(l), voice)),
            (true, Some(v)) => add(voiced_language(name), Some(v)),
            (true, None) => {}
        }
    };
    for c in tail.chars().chain(std::iter::once('+')) {
        if c.is_alphanumeric() {
            word.extend(c.to_lowercase());
            continue;
        }
        if !word.is_empty() {
            segment.push(std::mem::take(&mut word));
        }
        let hard = matches!(c, '+' | '|' | '[' | ']' | ';');
        if hard || matches!(c, ',' | '(' | ')' | '/') {
            flush(&mut segment, &mut in_subtitles);
        }
        if hard {
            in_subtitles = false;
        }
    }
    drop(flush);
    found
}

#[cfg(test)]
mod tests {
    use super::*;

    fn said(name: &str) -> Vec<(Option<&'static str>, Option<Voice>)> {
        audio_languages(name).into_iter().map(|a| (a.language, a.voice)).collect()
    }

    #[test]
    fn russian_tracker_names() {
        assert_eq!(
            said("Ночь живых мертвецов / Night of the Living Dead (Джордж А. Ромеро / George A. Romero) [1968, США, ужасы, DVDRip] MVO + Original Eng + Sub (Rus, Eng)"),
            vec![(Some("ru"), Some(Voice::Mvo)), (Some("en"), None)]
        );
        assert_eq!(
            said("Матрица / The Matrix [1999, США, BDRip 1080p] Dub + MVO + AVO (Гаврилов) + Original Eng"),
            vec![(Some("ru"), Some(Voice::Dub)), (Some("en"), None)]
        );
        assert_eq!(said("Фильм / Film [2010, WEB-DL 1080p] Rus, Eng | Sub Rus"), vec![(Some("ru"), None), (Some("en"), None)]);
        assert_eq!(said("Фильм / Film [2010, BDRip] Дублированный (Русский) + Оригинал"), vec![(Some("ru"), Some(Voice::Dub))]);
    }

    #[test]
    fn anime_brackets() {
        assert_eq!(said("Атака титанов (S1) / Shingeki no Kyojin [TV] [E25 of 25] [RUS(int), JAP+Sub] [2013]"), vec![(Some("ru"), None), (Some("ja"), None)]);
        assert_eq!(said("Фрирен (S1) / Sousou no Frieren [TV] [E28 of 28] [JAP+Sub]"), vec![(Some("ja"), None)]);
    }

    #[test]
    fn ukrainian_names() {
        assert_eq!(said("Назва / Title (2010) 1080p Ukr/Eng | Sub Ukr"), vec![(Some("uk"), None), (Some("en"), None)]);
        assert_eq!(said("Дюна: Частина друга / Dune: Part Two (2024) 2160p Ukr Dub + Eng"), vec![(Some("uk"), Some(Voice::Dub)), (Some("en"), None)]);
        // A voice alone in a name with Ukrainian letters is Ukrainian.
        assert_eq!(said("Мисливці / Hunters (2024) 1080p Dub"), vec![(Some("uk"), Some(Voice::Dub))]);
    }

    #[test]
    fn scene_names() {
        assert!(said("Sintel.2010.1080p.BluRay.x264-OpenFilm").is_empty());
        assert_eq!(said("Film.2010.iTALiAN.1080p.BluRay.x264"), vec![(Some("it"), None)]);
        assert_eq!(said("Film.2010.1080p.WEB-DL.ITA.ENG.DDP5.1"), vec![(Some("it"), None), (Some("en"), None)]);
        // MULTi and DUAL say there are several, not which.
        assert!(said("Film.2010.MULTi.1080p.BluRay").is_empty());
        // A voice-over in a Latin name says no language.
        assert_eq!(said("Film.2010.1080p.WEB.MVO"), vec![(None, Some(Voice::Mvo))]);
        assert_eq!(said("Film.2010.TRUEFRENCH.1080p.BluRay"), vec![(Some("fr"), None)]);
        // Kazakh letters: not Russian.
        assert_eq!(said("Фильм / Film [2010, BDRip] Қазақша Dub"), vec![(None, Some(Voice::Dub))]);
    }

    #[test]
    fn title_words_are_not_languages() {
        assert!(said("The.English.Patient.1996.1080p.BluRay").is_empty());
        assert!(said("The French Connection 1971 720p").is_empty());
        assert!(said("It.2017.1080p.WEB").is_empty());
        assert!(said("No name of a year or size at all English").is_empty());
        // An episode's title.
        assert!(said("Show.2010.S01E03.The.English.Job.1080p.WEB").is_empty());
        assert_eq!(said("Show.S01E03.The.English.Job.1080p.WEB.ENG"), vec![(Some("en"), None)]);
    }

    #[test]
    fn subtitles_are_not_audio() {
        assert_eq!(said("Film 2010 1080p Rus + Eng Sub"), vec![(Some("ru"), None)]);
        assert_eq!(said("Film 2010 1080p Subs: English, Russian"), vec![]);
    }
}
