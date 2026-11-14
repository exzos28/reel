//! reel's Rust side: what `App.tsx` imports from `app/native`.

mod buffer;
mod catalog;
mod disk;
mod engine;
mod metadata;
mod progress;
mod settings;
mod sources;
mod subtitles;
mod timeline;
#[cfg(target_os = "macos")]
mod mpv;

use nsh_core::prelude::*;

pub use catalog::Catalog;
pub use metadata::Meta;

#[native_module("app/native")]
fn native(registry: &mut Registry) {
    registry.module::<Fmt>().module::<Engine>().module::<Catalog>().module::<Settings>().module::<Sources>().module::<Meta>().module::<VideoEngine>();
}

/// The mpv video view (`reel/mpv`), where libmpv is found.
#[native_components(macos)]
fn components(components: &nsh_platform_macos::Components) {
    mpv::register(components);
}

/// The built-in torrent server (librqbit). Results are JSON strings.
#[module]
pub struct Engine;

#[module]
impl Engine {
    /// Starts playing `id` from the catalog (a title, or an episode
    /// `<title>:s<season>e<episode>`) with the release it picks from the
    /// user's search source: a job id for `status`, 0 when the engine could
    /// not start (see the log).
    pub fn open(id: String) -> u32 {
        engine::open(&id).unwrap_or_else(|e| {
            eprintln!("reel engine: {e:#}");
            0
        })
    }

    /// What the player shows for the job, JSON with a `phase` (see `engine::status`).
    pub fn status(job: u32) -> String {
        engine::status(job).to_string()
    }

    /// What the scrubber draws at `position` of `duration` seconds:
    /// `{"ranges":[[from,to],…],"ahead":seconds}` (see `engine::timeline`).
    pub fn timeline(job: u32, position: f64, duration: f64) -> String {
        engine::timeline(job, position, duration).to_string()
    }

    /// Whether there is room to start playing, as JSON
    /// `{"ok":bool,"free":bytes|null,"needed":bytes,"buffer":MiB}`.
    pub fn check_space() -> String {
        engine::check_space().to_string()
    }

    /// Starts playing a release a search found: `source` is its magnet or
    /// .torrent URL; `season`/`episode` (0 for a film) pick the episode's file
    /// in a pack. A job id for `status`, 0 when the engine could not start.
    pub fn open_release(source: String, season: u32, episode: u32) -> u32 {
        let ep = (season > 0 && episode > 0).then(|| (season as u16, episode as u16));
        engine::open_release(&source, ep).unwrap_or_else(|e| {
            eprintln!("reel engine: {e:#}");
            0
        })
    }

    /// The player shows the first frame of the job's film (for the timing log,
    /// `$TMPDIR/reel-timings.log`).
    pub fn first_frame(job: u32) {
        engine::time_step(job, "first frame on screen");
    }

    /// Stops the job and deletes what it downloaded (the cache is per film).
    pub fn close(job: u32) {
        engine::close(job);
    }

    /// The subtitle files of what the job plays (fetching them starts with the
    /// first ready answer): `{"state":"pending"|"ready","files":[{"id",
    /// "language","label","format"}]}` (see `subtitles::list`).
    pub fn subtitles(job: u32) -> String {
        subtitles::list(job).to_string()
    }

    /// The cues of subtitle file `id` on screen at some moment of `from..=to`
    /// seconds; the overlay asks with `from == to` at its position (see
    /// `subtitles::cues`): `{"state","cues":[{"start","end","text"}]}`.
    pub fn cues(job: u32, id: u32, from: f64, to: f64) -> String {
        subtitles::cues(job, id as usize, from, to).to_string()
    }

    /// The Audio and Subtitles columns of the tracks panel for the job playing
    /// `id`, with what the video view should apply. `embedded` is the view's
    /// `tracks` event as JSON, empty where the view reports none (see
    /// `subtitles::menu`).
    pub fn tracks(job: u32, id: String, embedded: String) -> String {
        let embedded = parse_embedded(&embedded);
        subtitles::menu(job, &id, embedded.as_ref()).to_string()
    }

