//! reel's Rust side: what `App.tsx` imports from `app/native`.
//!
//! NSH's web target builds this crate for wasm32, where librqbit, tokio networking and sqlite
//! do not build. There only the pure module `Fmt` is registered; on a TV the web UI reaches
//! the others over HTTP from the core (`ui/native.ts`, docs/tizen.md).
//! New native modules follow the same rule: `#[cfg(not(target_arch = "wasm32"))]`.

// The layers (docs/architecture.md): the application on the domain and the ports, the
// adapters behind the ports, the interface (these NSH modules and what is served over
// HTTP), and `wiring`, the one place that puts adapters behind the ports.
#[cfg(not(target_arch = "wasm32"))]
mod adapters;
#[cfg(not(target_arch = "wasm32"))]
mod application;
#[cfg(not(target_arch = "wasm32"))]
mod interface;
#[cfg(not(target_arch = "wasm32"))]
mod wiring;

// Paths the Tizen host uses (platforms/tizen/core).
#[cfg(not(target_arch = "wasm32"))]
pub use interface::{hosted, thumbs};

use nsh_core::prelude::*;

#[cfg(not(target_arch = "wasm32"))]
use application::{catalog, library, progress, settings, tracks};
#[cfg(any(target_os = "macos", target_os = "android", target_os = "linux", windows))]
use adapters::mpv;
#[cfg(not(target_arch = "wasm32"))]
use wiring::{metadata, playback};

#[native_module("app/native")]
fn native(registry: &mut Registry) {
    registry.module::<Fmt>();
    #[cfg(not(target_arch = "wasm32"))]
    registry.module::<Engine>().module::<Catalog>().module::<Settings>().module::<Sources>().module::<Meta>().module::<VideoEngine>().module::<Hosted>().module::<Library>();
}

/// The mpv video view (`reel/mpv`), where libmpv is found.
#[native_components(macos)]
fn components(components: &nsh_platform_macos::Components) {
    mpv::register(components);
}

/// The mpv video view on Windows (Direct2D in the view), where libmpv is found.
#[native_components(windows)]
fn windows_components(components: &nsh_platform_windows::Components) {
    mpv::register_windows(components);
}

/// The mpv video view on Linux desktops (a GTK GLArea), where libmpv is found. Not on 32-bit ARM:
/// the Samsung TV's core, which has no GTK.
#[cfg(not(target_arch = "arm"))]
#[native_components(linux)]
fn linux_components(components: &nsh_platform_linux::Components) {
    mpv::register_linux(components);
}

/// The built-in torrent server (librqbit). Results are JSON strings.
#[cfg(not(target_arch = "wasm32"))]
#[module]
pub struct Engine;

#[cfg(not(target_arch = "wasm32"))]
#[module]
impl Engine {
    /// Starts playing `id` from the catalog (a title, or an episode
    /// `<title>:s<season>e<episode>`) with the release it picks from the
    /// user's search source: a job id for `status`, 0 when the engine could
    /// not start (see the log).
    pub fn open(id: String) -> u32 {
        playback().open(&id).unwrap_or_else(|e| {
            tracing::warn!("reel engine: {e}");
            0
        })
    }

    /// What the player shows for the job, JSON with a `phase` (see `Playback::status`).
    pub fn status(job: u32) -> String {
        playback().status(job).to_string()
    }

    /// What the scrubber draws at `position` of `duration` seconds:
    /// `{"ranges":[[from,to],…],"ahead":seconds}` (see `Playback::timeline`).
    /// `cached`: seconds the video view holds in memory ahead of `position` (mpv's cache),
    /// shown as ready with what is on disk.
    /// `read_byte`/`read_time`: the byte of the file the view has read to and the moment of
    /// the film it holds there (0: unknown), which places what is on disk in time.
    pub fn timeline(job: u32, position: f64, duration: f64, cached: f64, read_byte: f64, read_time: f64) -> String {
        playback().timeline(job, position, duration, cached, read_byte, read_time).to_string()
    }

    /// Whether there is room to start playing, as JSON
    /// `{"ok":bool,"free":bytes|null,"needed":bytes,"buffer":MiB}`.
    pub fn check_space() -> String {
        playback().check_space().to_string()
    }

