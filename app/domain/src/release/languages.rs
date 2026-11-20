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
    /// ISO 639-1.
    pub language: &'static str,
    /// How it is voiced, when the name says (a dub, a voice-over); None for the original or a
    /// track the name does not describe.
    pub voice: Option<Voice>,
}

/// Where the part of a name after the film's own title starts: its first `[`, year, picture size
/// or source. Words of a title ("The English Patient", "It") are never languages.
static TAIL: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)\[|\b(19|20)\d{2}\b|\b(2160|1080|720|576|480)[pi]\b|\b(4k|uhd|remux|blu-?ray|bdrip|brrip|web-?dl|webrip|hdtv(rip)?|dvd(rip|5|9)?)\b")
        .expect("valid regex")
});

/// Words that name subtitles: the languages with or after them are the subtitles'.
fn subtitle_word(w: &str) -> bool {
    matches!(w, "sub" | "subs" | "subtitles" | "субтитры" | "сабы")
}

/// A word as a language: a three-letter code or a name, in Latin ("Eng", "ITA", "iTALiAN") or
/// a Russian or Ukrainian name ("русский", "англійська"). Never a two-letter code: "it", "no",
/// "de" are words too.
fn language_word(w: &str) -> Option<&'static str> {
    if w == "jap" {
        return Some("ja");
    }
    for (prefix, code) in [("русск", "ru"), ("англ", "en"), ("украин", "uk"), ("україн", "uk"), ("японск", "ja")] {
        if w.starts_with(prefix) {
            return Some(code);
        }
    }
    (w.chars().count() >= 3).then(|| files::language(w)).flatten()
}

/// The language a name's untold voice-over is in: Russian trackers name the voice alone ("MVO +
/// Original Eng"), Ukrainian ones write Ukrainian letters; a Latin name says nothing.
fn voiced_language(name: &str) -> Option<&'static str> {
    if name.chars().any(|c| matches!(c, 'і' | 'ї' | 'є' | 'ґ' | 'І' | 'Ї' | 'Є' | 'Ґ')) {
        Some("uk")
    } else if name.chars().any(|c| matches!(c, 'а'..='я' | 'А'..='Я' | 'ё' | 'Ё')) {
        Some("ru")
    } else {
        None
    }
}

/// The audio languages `name` says, in the order it names them; a language named twice keeps its
/// best voice. Subtitles ("Sub (Rus, Eng)", "Eng Sub") are not audio.
pub fn audio_languages(name: &str) -> Vec<AudioLanguage> {
    let Some(start) = TAIL.find(name).map(|m| m.start()) else { return Vec::new() };
    let tail = &name[start..];
    let mut found: Vec<AudioLanguage> = Vec::new();
    let mut add = |language: &'static str, voice: Option<Voice>| match found.iter_mut().find(|a| a.language == language) {
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
            (false, _) => languages.into_iter().for_each(|l| add(l, voice)),
            (true, Some(v)) => {
                if let Some(l) = voiced_language(name) {
                    add(l, Some(v));
                }
            }
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

    fn said(name: &str) -> Vec<(&'static str, Option<Voice>)> {
        audio_languages(name).into_iter().map(|a| (a.language, a.voice)).collect()
    }

    #[test]
    fn russian_tracker_names() {
        assert_eq!(
            said("Ночь живых мертвецов / Night of the Living Dead (Джордж А. Ромеро / George A. Romero) [1968, США, ужасы, DVDRip] MVO + Original Eng + Sub (Rus, Eng)"),
            vec![("ru", Some(Voice::Mvo)), ("en", None)]
        );
        assert_eq!(
            said("Матрица / The Matrix [1999, США, BDRip 1080p] Dub + MVO + AVO (Гаврилов) + Original Eng"),
            vec![("ru", Some(Voice::Dub)), ("en", None)]
        );
        assert_eq!(said("Фильм / Film [2010, WEB-DL 1080p] Rus, Eng | Sub Rus"), vec![("ru", None), ("en", None)]);
        assert_eq!(said("Фильм / Film [2010, BDRip] Дублированный (Русский) + Оригинал"), vec![("ru", Some(Voice::Dub))]);
    }

    #[test]
    fn anime_brackets() {
        assert_eq!(said("Атака титанов (S1) / Shingeki no Kyojin [TV] [E25 of 25] [RUS(int), JAP+Sub] [2013]"), vec![("ru", None), ("ja", None)]);
        assert_eq!(said("Фрирен (S1) / Sousou no Frieren [TV] [E28 of 28] [JAP+Sub]"), vec![("ja", None)]);
    }

    #[test]
    fn ukrainian_names() {
        assert_eq!(said("Назва / Title (2010) 1080p Ukr/Eng | Sub Ukr"), vec![("uk", None), ("en", None)]);
        assert_eq!(said("Дюна: Частина друга / Dune: Part Two (2024) 2160p Ukr Dub + Eng"), vec![("uk", Some(Voice::Dub)), ("en", None)]);
        // A voice alone in a name with Ukrainian letters is Ukrainian.
        assert_eq!(said("Мисливці / Hunters (2024) 1080p Dub"), vec![("uk", Some(Voice::Dub))]);
    }

    #[test]
    fn scene_names() {
        assert!(said("Sintel.2010.1080p.BluRay.x264-OpenFilm").is_empty());
        assert_eq!(said("Film.2010.iTALiAN.1080p.BluRay.x264"), vec![("it", None)]);
        assert_eq!(said("Film.2010.1080p.WEB-DL.ITA.ENG.DDP5.1"), vec![("it", None), ("en", None)]);
        // MULTi and DUAL say there are several, not which.
        assert!(said("Film.2010.MULTi.1080p.BluRay").is_empty());
        // A voice-over in a Latin name says no language.
        assert!(said("Film.2010.1080p.WEB.MVO").is_empty());
    }

    #[test]
    fn title_words_are_not_languages() {
        assert!(said("The.English.Patient.1996.1080p.BluRay").is_empty());
        assert!(said("The French Connection 1971 720p").is_empty());
        assert!(said("It.2017.1080p.WEB").is_empty());
        assert!(said("No name of a year or size at all English").is_empty());
    }

    #[test]
    fn subtitles_are_not_audio() {
        assert_eq!(said("Film 2010 1080p Rus + Eng Sub"), vec![("ru", None)]);
        assert_eq!(said("Film 2010 1080p Subs: English, Russian"), vec![]);
    }
}