    /// The viewer picked `choice` (a key of `tracks`); subtitles are
    /// remembered for the title. The columns after it (as `tracks`).
    pub fn choose_track(job: u32, id: String, embedded: String, choice: String) -> String {
        let embedded = parse_embedded(&embedded);
        subtitles::choose(job, &id, embedded.as_ref(), &choice).to_string()
    }
}

fn parse_embedded(json: &str) -> Option<subtitles::tracks::Embedded> {
    (!json.is_empty()).then(|| serde_json::from_str(json).ok()).flatten()
}

/// Which video view plays on this device.
#[module]
pub struct VideoEngine;

#[module]
impl VideoEngine {
    /// `"mpv"` where reel's mpv view (`reel/mpv`) can play (macOS with
    /// libmpv found: MKV, every codec, track selection), else `"native"`
    /// (NSH's `<Video>`, the platform's player). Choosing mpv also sets the
    /// search profile to it, so releases only mpv plays are offered. On a
    /// Samsung TV (the `tizen` profile its host sets) `"avplay"`: the TV
    /// shell's AVPlay draws under the web UI.
    pub fn kind() -> String {
        if let Some(kind) = sources::compat::profile().host_video() {
            return kind.into();
        }
        #[cfg(target_os = "macos")]
        if mpv::available() {
            sources::compat::set_profile(sources::compat::Profile::Mpv);
            return "mpv".into();
        }
        "native".into()
    }
}

/// The user's settings, kept on the device.
#[module]
pub struct Settings;

#[module]
impl Settings {
    /// Loads the settings from `data_dir` (the app's data directory, empty
    /// when the host has none) and configures the engine from them; JSON
    /// `{"language","bufferMB","bufferChoices":[{"mb","default"}]}`.
    pub fn load(data_dir: String) -> String {
        let dir = (!data_dir.is_empty()).then(|| std::path::PathBuf::from(data_dir));
        let loaded = settings::load(dir.as_deref());
        // Watch progress and the metadata cache live there too.
        catalog::init(dir.as_deref());
        loaded.to_string()
    }

    /// Saves the playback buffer size (one of the choices); the size in effect.
    pub fn set_buffer_mb(mb: u32) -> u32 {
        settings::set_buffer_mb(mb)
    }

    /// Saves whether the player shows the stream's speed, people and what is
    /// ready ahead (off by default); the value in effect.
    pub fn set_stream_details(on: bool) -> bool {
        settings::set_stream_details(on)
    }

    /// Saves the search source (a Torznab endpoint and its key; empty URL
    /// removes it). JSON `{"ok":true,"source":{"url","hasKey"}}` or
    /// `{"ok":false,"message"}` for an address that is not one.
    pub fn set_source(url: String, key: String) -> String {
        match settings::set_source(&url, &key) {
            Ok(source) => serde_json::json!({ "ok": true, "source": source }).to_string(),
            Err(message) => serde_json::json!({ "ok": false, "message": message }).to_string(),
        }
    }

    /// Saves the content language (titles, descriptions, episode names; one
    /// of `contentLanguages` from `load`) and drops what was asked in the old
    /// one; the language in effect.
    pub fn set_content_language(tag: String) -> String {
        let now = settings::set_content_language(&tag);
        catalog::language_changed();
        now
    }

    /// Saves the UI language (a BCP 47 tag).
    pub fn set_language(tag: String) {
        settings::set_language(&tag);
    }
}

/// Finding releases on the user's own source (Torznab). Searches run in the
/// background: start one, then poll `result`.
#[module]
pub struct Sources;

#[module]
impl Sources {
    /// Searches for a film or an episode. `request` is JSON
    /// `{"imdb","title","year","season","episode"}` (imdb, year, season and
    /// episode optional). A search id for `result`; 0 when no source is set.
    pub fn search(request: String) -> u32 {
        let Some(source) = settings::source() else { return 0 };
        match serde_json::from_str::<sources::Request>(&request) {
            Ok(r) => sources::start_search(source, r),
            Err(e) => {
                eprintln!("reel sources: bad request {request}: {e}");
                0
            }
        }
    }

