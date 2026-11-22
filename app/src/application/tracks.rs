//! The tracks panel: Audio and Subtitles columns, merged from the tracks the video view
//! reports (mpv: embedded audio and subtitles) and the subtitle files of the torrent that
//! plays (`Playback::subtitle_files`), with what is in use and what the view should apply.
//! The subtitles chosen are remembered per title (`progress`). The audio picked is remembered
//! per title too, and its language becomes the one audio is looked for in everywhere
//! (`settings::audio_language`), unless the film had none in the language looked for.

use std::{
    collections::HashMap,
    sync::{LazyLock, Mutex},
};

use serde_json::{Value, json};

use crate::{
    application::{progress, settings},
    wiring::playback,
};
use reel_domain::audio::{self, Signature};
use reel_domain::keys::parse_key;
use reel_domain::subtitles::{
    files::{self, SubFile},
    tracks::{self, Embedded, Track},
};

/// What the viewer picked in a film, by menu key.
#[derive(Default)]
struct Choices {
    audio: Option<String>,
    subtitle: Option<String>,
}

static JOBS: LazyLock<Mutex<HashMap<u32, Choices>>> = LazyLock::new(Default::default);

/// The job ended: its choices go.
pub fn forget(job: u32) {
    JOBS.lock().unwrap().remove(&job);
}

/// The job's subtitle files, once the torrent's metadata is in.
fn job_files(job: u32) -> Option<Vec<SubFile>> {
    playback().subtitle_files(job)
}

/// One subtitle choice of the menu.
#[derive(Debug, Clone, PartialEq)]
enum SubOption {
    Off,
    Embedded(Track),
    External(SubFile),
}

impl SubOption {
    fn key(&self) -> String {
        match self {
            SubOption::Off => "off".into(),
            SubOption::Embedded(t) => format!("e:{}", t.id),
            SubOption::External(f) => format!("x:{}", f.id),
        }
    }

    fn language(&self) -> Option<&str> {
        match self {
            SubOption::Off => None,
            SubOption::Embedded(t) => t.language.as_deref(),
            SubOption::External(f) => f.language,
        }
    }

    /// A track of the lines in another language only (a sign, a phrase): the container's flag,
    /// or a file whose name says "Forced".
    fn forced(&self) -> bool {
        match self {
            SubOption::Off => false,
            SubOption::Embedded(t) => t.forced,
            SubOption::External(f) => f.label.split(|c: char| !c.is_alphanumeric()).any(|w| w.eq_ignore_ascii_case("forced")),
        }
    }

    /// What is remembered for the title when the viewer picks it.
    fn pref(&self) -> String {
        match self {
            SubOption::Off => "off".into(),
            _ => self.language().unwrap_or("?").to_owned(),
        }
    }

    fn json(&self, selected: bool) -> Value {
        match self {
            SubOption::Off => json!({ "key": "off", "kind": "off", "selected": selected }),
            SubOption::Embedded(t) => json!({
                "key": self.key(), "kind": "embedded", "language": t.language, "title": t.title,
                "codec": t.codec, "detail": tracks::detail(t), "forced": t.forced, "selected": selected,
            }),
            SubOption::External(f) => json!({
                "key": self.key(), "kind": "external", "language": f.language, "title": f.label,
                "format": f.format, "forced": self.forced(), "selected": selected,
            }),
        }
    }
}

/// The languages subtitles are picked for when the viewer picked none in the title: the app's
/// (`settings::ui_language`), the audio language the viewer set (`settings::audio_language`), and
/// the language of the audio that plays (None: untagged, unknown, or no tracks yet).
#[derive(Debug, Clone, Copy)]
struct Viewer<'a> {
    ui: &'a str,
    set_audio: Option<&'a str>,
    audio: Option<&'a str>,
}

impl Viewer<'_> {
    /// The audio plays in a language the viewer is known to read (the app's or the one they set
    /// for audio); an audio language not known is never taken for a foreign one.
    fn audio_understood(&self) -> bool {
        self.audio.is_none_or(|a| a == self.ui || self.set_audio == Some(a))
    }
}

