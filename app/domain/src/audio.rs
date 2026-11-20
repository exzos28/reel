//! Which audio track of a film plays: the tracks of the wanted language ranked by
//! what the release's track titles say (a dub before voice-overs), commentary and
//! audio description never picked on their own, and what the viewer picked in a
//! title remembered as a `Signature` (language, studio, kind of voice), never by
//! a track's id or place: the episodes of a pack can differ (an extra track), and
//! the audio files beside a video can join later as tracks of their own.

use serde::{Deserialize, Serialize};

use crate::subtitles::{files, tracks::Track};

/// The kind of voice a track's title says, best first.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Voice {
    /// Dubbed ("Dub", "Дубляж").
    Dub,
    /// A voice-over by several voices ("MVO", "Многоголосый").
    Mvo,
    /// By two voices ("DVO", "Двухголосый").
    Dvo,
    /// By one ("AVO", "Одноголосый", "Авторский").
    Avo,
    /// The title says none.
    #[default]
    Untyped,
}

/// The words of a title: split at everything but letters and digits ("Dub_Bravo" is two).
fn words(title: &str) -> impl Iterator<Item = &str> {
    title.split(|c: char| !c.is_alphanumeric()).filter(|w| !w.is_empty())
}

/// What a word (lower case) says of the voice, if anything.
pub(crate) fn voice_word(w: &str) -> Option<Voice> {
    Some(match w {
        "dub" | "dubbed" | "dubbing" => Voice::Dub,
        "mvo" => Voice::Mvo,
        "dvo" => Voice::Dvo,
        "avo" => Voice::Avo,
        w if w.starts_with("дубл") => Voice::Dub,
        w if w.starts_with("многоголос") => Voice::Mvo,
        w if w.starts_with("двухголос") || w.starts_with("двуголос") => Voice::Dvo,
        w if w.starts_with("одноголос") || w.starts_with("авторск") => Voice::Avo,
        _ => return None,
    })
}

/// The kind of voice `title` names (the best one when it names several).
pub fn voice(title: &str) -> Voice {
    words(&title.to_lowercase()).filter_map(voice_word).min().unwrap_or_default()
}

/// Words of a title that name no studio: how it is voiced, its codec and channels, its language.
fn noise(w: &str) -> bool {
    voice_word(w).is_some()
        || w.chars().all(|c| c.is_ascii_digit())
        || w.ends_with("kbps")
        || matches!(
            w,
            "studio" | "studios" | "студия" | "студии" | "закадровый" | "закадровое" | "закадр" | "профессиональный"
                | "профессиональное" | "любительский" | "любительское" | "voice" | "over" | "ac3" | "eac3" | "dts"
                | "hd" | "ma" | "aac" | "truehd" | "flac" | "opus" | "mp3" | "pcm" | "atmos" | "dd" | "ddp" | "kbps"
                | "ch" | "stereo" | "mono" | "original" | "оригинал" | "оригинальный" | "русский" | "английский"
                | "украинский" | "японский" | "казахский" | "узбекский"
        )
        || (w.chars().count() >= 3 && files::language(w).is_some())
}

/// The studio or voices a track's title names, as words to compare: "HDRezka Studio | Dub" →
/// "hdrezka"; empty when it names none.
pub fn studio(title: &str) -> String {
    words(&title.to_lowercase()).filter(|w| !noise(w)).collect::<Vec<_>>().join(" ")
}

/// Commentary or audio description: never played unless picked. Files rarely flag it, so the
/// title says it too ("VO and descriptive commentary", "Комментарии", "AD").
pub fn commentary(t: &Track) -> bool {
    if t.visual_impaired {
        return true;
    }
    let Some(title) = t.title.as_deref() else { return false };
    let lower = title.to_lowercase();
    ["commentar", "коммент", "descriptive", "audio description"].iter().any(|w| lower.contains(w)) || words(title).any(|w| w == "AD")
}

/// The track's language when it is one reel knows (ISO 639-1); None for an untagged track
/// ("und", none) and for a code that is not a language of ours ("jav" on a Japanese track).
pub fn language(t: &Track) -> Option<&str> {
    t.language.as_deref().filter(|l| l.len() == 2 && files::language(l) == Some(*l))
}

/// A track as the viewer's pick is remembered for a title.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct Signature {
    /// ISO 639-1; None for a track without a language of ours.
    pub language: Option<String>,
    /// `studio` of its title.
    pub studio: String,
    pub voice: Voice,
}

impl Signature {
    pub fn of(t: &Track) -> Signature {
        let title = t.title.as_deref().unwrap_or("");
        Signature { language: language(t).map(str::to_owned), studio: studio(title), voice: voice(title) }
    }