    /// Starts playing a release a search found: `source` is its magnet or
    /// .torrent URL; `season`/`episode` (0 for a film) pick the episode's file
    /// in a pack. A job id for `status`, 0 when the engine could not start.
    pub fn open_release(source: String, season: u32, episode: u32) -> u32 {
        let ep = (season > 0 && episode > 0).then(|| (season as u16, episode as u16));
        playback().open_release(&source, ep).unwrap_or_else(|e| {
            tracing::warn!("reel engine: {e}");
            0
        })
    }

    /// The player shows the first frame of the job's film (for the timing log,
    /// `$TMPDIR/reel-timings.log`).
    pub fn first_frame(job: u32) {
        playback().first_frame(job);
    }

    /// Gets the place at `seconds` ready before the view seeks there (no player waits in
    /// pieces still to come: a TV's AVPlay holds the page meanwhile). `{"state":…}`:
    /// `ready` once it is in (at once when it was), `replaced` when a newer seek or `close`
    /// came first, `unknown` when the film has no index to tell (seek as it is).
    pub async fn seek(job: u32, seconds: f64) -> String {
        serde_json::json!({ "state": playback().seek(job, seconds).await.as_str() }).to_string()
    }

    /// Stops the job and deletes what it downloaded (the cache is per film).
    pub fn close(job: u32) {
        tracks::forget(job);
        playback().close(job);
    }

    /// The subtitle files of what the job plays (fetching them starts with the
    /// first ready answer): `{"state":"pending"|"ready","files":[{"id",
    /// "language","label","format"}]}` (see `Playback::subtitles`).
    pub fn subtitles(job: u32) -> String {
        playback().subtitles(job).to_string()
    }

    /// The cues of subtitle file `id` on screen at some moment of `from..=to`
    /// seconds; the overlay asks with `from == to` at its position (see
    /// `Playback::cues`): `{"state","cues":[{"start","end","text"}]}`.
    pub fn cues(job: u32, id: u32, from: f64, to: f64) -> String {
        playback().cues(job, id as usize, from, to).to_string()
    }

    /// The Audio and Subtitles columns of the tracks panel for the job playing
    /// `id`, with what the video view should apply. `embedded` is the view's
    /// `tracks` event as JSON, empty where the view reports none (see
    /// `tracks::menu`).
    pub fn tracks(job: u32, id: String, embedded: String) -> String {
        let embedded = parse_embedded(&embedded);
        tracks::menu(job, &id, embedded.as_ref()).to_string()
    }

    /// The viewer picked `choice` (a key of `tracks`); subtitles are
    /// remembered for the title. The columns after it (as `tracks`).
    pub fn choose_track(job: u32, id: String, embedded: String, choice: String) -> String {
        let embedded = parse_embedded(&embedded);
        tracks::choose(job, &id, embedded.as_ref(), &choice).to_string()
    }
}

#[cfg(not(target_arch = "wasm32"))]
fn parse_embedded(json: &str) -> Option<reel_domain::subtitles::tracks::Embedded> {
    (!json.is_empty()).then(|| serde_json::from_str(json).ok()).flatten()
}

/// Which video view plays on this device.
#[cfg(not(target_arch = "wasm32"))]
#[module]
pub struct VideoEngine;

#[cfg(not(target_arch = "wasm32"))]
#[module]
impl VideoEngine {
    /// `"mpv"` where reel's mpv view (`reel/mpv`) can play (macOS with
    /// libmpv found: MKV, every codec, track selection), else `"native"`
    /// (NSH's `<Video>`, the platform's player). Choosing mpv also sets the
    /// search profile to it, so releases only mpv plays are offered. On a
    /// Samsung TV (the `tizen` profile its host sets) `"avplay"`: the TV
    /// shell's AVPlay draws under the web UI.
    pub fn kind() -> String {
        if let Some(kind) = reel_domain::compat::profile().host_video() {
            return kind.into();
        }
        #[cfg(any(target_os = "macos", target_os = "linux", windows))]
        if mpv::available() {
            reel_domain::compat::set_profile(reel_domain::compat::Profile::Mpv);
            return "mpv".into();
        }
        // Android: reel's views registered (the APK has reel's Java) and libmpv in the APK.
        #[cfg(target_os = "android")]
        if crate::adapters::android_views::installed() && mpv::available() {
            reel_domain::compat::set_profile(reel_domain::compat::Profile::Mpv);
            return "mpv".into();
        }
        "native".into()
    }