/// Which subtitle option is in use: the viewer's pick in this film; else the
/// one remembered for the title (by language: an embedded track first, then a
/// file; a forced track only when nothing else has it); else `by_default`; else off.
fn pick_subtitle(options: &[SubOption], chosen: Option<&str>, pref: Option<&str>, viewer: Viewer) -> usize {
    if let Some(i) = chosen.and_then(|k| options.iter().position(|o| o.key() == k)) {
        return i;
    }
    if let Some(pref) = pref {
        if pref == "off" {
            return 0;
        }
        let wanted = (pref != "?").then_some(pref);
        let by_language = |forced_ok: bool| {
            options.iter().position(|o| {
                !matches!(o, SubOption::Off) && o.language() == wanted && (forced_ok || !o.forced())
            })
        };
        if let Some(i) = by_language(false).or_else(|| by_language(true)) {
            return i;
        }
    }
    by_default(options, viewer).unwrap_or(0)
}

/// The subtitles that come on by themselves, in a language the viewer reads only: audio in a
/// language they do not read gets full subtitles in the app's language (the one the file marks
/// default first, an embedded track before a file); audio they read gets a full track in the
/// app's language only when the file marks it default, else a forced one in the audio's
/// language (its lines in another language). A track the file marks default in another
/// language (Russian for an English app) never comes on by itself.
fn by_default(options: &[SubOption], viewer: Viewer) -> Option<usize> {
    let find = |f: &dyn Fn(&SubOption) -> bool| options.iter().position(|o| !matches!(o, SubOption::Off) && f(o));
    let flagged = |o: &SubOption| matches!(o, SubOption::Embedded(t) if t.default);
    let full_ui = |o: &SubOption| !o.forced() && o.language() == Some(viewer.ui);
    if !viewer.audio_understood() {
        return find(&|o| full_ui(o) && flagged(o)).or_else(|| find(&full_ui));
    }
    find(&|o| full_ui(o) && flagged(o)).or_else(|| find(&|o| o.forced() && viewer.audio.is_some() && o.language() == viewer.audio))
}

/// Which audio track is in use: the viewer's pick in this film; else the one
/// picked in the title (its language, studio and voice: `audio::best`; one
/// without a language only when exactly one track is the same); else the best
/// track of `wanted` (the language picked last, else the app's); else what the
/// view plays, the default one, the first (`audio::fallback`). A track without
/// a language never matches one, and commentary is never picked here.
fn pick_audio(audio: &[Track], chosen: Option<&str>, pref: Option<&Signature>, wanted: &str) -> Option<usize> {
    if audio.is_empty() {
        return None;
    }
    if let Some(i) = chosen.and_then(|k| audio.iter().position(|t| format!("a:{}", t.id) == k)) {
        return Some(i);
    }
    let remembered = pref.and_then(|p| match p.language.as_deref() {
        Some(l) => audio::best(audio, l, Some(p)),
        None if p.distinct() => {
            let same: Vec<usize> =
                (0..audio.len()).filter(|&i| !audio::commentary(&audio[i]) && audio::language(&audio[i]).is_none() && p.matches(&audio[i])).collect();
            (same.len() == 1).then(|| same[0])
        }
        None => None,
    });
    remembered.or_else(|| audio::best(audio, wanted, None)).or_else(|| audio::fallback(audio))
}

/// The languages a player looks for before the tracks are known (mpv's `alang`, "ru,rus"):
/// the title's pick's, else `wanted`; empty for a pick without a language.
fn early_languages(pref: Option<&Signature>, wanted: &str) -> String {
    let language = match pref {
        Some(p) => p.language.as_deref().unwrap_or(""),
        None => wanted,
    };
    files::codes(language).join(",")
}