    /// The same track in another file: the same language and voice, and the same studio (one's
    /// words all in the other's: "телеканал че" and "телеканал че russia"); a pick whose title
    /// named no studio ("MVO") by its voice alone.
    pub fn matches(&self, t: &Track) -> bool {
        let other = Signature::of(t);
        if other.language != self.language || other.voice != self.voice {
            return false;
        }
        let (a, b): (Vec<&str>, Vec<&str>) = (self.studio.split(' ').collect(), other.studio.split(' ').collect());
        self.studio.is_empty()
            || self.studio == other.studio
            || (!self.studio.is_empty() && !other.studio.is_empty() && (a.iter().all(|w| b.contains(w)) || b.iter().all(|w| a.contains(w))))
    }

    /// Says something to know the track by besides its language.
    pub fn distinct(&self) -> bool {
        !self.studio.is_empty() || self.voice != Voice::Untyped
    }
}

/// The best track of `wanted` (ISO 639-1) in `tracks`: the one remembered for the title, then
/// by voice (`Voice`), then the one the file marks default, then the first. None when no
/// track but commentary has that language.
pub fn best(tracks: &[Track], wanted: &str, remembered: Option<&Signature>) -> Option<usize> {
    tracks
        .iter()
        .enumerate()
        .filter(|(_, t)| !commentary(t) && language(t) == Some(wanted))
        .min_by_key(|(i, t)| {
            let title = t.title.as_deref().unwrap_or("");
            (!remembered.is_some_and(|r| r.matches(t)), voice(title), !t.default, *i)
        })
        .map(|(i, _)| i)
}

/// Whether some track of `tracks` but commentary is in `language`.
pub fn has(tracks: &[Track], language: &str) -> bool {
    best(tracks, language, None).is_some()
}