    /// The player's full screen (Android: the system bars hide while it plays; elsewhere
    /// nothing: the desktops have their own full screen, a TV is always full).
    pub fn fullscreen(on: bool) {
        #[cfg(target_os = "android")]
        crate::adapters::android_views::fullscreen(on);
        #[cfg(not(target_os = "android"))]
        let _ = on;
    }

    /// Whether reel's own native views are registered on this device (Android: the Java ones
    /// `build/android-views.sh` adds to the APK; registered on the first call).
    pub fn views() -> bool {
        #[cfg(target_os = "android")]
        return crate::adapters::android_views::installed();
        #[cfg(not(target_os = "android"))]
        false
    }
}

/// The user's settings, kept on the device.
#[cfg(not(target_arch = "wasm32"))]
#[module]
pub struct Settings;

#[cfg(not(target_arch = "wasm32"))]
#[module]
impl Settings {
    /// The kind of device, when the host knows better than the system ("tv" on a
    /// Samsung TV, whose web view NSH takes for a desktop browser; a development host's stand-in,
    /// `compat::set_device`); empty otherwise.
    pub fn device() -> String {
        reel_domain::compat::device().unwrap_or_default().to_owned()
    }

    /// Loads the settings from `data_dir` (the app's data directory, empty
    /// when the host has none) and configures the engine from them; JSON
    /// `{"language","bufferMB","bufferChoices":[{"mb","default"}]}`.
    pub fn load(data_dir: String) -> String {
        let dir = (!data_dir.is_empty()).then(|| std::path::PathBuf::from(data_dir));
        let loaded = settings::load(dir.as_deref());
        // Watch progress and the metadata cache live there too, and the saved films' library.
        catalog::init(dir.as_deref());
        library::init(dir.as_deref());
        loaded.to_string()
    }