/// The tracks panel's Audio and Subtitles columns for job `job` playing `key`
/// (a title or an episode; the subtitles are remembered per title).
/// `embedded` is what the video view reports (None where it reports no
/// tracks: then Audio is the one "original" track).
///
/// `{"pending": bool (the files are not known yet), "audio":[{"key","kind",
/// "language","title","codec","channels","selected"}], "subtitles":[{"key",
/// "kind":"off"|"embedded"|"external","language","title","codec"|"format",
/// "forced","selected"}], "apply":{"audio": track id|null, "subtitle": track
/// id|"no"|null (null: the view has no tracks), "external": file id|null (the
/// overlay shows it), "audioLanguages": mpv's `alang` before the tracks are known ("ru,rus")}}`.
pub fn menu(job: u32, key: &str, embedded: Option<&Embedded>) -> Value {
    let files = job_files(job);
    let (title, _) = parse_key(key);
    let (chosen_audio, chosen_sub) = {
        let jobs = JOBS.lock().unwrap();
        let j = jobs.get(&job);
        (j.and_then(|j| j.audio.clone()), j.and_then(|j| j.subtitle.clone()))
    };
    let options = sub_options(embedded, files.as_deref().unwrap_or_default());
    let pref = progress::subtitle_pref(title);
    let audio_pref = progress::audio_pref(title);
    let wanted = settings::wanted_audio_language();
    let audio_at = embedded.and_then(|e| pick_audio(&e.audio, chosen_audio.as_deref(), audio_pref.as_ref(), &wanted));
    let (ui, set_audio) = (settings::ui_language(), settings::audio_language());
    let viewer = Viewer {
        ui: &ui,
        set_audio: set_audio.as_deref(),
        audio: embedded.zip(audio_at).and_then(|(e, i)| audio::language(&e.audio[i])),
    };
    let sub = pick_subtitle(&options, chosen_sub.as_deref(), pref.as_deref(), viewer);

    let (audio_json, audio_id) = match embedded {
        Some(e) if !e.audio.is_empty() => {
            let at = audio_at;
            let rows: Vec<Value> = e
                .audio
                .iter()
                .enumerate()
                .map(|(i, t)| {
                    json!({
                        "key": format!("a:{}", t.id), "kind": "embedded", "language": t.language, "title": t.title,
                        "codec": t.codec, "channels": t.channels, "detail": tracks::detail(t), "selected": Some(i) == at,
                    })
                })
                .collect();
            (rows, at.map(|i| json!(e.audio[i].id)).unwrap_or(Value::Null))
        }
        _ => (vec![json!({ "key": "original", "kind": "original", "selected": true })], Value::Null),
    };
    let subtitle = match (&options[sub], embedded) {
        (_, None) => Value::Null,
        (SubOption::Embedded(t), Some(_)) => json!(t.id),
        _ => json!("no"),
    };
    let external = match &options[sub] {
        SubOption::External(f) => json!(f.id),
        _ => Value::Null,
    };
    json!({
        "pending": files.is_none(),
        "audio": audio_json,
        "subtitles": options.iter().enumerate().map(|(i, o)| o.json(i == sub)).collect::<Vec<_>>(),
        "apply": {
            "audio": audio_id, "subtitle": subtitle, "external": external,
            "audioLanguages": early_languages(audio_pref.as_ref(), &wanted),
        },
    })
}

fn sub_options(embedded: Option<&Embedded>, files: &[SubFile]) -> Vec<SubOption> {
    let mut options = vec![SubOption::Off];
    if let Some(e) = embedded {
        // Files mpv loaded itself are ours to show, not its.
        options.extend(e.subtitles.iter().filter(|t| !t.external).cloned().map(SubOption::Embedded));
    }
    options.extend(files.iter().cloned().map(SubOption::External));
    options
}

/// The viewer picked audio track `track` of `tracks` in `title`: remembered for the title
/// (not commentary: that plays only in this film), and its language becomes the one audio is
/// looked for in, unless the film has no track in the language looked for (the viewer had to
/// pick another) or the track has no language of ours.
fn remember_audio(title: &str, tracks: &[Track], track: &Track) {
    if audio::commentary(track) {
        return;
    }
    let pick = Signature::of(track);
    progress::set_audio_pref(title, &pick);
    let wanted = settings::wanted_audio_language();
    if let Some(language) = pick.language.as_deref() {
        if language != wanted && audio::has(tracks, &wanted) {
            settings::set_audio_language(language);
        }
    }
}