/// The track a file plays when no language decides: what the player chose, else the one the
/// file marks default, else the first; commentary only when nothing else is there.
pub fn fallback(tracks: &[Track]) -> Option<usize> {
    let plain = |f: &dyn Fn(&Track) -> bool| tracks.iter().position(|t| !commentary(t) && f(t));
    plain(&|t| t.selected).or_else(|| plain(&|t| t.default)).or_else(|| plain(&|_| true)).or((!tracks.is_empty()).then_some(0))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn t(language: Option<&str>, title: &str) -> Track {
        Track {
            language: language.map(String::from),
            title: (!title.is_empty()).then(|| title.to_owned()),
            ..Default::default()
        }
    }

    #[test]
    fn voices_from_free_form_titles() {
        assert_eq!(voice("Dub"), Voice::Dub);
        assert_eq!(voice("Дубляж, Телеканал Че (Russia)"), Voice::Dub);
        assert_eq!(voice("DUB (студия Невафильм)"), Voice::Dub);
        assert_eq!(voice("Dub_Bravo Records Georgia"), Voice::Dub);
        assert_eq!(voice("HDRezka Studio | Dub"), Voice::Dub);
        assert_eq!(voice("MVO, Карусель"), Voice::Mvo);
        assert_eq!(voice("Многоголосый закадровый [FoxCrime/Amedia]"), Voice::Mvo);
        assert_eq!(voice("Двухголосый закадровый, Кубик в Кубе"), Voice::Dvo);
        assert_eq!(voice("Одноголосый закадровый, Гоблин"), Voice::Avo);
        assert_eq!(voice("Авторский, Сербин"), Voice::Avo);
        assert_eq!(voice("HDRezka Studio"), Voice::Untyped);
        assert_eq!(voice("Original"), Voice::Untyped);
        assert_eq!(voice("AC3 5.1 640 kbps"), Voice::Untyped);
        assert_eq!(voice("Dubrovnik"), Voice::Untyped, "a word, not a part of one");
    }

    #[test]
    fn studios_without_the_voice_and_the_codec() {
        assert_eq!(studio("HDRezka Studio | Dub"), "hdrezka");
        assert_eq!(studio("HDRezka Studio"), "hdrezka");
        assert_eq!(studio("DUB (студия Невафильм)"), "невафильм");
        assert_eq!(studio("Dub_Bravo Records Georgia"), "bravo records georgia");
        assert_eq!(studio("Многоголосый закадровый [FoxCrime/Amedia]"), "foxcrime amedia");
        assert_eq!(studio("Dub, AC3 5.1 640 kbps"), "");
        assert_eq!(studio("Rus Dub"), "");
        assert_eq!(studio("MVO, 2x2"), "2x2");
        assert_eq!(studio("Russian LostFilm MVO"), "lostfilm");
        assert_eq!(studio("Русский, оригинал"), "");
    }

    #[test]
    fn commentary_and_description_by_title_or_flag() {
        assert!(commentary(&t(Some("en"), "VO and descriptive commentary")));
        assert!(commentary(&t(Some("en"), "Director's Commentary")));
        assert!(commentary(&t(Some("ru"), "Комментарии режиссёра")));
        assert!(commentary(&t(Some("en"), "English AD")));
        assert!(commentary(&t(Some("en"), "Audio Description")));
        assert!(commentary(&Track { visual_impaired: true, ..t(Some("en"), "") }));
        assert!(!commentary(&t(Some("en"), "Adaptation")));
        assert!(!commentary(&t(Some("ru"), "Dub")));
    }

    #[test]
    fn untagged_and_unknown_codes_are_no_language() {
        assert_eq!(language(&t(Some("ru"), "")), Some("ru"));
        assert_eq!(language(&t(Some("und"), "")), None);
        assert_eq!(language(&t(Some("jav"), "")), None, "suspect on a Japanese track: not mapped");
        assert_eq!(language(&t(None, "")), None);
        assert_eq!(language(&t(Some("kk"), "")), Some("kk"));
        assert_eq!(language(&t(Some("uz"), "")), Some("uz"));
    }

    #[test]
    fn ranks_within_a_language() {
        let tracks = vec![
            Track { default: true, ..t(Some("ru"), "Одноголосый, Гоблин") },
            t(Some("ru"), "MVO, Карусель"),
            t(Some("en"), "Original"),
            t(Some("ru"), "Комментарии"),
            t(Some("ru"), "Дубляж, Невафильм"),
            t(Some("ru"), "HDRezka Studio"),
            t(Some("ru"), "HDRezka Studio | Dub"),
            t(Some("uk"), "Dub"),
        ];
        assert_eq!(best(&tracks, "ru", None), Some(4), "a dub first, the first dub");
        assert_eq!(best(&tracks, "en", None), Some(2));
        assert_eq!(best(&tracks, "uk", None), Some(7), "uk and ru stay apart");
        assert_eq!(best(&tracks, "de", None), None);
        // Remembered: the same studio and voice, not the same studio's other voice.
        let mvo = Signature::of(&tracks[5]);
        assert_eq!(best(&tracks, "ru", Some(&mvo)), Some(5));
        let dub = Signature::of(&tracks[6]);
        assert_eq!(best(&tracks, "ru", Some(&dub)), Some(6));
        // The default flag only breaks a tie.
        let two = vec![t(Some("ru"), "MVO"), Track { default: true, ..t(Some("ru"), "MVO") }];
        assert_eq!(best(&two, "ru", None), Some(1));
        // Never commentary, even alone.
        assert_eq!(best(&[t(Some("en"), "Commentary")], "en", None), None);
    }

    #[test]
    fn many_tracks_of_one_language() {
        let mut tracks: Vec<Track> = (0..21).map(|i| t(Some("ru"), &format!("MVO, Team{i}"))).collect();
        tracks.insert(13, t(Some("ru"), "Дубляж, Pifagor"));
        assert_eq!(best(&tracks, "ru", None), Some(13));
        let picked = Signature::of(&tracks[17]);
        assert_eq!(best(&tracks, "ru", Some(&picked)), Some(17));
    }

    #[test]
    fn remembered_studio_with_more_words() {
        let picked = Signature::of(&t(Some("ru"), "Дубляж, Телеканал Че"));
        assert!(picked.matches(&t(Some("ru"), "Дубляж [Телеканал Че] (Russia)")));
        assert!(!picked.matches(&t(Some("ru"), "MVO, Телеканал Че")));
        assert!(!picked.matches(&t(Some("uk"), "Дубляж, Телеканал Че")));
        assert!(!picked.matches(&t(Some("ru"), "Дубляж, Невафильм")));
        // A pick that named only its voice: that voice, whatever the studio.
        let mvo = Signature::of(&t(Some("ru"), "MVO"));
        let tracks = [t(Some("ru"), "Dub"), t(Some("ru"), "MVO, Карусель")];
        assert_eq!(best(&tracks, "ru", Some(&mvo)), Some(1));
    }

    #[test]
    fn the_files_own_choice_without_commentary() {
        let tracks = vec![t(Some("en"), "Commentary"), Track { default: true, ..t(None, "") }, t(None, "")];
        assert_eq!(fallback(&tracks), Some(1));
        let selected = vec![t(None, ""), Track { selected: true, ..t(None, "") }];
        assert_eq!(fallback(&selected), Some(1));
        assert_eq!(fallback(&tracks[..1]), Some(0), "commentary when it is all there is");
        assert_eq!(fallback(&[]), None);
    }
}