    /// The first-run setup is done (it does not show again).
    pub fn finish_setup() {
        settings::finish_setup();
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

    /// Saves where the top nav sits on a TV and a desktop ("left", "center" or "right"; another
    /// value is refused); the position in effect.
    pub fn set_nav_position(position: String) -> String {
        settings::set_nav_position(&position)
    }

    /// Saves the loading animation ("logo" or "dinosaur"; another value is refused); the one in
    /// effect.
    pub fn set_loader(loader: String) -> String {
        settings::set_loader(&loader)
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

    /// Saves the UI language (a BCP 47 tag); an empty tag follows the system's again. `load`
    /// answers it as `language`, null while it follows the system.
    pub fn set_language(tag: String) {
        settings::set_language(&tag);
    }

    /// The settings as `load` answers them, from memory (after a change made elsewhere,
    /// e.g. on the hosted page from a phone).
    pub fn current() -> String {
        settings::current().to_string()
    }

    /// Goes up when the settings change (here or on the hosted page) and when the hosted
    /// page's pairing code appears or goes: read `current` and `Hosted.pairing` again.
    pub fn revision() -> f64 {
        settings::revision() as f64
    }

    /// The revision once it is past `after`, or the same after a while: what the UI waits on.
    pub async fn changed(after: f64) -> f64 {
        settings::changed(after as u64).await as f64
    }
}

/// Settings from a phone: the page this device serves on the local network
/// (docs/hosted-settings.md), as the TV's own UI shows it.
#[cfg(not(target_arch = "wasm32"))]
#[module]
pub struct Hosted;

#[cfg(not(target_arch = "wasm32"))]
#[module]
impl Hosted {
    /// Where to open the page: `{"url":"http://192.168.1.20:47392/settings"}`, or
    /// `{"url":null}` where this device does not serve it or has no network address.
    pub fn address() -> String {
        hosted::address().to_string()
    }

    /// The code to show while a browser pairs: `{"code":"482913","expiresIn":115}`, or
    /// `{"code":null}`.
    pub fn pairing() -> String {
        hosted::pairing().to_string()
    }

    /// The viewer dismissed the code (Back).
    pub fn cancel_pairing() {
        hosted::cancel_pairing();
    }

    /// The QR code of the settings page: `{"url","qr"}` (`qr` an SVG data URL), or nulls
    /// where the page is not served.
    pub fn link() -> String {
        hosted::link().to_string()
    }

    /// The partner's bot and the links to it: `{"bot","tv":{"url","qr"}|null,"app":{"url","qr"}}`, or
    /// `{"bot":null}` in a build without one.
    pub fn partner() -> String {
        hosted::partner().to_string()
    }

    /// The source in a link that opened the app (`reel://s?t=<key>&u=<address>`, from a partner's
    /// bot): `{"url","key"}`, or `{"url":null}` for any other link. Nothing is saved.
    pub fn link_source(link: String) -> String {
        hosted::link_source(&link).to_string()
    }

    /// The source a phone offers (from a partner's link), waiting for a yes on the screen:
    /// `{"host":"jackett.example.com"}` or `{"host":null}`.
    pub fn offered() -> String {
        hosted::offered().to_string()
    }

    /// The viewer's answer to the offered source; a yes saves and checks it.
    pub fn answer_offer(accept: bool) {
        hosted::answer_offer(accept);
    }
}

/// The catalog the UI shows: TMDB and AniList titles through `Meta`,
/// releases from the user's search source, watch progress. Results are JSON
/// strings; poll `revision()` and read again when it changes.
#[cfg(not(target_arch = "wasm32"))]
#[module]
pub struct Catalog;

#[cfg(not(target_arch = "wasm32"))]
#[module]
impl Catalog {
    /// The revision once it is past `after`, or the same after a while: what the UI
    /// waits on to read again the moment something changed.
    pub async fn changed(after: f64) -> f64 {
        catalog::changed(after as u64).await as f64
    }

    /// Goes up when anything the catalog shows changed (an answer landed, a
    /// search finished, progress was saved): read again.
    pub fn revision() -> f64 {
        catalog::revision() as f64
    }

    /// The home shelves: `[{"id","items":[summary…]}]` (see `catalog::summary`).
    pub fn home() -> String {
        catalog::home().to_string()
    }

    /// `"movies"`, `"shows"` or `"anime"`: `{"trending":[summary…],"all":[summary…],
    /// "filters":[group…],"allState"}` (see `catalog::browse`).
    pub fn browse(page: String) -> String {
        catalog::browse(&page).to_string()
    }

    /// The next page of a browse page's grid (`"movies"`, `"shows"`, `"anime"`):
    /// whether one is on its way now (`browse`'s `moreState` says when it is in).
    pub fn browse_more(page: String) -> bool {
        catalog::browse_more(&page)
    }

    /// One choice in a browse page's filter panel (see `catalog::choose_filter`):
    /// `group` "genres" | "years" | "countries" | "sort", `id` an option's
    /// id, empty to clear the group. Whether the filter changed.
    pub fn choose_filter(page: String, group: String, id: String) -> bool {
        catalog::choose_filter(&page, &group, &id)
    }

    /// A film or show screen (a notice title while it is not known yet).
    pub fn title(id: String) -> String {
        catalog::title(&id).to_string()
    }

    /// The episodes of `season` of `show`.
    pub fn episodes(show: String, season: u32) -> String {
        catalog::episodes(&show, season).to_string()
    }

    /// Episode `number` of `season` of `show`, or null while it is not known.
    pub fn episode(show: String, season: u32, number: u32) -> String {
        catalog::episode(&show, season, number).to_string()
    }

    /// The episode to offer next at `position` of `duration` seconds of `id`, or null.
    pub fn up_next(id: String, position: f64, duration: f64) -> String {
        catalog::up_next(&id, position, duration).to_string()
    }

    /// The audio, subtitle and release options of what plays.
    pub fn tracks(id: String) -> String {
        catalog::tracks(&id).to_string()
    }

    /// Adds `id` to the user's list or takes it off: whether it is on it now.
    pub fn toggle_list(id: String) -> bool {
        catalog::toggle_list(&id)
    }

    /// The search screen for `query` (see `catalog::search::search`):
    /// `{"query","state","tmdb","recent","sections":[{"id","items":[summary…]}]}`.
    /// Asks in the background once the query rests; read again on `revision()`.
    pub fn search(query: String) -> String {
        catalog::search::search(&query).to_string()
    }

    /// Keeps `query` among the recent searches (submitted, or a title opened from it).
    pub fn remember_search(query: String) {
        catalog::search::remember(&query)
    }

    /// Forgets all the recent searches (the history's Clear).
    pub fn forget_searches() {
        catalog::search::forget()
    }

    /// Makes release `index` the one Play uses for `id`.
    pub fn choose_release(id: String, index: u32) -> bool {
        catalog::choose_release(&id, index as usize)
    }

    /// The releases of one episode (an episode key), to pick one when it is not
    /// in its season's: `{"releases","releasesState","seasonRelease"}`.
    pub fn episode_releases(key: String) -> String {
        catalog::episode_releases(&key).to_string()
    }

    /// Where the player should start `id` (what plays), seconds: where the
    /// viewer stopped, 0 when new or watched.
    pub fn start_at(id: String) -> f64 {
        progress::start_at(&id)
    }

    /// The player's report: `position` of `duration` seconds into `id`.
    /// Whether it counts as watched now (90%).
    pub fn save_progress(id: String, position: f64, duration: f64) -> bool {
        catalog::save_progress(&id, position, duration)
    }
}

/// Movie, series and anime metadata: TMDB, AniList, Jikan (MAL score), tied
/// by the Fribb anime ID lists, cached in SQLite. Results are JSON strings.
///
/// The data calls (`trending`, `title`, `season`, `search`) return Promises
/// that never block the UI: they answer from the cache at once when they
/// can (a stale answer, `"stale": true`, is refreshed in the background, and
/// `revision()` goes up when the refresh lands, so poll it and ask again);
/// only a cache miss waits for the network (15 s timeout, rate limits per
/// source). Each resolves to `{"data","stale","fetchedAt","error","warnings","revision"}`.
/// `language` is a BCP 47 tag ("en", "pl-PL"): text comes from the source in
/// that language when it has it.
#[cfg(not(target_arch = "wasm32"))]
#[module]
pub struct Meta;

#[cfg(not(target_arch = "wasm32"))]
#[module]
impl Meta {
    /// Opens the cache in `data_dir` (`process.dataDir`; empty: in memory)
    /// and starts the anime lists download when due. The status (see `status`).
    pub fn init(data_dir: String) -> String {
        let dir = (!data_dir.is_empty()).then(|| std::path::PathBuf::from(data_dir));
        metadata().init(dir.as_deref()).to_string()
    }

    /// Uses the user's own TMDB key (v4 read access token or v3 key) instead
    /// of the project one; empty clears it. Kept in memory. The status.
    pub fn set_tmdb_key(key: String) -> String {
        metadata().set_tmdb_key(&key).to_string()
    }

    /// Which sources work: `{"tmdb":{"configured","requiresKey","capabilities",
    /// "key":"user"|"build"|null},"anilist","jikan":{"configured","requiresKey","capabilities"},
    /// "animeLists":{"entries","fetchedAt","updating"},"cache":{"persistent"},"revision"}`.
    pub fn status() -> String {
        metadata().status().to_string()
    }

    /// Goes up whenever a background refresh stored newer data: ask again
    /// for what is on screen when it changes.
    pub fn revision() -> f64 {
        metadata().revision() as f64
    }

    /// What the About/Credits screen must show: `[{"provider","name","url",
    /// "notice","logoRequired","license"}]` (TMDB's notice is required, with its logo).
    pub fn attribution() -> String {
        metadata().attribution().to_string()
    }

    /// A home shelf: `kind` is "movie" | "tv" (TMDB trending this week),
    /// "movie-popular" | "tv-popular" (TMDB discover), "anime" (AniList
    /// trending) | "anime-popular" (AniList, this season). `data`:
    /// `{"items":[TitleCard]}`.
    pub async fn trending(kind: String, language: String) -> String {
        metadata().trending(kind, language).await
    }

    /// A title by our ID ("tmdb:movie:603", "tmdb:tv:1399", "anilist:21"):
    /// `data` is a Title. An AniList ID the anime lists tie to one TMDB title
    /// answers with that title (its `id` is the TMDB one).
    pub async fn title(id: String, language: String) -> String {
        metadata().title(id, language).await
    }

    /// TMDB season `season` (0 = specials) of a series: `data` is a Season
    /// with its episodes.
    pub async fn season(id: String, season: u32, language: String) -> String {
        metadata().season(id, season, language).await
    }

    /// Search: `data` is `{"sections":[{"source":"tmdb"|"anilist","items":[TitleCard]}]}`;
    /// an anime TMDB found is not repeated under AniList.
    pub async fn search(query: String, language: String) -> String {
        metadata().search(query, language).await
    }
}

/// Finding releases on the user's own source (Torznab). Searches run in the
/// background: start one, then poll `result`.
#[cfg(not(target_arch = "wasm32"))]
#[module]
pub struct Sources;

#[cfg(not(target_arch = "wasm32"))]
#[module]
impl Sources {
    /// Searches for a film or an episode. `request` is JSON
    /// `{"imdb","title","year","season","episode"}` (imdb, year, season and
    /// episode optional). A search id for `result`; 0 when no source is set.
    pub fn search(request: String) -> u32 {
        let Some(source) = settings::source() else { return 0 };
        match serde_json::from_str::<reel_domain::search::Request>(&request) {
            Ok(r) => playback().search(source, r),
            Err(e) => {
                tracing::warn!("reel sources: bad request {request}: {e}");
                0
            }
        }
    }

    /// The tallest picture Play picks by itself, in lines (1080 on a phone or a tablet: 4K costs it
    /// time and space for nothing it can show); 0: any. The viewer can still choose any release.
    pub fn set_picture_cap(lines: u32) {
        catalog::set_picture_cap(lines);
    }

    /// Sets the player profile of this device (what it can play): "mpv",
    /// "apple_avplayer", "android_mediaplayer", "tizen". Releases it cannot
    /// play are hidden from searches. False for an unknown name.
    pub fn set_profile(name: String) -> bool {
        match reel_domain::compat::Profile::parse(&name) {
            Some(p) => {
                reel_domain::compat::set_profile(p);
                true
            }
            None => false,
        }
    }

    /// Checks the saved source (`t=caps`); a job id for `result`, 0 when none is set.
    pub fn check() -> u32 {
        settings::source().map(|s| playback().check_source(s)).unwrap_or(0)
    }

    /// `{"state":"pending"}`, `{"state":"done","releases":[…]}` (ranked: each
    /// `{"id","title","source","infohash","size","seeders","peers","indexer",
    /// "info":{resolution,hdr,dolby_vision,codec,source,season,episodes,season_pack},
    /// "seasonPack"}`), `{"state":"done","caps":{…}}` for a check, or
    /// `{"state":"failed","message"}`.
    pub fn result(id: u32) -> String {
        playback().search_result(id).to_string()
    }
}

/// Saving films and episodes to watch offline (design/offline-downloads.md). Results are
/// JSON strings; states and messages are keys the UI words (`saved.*`).
#[cfg(not(target_arch = "wasm32"))]
#[module]
pub struct Library;

#[cfg(not(target_arch = "wasm32"))]
#[module]
impl Library {
    /// Whether this device saves films (false on TVs and without the engine): no Save
    /// control shows when it does not.
    pub fn supported() -> bool {
        library::supported()
    }

    /// Saves the catalog keys in `keys` (a JSON array: a film, or episodes) once their
    /// release is known; what is saved already stays. False when this device saves nothing.
    pub fn save(keys: String) -> bool {
        let keys: Vec<String> = serde_json::from_str(&keys).unwrap_or_default();
        library::save(&keys)
    }

    /// One key's state for its button: `{"state","progress","id","message"}` (see
    /// `library::item`).
    pub fn item(key: String) -> String {
        library::item(&key).to_string()
    }

    /// The Save button of a title (`show`: a series): `{"state","saved","saving","progress"}`.
    pub fn title(id: String, show: bool) -> String {
        library::title(&id, show).to_string()
    }

    /// The Save drawer for a season: `{"episodes":[{"key","number","title","size","state",
    /// "progress","locked"}],"saved","total","size"}`.
    pub fn plan(show: String, season: u32) -> String {
        library::plan(&show, season).to_string()
    }

    /// The Saved screen: `{"saving":[…],"ready":[…],"failed":[…],"space":{"saved","free",
    /// "folder"}}`, each item `{"id","key","title","label","image","season","number","state",
    /// "size","have","progress","speed","peers","message","folder"}`.
    pub fn list() -> String {
        library::list().to_string()
    }

    /// Pauses saving the item (its whole torrent: episodes of one pack pause together).
    pub fn pause(id: u32) {
        library::set_running(id, false);
    }

    /// Goes on saving a paused item.
    pub fn resume(id: u32) {
        library::set_running(id, true);
    }

    /// Stops saving the item and deletes its files.
    pub fn remove(id: u32) {
        library::remove(id);
    }

    /// Saves new items into `folder` from now on: "" when done, else why not.
    pub fn set_folder(folder: String) -> String {
        library::set_folder(&folder).err().unwrap_or_default()
    }

    /// Opens the folder saved films go into in the system's file manager (desktops); false
    /// where there is none or it did not open.
    pub fn open_folder() -> bool {
        library::open_folder()
    }

    /// Goes up when anything the Saved screen and the Save buttons show changed.
    pub fn revision() -> f64 {
        library::revision() as f64
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