/// The viewer picked `choice` (a menu key) in the panel for job `job`
/// playing `key`. Subtitle and audio picks are remembered for the title
/// (`remember_audio`). The menu after it (as `menu`).
pub fn choose(job: u32, key: &str, embedded: Option<&Embedded>, choice: &str) -> Value {
    if choice.starts_with("a:") {
        let tracks = embedded.map(|e| e.audio.as_slice()).unwrap_or_default();
        if let Some(track) = tracks.iter().find(|t| format!("a:{}", t.id) == choice) {
            JOBS.lock().unwrap().entry(job).or_default().audio = Some(choice.to_owned());
            remember_audio(parse_key(key).0, tracks, track);
        }
    } else {
        let files = job_files(job).unwrap_or_default();
        let options = sub_options(embedded, &files);
        if let Some(option) = options.iter().find(|o| o.key() == choice) {
            JOBS.lock().unwrap().entry(job).or_default().subtitle = Some(choice.to_owned());
            progress::set_subtitle_pref(parse_key(key).0, &option.pref());
        }
    }
    menu(job, key, embedded)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn track(id: i64, language: Option<&str>) -> Track {
        Track { id, language: language.map(String::from), ..Default::default() }
    }

    fn file(id: usize, language: Option<&'static str>) -> SubFile {
        SubFile { id, path: format!("f{id}.srt"), format: reel_domain::subtitles::parse::Format::Srt, language, label: String::new() }
    }

    fn opts() -> Vec<SubOption> {
        let forced = Track { forced: true, ..track(3, Some("en")) };
        vec![
            SubOption::Off,
            SubOption::Embedded(forced),
            SubOption::Embedded(track(4, Some("en"))),
            SubOption::Embedded(Track { default: true, ..track(5, Some("de")) }),
            SubOption::External(file(9, Some("ru"))),
            SubOption::External(file(10, None)),
        ]
    }

    /// An English app, audio set to nothing, the audio in `audio`.
    fn english(audio: Option<&str>) -> Viewer<'_> {
        Viewer { ui: "en", set_audio: None, audio }
    }

    #[test]
    fn subtitle_choice_order() {
        let o = opts();
        let v = english(Some("de"));
        // The pick in this film wins.
        assert_eq!(pick_subtitle(&o, Some("x:9"), Some("en"), v), 4);
        // Remembered by language: a full track before a forced one, an embedded one before a file.
        assert_eq!(pick_subtitle(&o, None, Some("en"), v), 2);
        assert_eq!(pick_subtitle(&o, None, Some("ru"), v), 4);
        assert_eq!(pick_subtitle(&o, None, Some("?"), v), 5);
        assert_eq!(pick_subtitle(&o, None, Some("off"), v), 0);
        // Remembered beats what would come on by itself.
        assert_eq!(pick_subtitle(&o, None, Some("de"), english(Some("en"))), 3);
        // Nothing remembered, German audio: the app's language, though the German track is marked default.
        assert_eq!(pick_subtitle(&o, None, None, v), 2);
        // A remembered language this film does not have: as if nothing was remembered.
        assert_eq!(pick_subtitle(&o, None, Some("ja"), v), 2);
    }

    #[test]
    fn default_flag_only_in_a_language_the_viewer_reads() {
        let ru_default = || SubOption::Embedded(Track { default: true, ..track(2, Some("ru")) });
        let en = || SubOption::Embedded(track(3, Some("en")));
        let en_default = || SubOption::Embedded(Track { default: true, ..track(4, Some("en")) });
        let en_forced = || SubOption::Embedded(Track { forced: true, ..track(5, Some("en")) });
        // Metropolis: an English app, English (or untagged) audio, Russian marked default: off.
        let o = vec![SubOption::Off, ru_default(), en()];
        assert_eq!(pick_subtitle(&o, None, None, english(Some("en"))), 0);
        assert_eq!(pick_subtitle(&o, None, None, english(None)), 0, "audio of no known language is not foreign");
        // German audio: full English subtitles, marked default or not; never the Russian.
        assert_eq!(pick_subtitle(&o, None, None, english(Some("de"))), 2);
        assert_eq!(pick_subtitle(&o[..2], None, None, english(Some("de"))), 0);
        // English marked default comes on with English audio too (the file says so).
        let o = vec![SubOption::Off, ru_default(), en(), en_default()];
        assert_eq!(pick_subtitle(&o, None, None, english(Some("en"))), 3);
        assert_eq!(pick_subtitle(&o, None, None, english(Some("ja"))), 3, "the one marked default first");
        // Forced lines in the audio's language, for audio the viewer reads; not for foreign audio.
        let o = vec![SubOption::Off, ru_default(), en_forced()];
        assert_eq!(pick_subtitle(&o, None, None, english(Some("en"))), 2);
        assert_eq!(pick_subtitle(&o, None, None, english(Some("de"))), 0);
        let o = vec![SubOption::Off, SubOption::Embedded(Track { forced: true, ..track(6, Some("de")) })];
        assert_eq!(pick_subtitle(&o, None, None, english(Some("de"))), 0, "forced German for German audio: not read");
        // The audio language the viewer set reads too: a Russian app, English audio set, English playing.
        let o = vec![SubOption::Off, SubOption::External(file(9, Some("ru"))), en_forced()];
        let v = Viewer { ui: "ru", set_audio: Some("en"), audio: Some("en") };
        assert_eq!(pick_subtitle(&o, None, None, v), 2);
        // Without that setting the English audio is foreign: the Russian file.
        assert_eq!(pick_subtitle(&o, None, None, Viewer { set_audio: None, ..v }), 1);
    }

    #[test]
    fn a_file_named_forced_is_forced() {
        let forced = SubFile { label: "Forced".into(), ..file(9, Some("en")) };
        let full = SubFile { label: "SDH".into(), ..file(10, Some("en")) };
        let o = vec![SubOption::Off, SubOption::External(forced), SubOption::External(full)];
        assert!(o[1].forced() && !o[2].forced());
        assert_eq!(o[1].json(false)["forced"], true);
        // Japanese audio: the full English file, not the forced one before it.
        assert_eq!(pick_subtitle(&o, None, None, english(Some("ja"))), 2);
        assert_eq!(pick_subtitle(&o, None, Some("en"), english(Some("ja"))), 2);
        // English audio: the forced one.
        assert_eq!(pick_subtitle(&o, None, None, english(Some("en"))), 1);
    }

    fn audio(id: i64, language: Option<&str>, title: &str) -> Track {
        Track { title: (!title.is_empty()).then(|| title.to_owned()), ..track(id, language) }
    }

    fn sig(t: &Track) -> Signature {
        Signature::of(t)
    }

    #[test]
    fn audio_choice_order() {
        let a = vec![track(1, Some("en")), Track { default: true, ..track(2, Some("ru")) }, Track { selected: true, ..track(3, None) }];
        // The pick in this film first.
        assert_eq!(pick_audio(&a, Some("a:1"), Some(&sig(&a[1])), "ru"), Some(0));
        // The title's pick over the language looked for.
        assert_eq!(pick_audio(&a, None, Some(&sig(&a[0])), "ru"), Some(0));
        // The language looked for (picked last, or the app's).
        assert_eq!(pick_audio(&a, None, None, "ru"), Some(1));
        assert_eq!(pick_audio(&a, None, None, "en"), Some(0));
        // The title's pick in a language this file lacks: the language looked for.
        assert_eq!(pick_audio(&a, None, Some(&sig(&track(9, Some("ja")))), "en"), Some(0));
        // None of them here: what the view plays, else the default one.
        assert_eq!(pick_audio(&a, None, None, "de"), Some(2));
        assert_eq!(pick_audio(&a[..2], None, None, "de"), Some(1));
        assert_eq!(pick_audio(&[], None, None, "en"), None);
    }

    #[test]
    fn audio_within_a_language_by_voice() {
        // 22 Russian tracks, one of them the dub; the studio's own MVO and Dub kept apart.
        let mut a: Vec<Track> = (0..20).map(|i| audio(i, Some("ru"), &format!("MVO, Team{i}"))).collect();
        a.push(audio(20, Some("ru"), "HDRezka Studio"));
        a.push(audio(21, Some("ru"), "HDRezka Studio | Dub"));
        a.push(Track { default: true, selected: true, ..audio(22, Some("en"), "Original") });
        assert_eq!(pick_audio(&a, None, None, "ru"), Some(21));
        assert_eq!(pick_audio(&a, None, Some(&sig(&a[20])), "en"), Some(20), "the title's pick: that studio's MVO, not its dub");
        // E03 of the pack has one more track in front: known again by what it is, not where.
        let mut e03 = a.clone();
        e03.insert(0, audio(99, Some("ru"), "Комментарии создателей"));
        assert_eq!(pick_audio(&e03, None, Some(&sig(&a[7])), "en"), Some(8));
    }

    #[test]
    fn audio_never_commentary_and_untagged_never_a_language() {
        // An unflagged description track before the plain one.
        let a = vec![audio(1, Some("en"), "VO and descriptive commentary"), audio(2, Some("en"), ""), audio(3, Some("ru"), "Dub")];
        assert_eq!(pick_audio(&a, None, None, "en"), Some(1));
        // Two untagged tracks and no Russian: the file's own choice, nothing more.
        let b = vec![track(1, Some("und")), Track { default: true, ..track(2, None) }];
        assert_eq!(pick_audio(&b, None, None, "ru"), Some(1));
        // "jav" on a Japanese track is not Japanese to us.
        let c = vec![Track { default: true, ..track(1, Some("ru")) }, track(2, Some("jav"))];
        assert_eq!(pick_audio(&c, None, None, "ja"), Some(0));
        // Kazakh and Uzbek are known.
        let d = vec![track(1, Some("ru")), track(2, Some("kk")), track(3, Some("uz"))];
        assert_eq!(pick_audio(&d, None, None, "kk"), Some(1));
        assert_eq!(pick_audio(&d, None, None, "uz"), Some(2));
        // Ukrainian is never Russian.
        let e = vec![Track { default: true, ..track(1, Some("en")) }, track(2, Some("uk"))];
        assert_eq!(pick_audio(&e, None, None, "ru"), Some(0));
        assert_eq!(pick_audio(&e, None, None, "uk"), Some(1));
    }

    #[test]
    fn untagged_pick_known_again_only_when_one_is_the_same() {
        let a = vec![Track { default: true, ..audio(1, None, "Dub_Bravo") }, audio(2, None, "MVO, Карусель"), audio(3, None, "")];
        assert_eq!(pick_audio(&a, None, Some(&sig(&a[1])), "ru"), Some(1));
        // A pick that said nothing of itself (no title): the file's own choice.
        assert_eq!(pick_audio(&a, None, Some(&sig(&a[2])), "ru"), Some(0));
    }

    #[test]
    fn avplay_tracks_have_no_titles_first_of_the_language() {
        // AVPlay reports languages only: no titles, no default flag.
        let a = vec![Track { selected: true, ..track(1, Some("en")) }, track(2, Some("ru")), track(3, Some("ru"))];
        assert_eq!(pick_audio(&a, None, None, "ru"), Some(1));
        assert_eq!(pick_audio(&a, None, Some(&sig(&a[2])), "en"), Some(1), "remembered as Russian, nothing more to know it by");
    }

    #[test]
    fn audio_picks_set_the_language_unless_forced() {
        let _lock = crate::application::catalog::TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        progress::clear();
        settings::set_audio_language("");
        assert_eq!(settings::wanted_audio_language(), "en");
        let both = Embedded { audio: vec![audio(1, Some("en"), ""), audio(2, Some("ru"), "Dub"), audio(3, None, "")], subtitles: vec![] };

        // Before any pick: the app's language; mpv looks for it at load.
        let m = menu(0, "tmdb:tv:7:s1e1", Some(&both));
        assert_eq!(m["apply"]["audio"], 1);
        assert_eq!(m["apply"]["audioLanguages"], "en,eng");

        // Russian picked where English was there: Russian everywhere from now on, and for this title.
        let m = choose(0, "tmdb:tv:7:s1e1", Some(&both), "a:2");
        assert_eq!(m["apply"]["audio"], 2);
        assert_eq!(settings::audio_language().as_deref(), Some("ru"));
        assert_eq!(progress::audio_pref("tmdb:tv:7").unwrap().voice, audio::Voice::Dub);
        forget(0);
        assert_eq!(menu(0, "tmdb:movie:8", Some(&both))["apply"]["audio"], 2, "another title");
        assert_eq!(menu(0, "tmdb:movie:8", None)["apply"]["audioLanguages"], "ru,rus");

        // A film without Russian: the English picked there is remembered for it, not everywhere.
        let english = Embedded { audio: vec![audio(1, Some("ja"), ""), audio(2, Some("en"), "")], subtitles: vec![] };
        choose(0, "tmdb:movie:9", Some(&english), "a:2");
        assert_eq!(settings::audio_language().as_deref(), Some("ru"), "a forced pick");
        forget(0);
        assert_eq!(menu(0, "tmdb:movie:9", Some(&english))["apply"]["audio"], 2);
        assert_eq!(menu(0, "tmdb:movie:9", Some(&both))["apply"]["audio"], 1, "the title's pick beats the language picked last");

        // A track without a language and commentary never set the language.
        choose(0, "tmdb:movie:10", Some(&both), "a:3");
        assert_eq!(settings::audio_language().as_deref(), Some("ru"));
        assert_eq!(menu(0, "tmdb:movie:10", None)["apply"]["audioLanguages"], "", "mpv looks for nothing");
        let commented = Embedded { audio: vec![audio(1, Some("ru"), ""), audio(2, Some("de"), "Commentary")], subtitles: vec![] };
        choose(0, "tmdb:movie:11", Some(&commented), "a:2");
        assert_eq!(settings::audio_language().as_deref(), Some("ru"));
        assert!(progress::audio_pref("tmdb:movie:11").is_none(), "commentary plays in this film only");

        // A pick in the language looked for keeps the setting as it is (the app's stays the app's).
        settings::set_audio_language("");
        choose(0, "tmdb:movie:12", Some(&both), "a:1");
        assert_eq!(settings::audio_language(), None);
        forget(0);
        progress::clear();
    }

    #[test]
    fn menu_without_a_torrent_and_without_tracks() {
        let _lock = crate::application::catalog::TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        // Job 0 plays nothing: no files yet, the one original audio track.
        let m = menu(0, "tmdb:movie:1", None);
        assert_eq!(m["pending"], true);
        assert_eq!(m["audio"][0]["key"], "original");
        assert_eq!(m["subtitles"].as_array().unwrap().len(), 1);
        assert_eq!(m["apply"]["subtitle"], Value::Null);

        // With mpv's tracks: the remembered language picks the embedded track.
        progress::set_subtitle_pref("tmdb:movie:1", "de");
        let e = Embedded { audio: vec![track(1, Some("en"))], subtitles: vec![track(2, Some("en")), track(3, Some("de"))] };
        let m = menu(0, "tmdb:movie:1:s1e2", Some(&e));
        assert_eq!(m["apply"]["subtitle"], 3);
        assert_eq!(m["apply"]["audio"], 1);
        assert_eq!(m["subtitles"][2]["selected"], true);

        // Choosing off is remembered for the title (not the episode).
        let m = choose(0, "tmdb:movie:1:s1e3", Some(&e), "off");
        assert_eq!(m["apply"]["subtitle"], "no");
        assert_eq!(progress::subtitle_pref("tmdb:movie:1").as_deref(), Some("off"));
        forget(0);
    }

}