    /// Sets the player profile of this device (what it can play): "mpv",
    /// "apple_avplayer", "android_mediaplayer", "tizen". Releases it cannot
    /// play are hidden from searches. False for an unknown name.
    pub fn set_profile(name: String) -> bool {
        match sources::compat::Profile::parse(&name) {
            Some(p) => {
                sources::compat::set_profile(p);
                true
            }
            None => false,
        }
    }

    /// Checks the saved source (`t=caps`); a job id for `result`, 0 when none is set.
    pub fn check() -> u32 {
        settings::source().map(sources::start_check).unwrap_or(0)
    }

    /// `{"state":"pending"}`, `{"state":"done","releases":[…]}` (ranked: each
    /// `{"id","title","source","infohash","size","seeders","peers","indexer",
    /// "info":{resolution,hdr,dolby_vision,codec,source,season,episodes,season_pack},
    /// "seasonPack"}`), `{"state":"done","caps":{…}}` for a check, or
    /// `{"state":"failed","message"}`.
    pub fn result(id: u32) -> String {
        sources::result(id).to_string()
    }
}

/// Formatting shared by every platform.
#[module]
pub struct Fmt;

#[module]
impl Fmt {
    /// Playback position in seconds as "1:12:40" / "4:05".
    pub fn position(seconds: u32) -> String {
        let (h, m, s) = (seconds / 3600, seconds / 60 % 60, seconds % 60);
        if h > 0 {
            format!("{h}:{m:02}:{s:02}")
        } else {
            format!("{m}:{s:02}")
        }
    }

    /// A size in bytes as "256 MB", "1 GB", "1.4 GB".
    pub fn size(bytes: f64) -> String {
        let mb = bytes / (1024.0 * 1024.0);
        if mb < 1024.0 {
            return format!("{} MB", mb.round() as u64);
        }
        let gb = mb / 1024.0;
        if gb >= 10.0 || gb.fract() == 0.0 {
            format!("{} GB", gb.round() as u64)
        } else {
            format!("{gb:.1} GB")
        }
    }

    /// A download speed in MiB/s as "3.4 MB/s" (one decimal under 10, whole
    /// above).
    pub fn speed(mib_per_s: f64) -> String {
        let v = if mib_per_s.is_finite() { mib_per_s.max(0.0) } else { 0.0 };
        if v >= 9.95 {
            format!("{} MB/s", v.round() as u64)
        } else {
            format!("{v:.1} MB/s")
        }
    }

    /// Minutes as hours and minutes, `[h, m]` (the UI words them).
    pub fn hours_minutes(minutes: u32) -> Vec<u32> {
        vec![minutes / 60, minutes % 60]
    }
}

#[cfg(test)]
mod tests {
    use super::Fmt;

    #[test]
    fn position() {
        assert_eq!(Fmt::position(4360), "1:12:40");
        assert_eq!(Fmt::position(245), "4:05");
    }

    #[test]
    fn size() {
        assert_eq!(Fmt::size(306.0 * 1024.0 * 1024.0), "306 MB");
        assert_eq!(Fmt::size(1024.0 * 1024.0 * 1024.0), "1 GB");
        assert_eq!(Fmt::size(1.4 * 1024.0 * 1024.0 * 1024.0), "1.4 GB");
        assert_eq!(Fmt::size(12.3 * 1024.0 * 1024.0 * 1024.0), "12 GB");
    }

    #[test]
    fn speed() {
        assert_eq!(Fmt::speed(3.42), "3.4 MB/s");
        assert_eq!(Fmt::speed(0.0), "0.0 MB/s");
        assert_eq!(Fmt::speed(12.6), "13 MB/s");
        assert_eq!(Fmt::speed(f64::NAN), "0.0 MB/s");
    }
}
