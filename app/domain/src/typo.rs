//! Text from the metadata sources as reel shows it: typographic rules a source does not follow
//! (TMDB, AniList write as their contributors type), applied once here so every screen gets it.

/// Languages whose typesetting keeps a one- or two-letter word with the next one: a line never
/// ends on "в", "и", "z", "w" (Russian, Ukrainian, Belarusian, Bulgarian, Polish, Czech, Slovak).
const NO_SHORT_WORD_AT_LINE_END: [&str; 7] = ["ru", "uk", "be", "bg", "pl", "cs", "sk"];
const NBSP: char = '\u{00A0}';

/// A title or a description tidied for `lang` (a tag like "ru-RU"):
/// - "..." becomes one ellipsis character, and a run of ellipses becomes one;
/// - in the languages above, the space after a one- or two-letter word (a preposition, a
///   conjunction) does not break, so the word stays with the next one.
pub fn tidy(text: &str, lang: &str) -> String {
    let mut out = text.replace("...", "…");
    while out.contains("……") {
        out = out.replace("……", "…");
    }
    let base = lang.split(['-', '_']).next().unwrap_or("");
    if !NO_SHORT_WORD_AT_LINE_END.contains(&base) {
        return out;
    }
    let mut glued = String::with_capacity(out.len());
    let mut word = 0usize;
    for c in out.chars() {
        if c == ' ' && (1..=2).contains(&word) {
            glued.push(NBSP);
        } else {
            glued.push(c);
        }
        word = if c.is_alphabetic() { word + 1 } else { 0 };
    }
    glued
}

/// A description short enough for a hero (about three lines): whole sentences up to `most`
/// characters; the first sentence cut at a word with an ellipsis when even it is longer.
pub fn short_about(text: &str, most: usize) -> String {
    let text = text.trim();
    if text.chars().count() <= most {
        return text.to_owned();
    }
    let mut end = 0usize;
    let mut count = 0usize;
    for (i, c) in text.char_indices() {
        count += 1;
        if count > most {
            break;
        }
        let next = text[i + c.len_utf8()..].chars().next();
        if matches!(c, '.' | '!' | '?' | '…') && next.is_none_or(char::is_whitespace) {
            end = i + c.len_utf8();
        }
    }
    if end > 0 {
        return text[..end].to_owned();
    }
    let cut: String = text.chars().take(most).collect();
    let at_word = cut.rfind(char::is_whitespace).map_or(cut.as_str(), |i| &cut[..i]);
    format!("{}…", at_word.trim_end_matches([',', ';', ':', ' ', '—', '-']))
}

/// A genre's name in sentence case ("Боевик и Приключения" → "Боевик и приключения"): its
/// first letter up, the other words down, but a word the source writes with more than one
/// capital stays as it is ("НФ", "Sci-Fi", "TV").
pub fn genre(name: &str) -> String {
    let mut out = Vec::new();
    for (i, w) in name.split(' ').enumerate() {
        let capitals = w.chars().filter(|c| c.is_uppercase()).count();
        if capitals > 1 {
            out.push(w.to_owned());
            continue;
        }
        let lower = w.to_lowercase();
        out.push(if i == 0 {
            let mut c = lower.chars();
            c.next().map(|f| f.to_uppercase().chain(c).collect()).unwrap_or_default()
        } else {
            lower
        });
    }
    out.join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_short_word_keeps_to_the_next_in_slavic_languages() {
        assert_eq!(tidy("Провожающая в последний путь", "ru-RU"), "Провожающая в\u{a0}последний путь");
        assert_eq!(tidy("Kot i pies w domu", "pl-PL"), "Kot i\u{a0}pies w\u{a0}domu");
        // Not in English: "a"/"of" may end a line there.
        assert_eq!(tidy("A tale of two cities", "en-US"), "A tale of two cities");
    }

    #[test]
    fn dots_become_one_ellipsis() {
        assert_eq!(tidy("мгновением... и", "ru-RU"), "мгновением… и");
        assert_eq!(tidy("so…… then", "en-US"), "so… then");
    }

    #[test]
    fn a_short_about_ends_on_a_sentence() {
        let t = "First sentence here. Second one is longer and goes on. Third.";
        assert_eq!(short_about(t, 40), "First sentence here.");
        assert_eq!(short_about(t, 200), t);
        // An ellipsis inside the text ends a sentence too, not "……".
        assert_eq!(short_about("Годы шли… и однажды пришло время, которого никто не ждал.", 20), "Годы шли…");
        // One long sentence: cut at a word.
        assert_eq!(short_about("one two three four five six", 12), "one two…");
    }

    #[test]
    fn genres_in_sentence_case_keep_acronyms() {
        assert_eq!(genre("Боевик и Приключения"), "Боевик и приключения");
        assert_eq!(genre("мультфильм"), "Мультфильм");
        assert_eq!(genre("НФ и Фэнтези"), "НФ и фэнтези");
        assert_eq!(genre("Sci-Fi & Fantasy"), "Sci-Fi & fantasy");
        assert_eq!(genre("Action & Adventure"), "Action & adventure");
    }
}
