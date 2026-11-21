//! app/'s modules by the names NSH gives the TSX side (`.nsh/types/app/native.d.ts`). Kept
//! by hand in step with app/src/lib.rs; the `matches_the_declarations` test compares the two
//! whenever the declarations exist (after any `nsh run`/`nsh check` in app/), and CI runs it
//! after its `nsh check` (`build/build.sh test-tizen-core`).

use std::path::PathBuf;

use reel_app::{Catalog, Engine, Fmt, Hosted, Meta, Library, Settings, Sources, VideoEngine};
use reel_rpc::{Error, Registry, args, no_args, ret};

/// `Settings.load` and `Meta.init` take the host's data dir (`process.dataDir` on native
/// hosts). The web UI does not have the core's: it asks `GET /health` (`info.dataDir`) and
/// passes that, or "" for the in-memory mode the modules document. Any other path is a path
/// on the wrong machine, refused rather than replaced.
fn host_dir(given: String, host: &PathBuf) -> Result<String, Error> {
    if given.is_empty() || PathBuf::from(&given) == *host {
        Ok(given)
    } else {
        Err(Error::BadArgs(format!(
            "dataDir {given:?} is not the core's ({}); pass info.dataDir from GET /health",
            host.display()
        )))
    }
}

pub fn registry(data_dir: PathBuf) -> Registry {
    let mut r = Registry::new();

    r.sync("Engine", "open", |a| {
        let (film,): (String,) = args(a)?;
        ret(Engine::open(film))
    })
    .sync("Engine", "status", |a| {
        let (job,): (u32,) = args(a)?;
        ret(Engine::status(job))
    })
    .sync("Engine", "timeline", |a| {
        let (job, position, duration, cached, read_byte, read_time): (u32, f64, f64, f64, f64, f64) = args(a)?;
        ret(Engine::timeline(job, position, duration, cached, read_byte, read_time))
    })
    .sync("Engine", "checkSpace", |a| {
        no_args(&a)?;
        ret(Engine::check_space())
    })
    .sync("Engine", "openRelease", |a| {
        let (source, season, episode): (String, u32, u32) = args(a)?;
        ret(Engine::open_release(source, season, episode))
    })
    .sync("Engine", "close", |a| {
        let (job,): (u32,) = args(a)?;
        ret(Engine::close(job))
    })
    .sync("Engine", "firstFrame", |a| {
        let (job,): (u32,) = args(a)?;
        ret(Engine::first_frame(job))
    })
    .r#async("Engine", "seek", |a| async move {
        let (job, seconds): (u32, f64) = args(a)?;
        ret(Engine::seek(job, seconds).await)
    })
    .sync("Engine", "subtitles", |a| {
        let (job,): (u32,) = args(a)?;
        ret(Engine::subtitles(job))
    })
    .sync("Engine", "cues", |a| {
        let (job, id, from, to): (u32, u32, f64, f64) = args(a)?;
        ret(Engine::cues(job, id, from, to))
    })
    .sync("Engine", "tracks", |a| {
        let (job, id, embedded): (u32, String, String) = args(a)?;
        ret(Engine::tracks(job, id, embedded))
    })
    .sync("Engine", "chooseTrack", |a| {
        let (job, id, embedded, choice): (u32, String, String, String) = args(a)?;
        ret(Engine::choose_track(job, id, embedded, choice))
    });

    // What draws the video: on a TV the shell's AVPlay, never this core's player.
    r.sync("VideoEngine", "kind", |a| {
        no_args(&a)?;
        ret(VideoEngine::kind())
    })
    .sync("VideoEngine", "fullscreen", |a| {
        let (on,): (bool,) = args(a)?;
        ret(VideoEngine::fullscreen(on))
    })
    .sync("VideoEngine", "views", |a| {
        no_args(&a)?;
        ret(VideoEngine::views())
    })
    .sync("VideoEngine", "held", |a| {
        no_args(&a)?;
        ret(VideoEngine::held())
    })
    .sync("VideoEngine", "immersive", |a| {
        let (on,): (bool,) = args(a)?;
        ret(VideoEngine::immersive(on))
    })
    .sync("VideoEngine", "turnScale", |a| {
        let (from, to, width, height, aspect): (i32, i32, f64, f64, f64) = args(a)?;
        ret(VideoEngine::turn_scale(from, to, width, height, aspect))
    })
    .sync("VideoEngine", "sideways", |a| {
        let (width, height): (f64, f64) = args(a)?;
        ret(VideoEngine::sideways(width, height))
    });

    let host = data_dir.clone();
    r.sync("Settings", "load", move |a| {
        let (dir, languages): (String, String) = args(a)?;
        ret(Settings::load(host_dir(dir, &host)?, languages))
    })
    .sync("Settings", "setBufferMb", |a| {
        let (mb,): (u32,) = args(a)?;
        ret(Settings::set_buffer_mb(mb))
    })
    .sync("Settings", "setSource", |a| {
        let (url, key): (String, String) = args(a)?;
        ret(Settings::set_source(url, key))
    })
    .sync("Settings", "setLanguage", |a| {
        let (tag,): (String,) = args(a)?;
        ret(Settings::set_language(tag))
    })
    .sync("Settings", "device", |a| {
        no_args(&a)?;
        ret(Settings::device())
    })
    .sync("Settings", "windowed", |a| {
        let (width, height): (f64, f64) = args(a)?;
        ret(Settings::windowed(width, height))
    })
    .sync("Settings", "setFamily", |a| {
        let (name,): (String,) = args(a)?;
        ret(Settings::set_family(name))
    })
    .sync("Settings", "setContentLanguage", |a| {
        let (tag,): (String,) = args(a)?;
        ret(Settings::set_content_language(tag))
    })
    .sync("Settings", "setAudioLanguage", |a| {
        let (code,): (String,) = args(a)?;
        ret(Settings::set_audio_language(code))
    })
    .sync("Settings", "setStreamDetails", |a| {
        let (on,): (bool,) = args(a)?;
        ret(Settings::set_stream_details(on))
    })
    .sync("Settings", "setNavPosition", |a| {
        let (position,): (String,) = args(a)?;
        ret(Settings::set_nav_position(position))
    })
    .sync("Settings", "setLoader", |a| {
        let (loader,): (String,) = args(a)?;
        ret(Settings::set_loader(loader))
    })
    .sync("Settings", "finishSetup", |a| {
        no_args(&a)?;
        ret(Settings::finish_setup())
    })
    .sync("Settings", "current", |a| {
        no_args(&a)?;
        ret(Settings::current())
    })
    .sync("Settings", "revision", |a| {
        no_args(&a)?;
        ret(Settings::revision())
    })
    .r#async("Settings", "changed", |a| async move {
        let (after,): (f64,) = args(a)?;
        ret(Settings::changed(after).await)
    });

    // Settings from a phone (docs/hosted-settings.md): what the TV's own UI shows of it.
    r.sync("Hosted", "address", |a| {
        no_args(&a)?;
        ret(Hosted::address())
    })
    .sync("Hosted", "pairing", |a| {
        no_args(&a)?;
        ret(Hosted::pairing())
    })
    .sync("Hosted", "cancelPairing", |a| {
        no_args(&a)?;
        ret(Hosted::cancel_pairing())
    })
    .sync("Hosted", "link", |a| {
        no_args(&a)?;
        ret(Hosted::link())
    })
    .sync("Hosted", "partner", |a| {
        no_args(&a)?;
        ret(Hosted::partner())
    })
    .sync("Hosted", "offered", |a| {
        no_args(&a)?;
        ret(Hosted::offered())
    })
    .sync("Hosted", "answerOffer", |a| {
        let (accept,): (bool,) = args(a)?;
        ret(Hosted::answer_offer(accept))
    })
    .sync("Hosted", "linkSource", |a| {
        let (link,): (String,) = args(a)?;
        ret(Hosted::link_source(link))
    });

    // The TV saves nothing (`Library.supported()` is false there): its answers say so.
    r.sync("Library", "supported", |a| {
        no_args(&a)?;
        ret(Library::supported())
    })
    .sync("Library", "save", |a| {
        let (keys,): (String,) = args(a)?;
        ret(Library::save(keys))
    })
    .sync("Library", "item", |a| {
        let (key,): (String,) = args(a)?;
        ret(Library::item(key))
    })
    .sync("Library", "title", |a| {
        let (id, show): (String, bool) = args(a)?;
        ret(Library::title(id, show))
    })
    .sync("Library", "plan", |a| {
        let (show, season, picked): (String, u32, String) = args(a)?;
        ret(Library::plan(show, season, picked))
    })
    .sync("Library", "offer", |a| {
        let (key,): (String,) = args(a)?;
        ret(Library::offer(key))
    })
    .sync("Library", "saveRelease", |a| {
        let (key, release): (String, String) = args(a)?;
        ret(Library::save_release(key, release))
    })
    .sync("Library", "list", |a| {
        no_args(&a)?;
        ret(Library::list())
    })
    .sync("Library", "pause", |a| {
        let (id,): (u32,) = args(a)?;
        ret(Library::pause(id))
    })
    .sync("Library", "resume", |a| {
        let (id,): (u32,) = args(a)?;
        ret(Library::resume(id))
    })
    .sync("Library", "remove", |a| {
        let (id,): (u32,) = args(a)?;
        ret(Library::remove(id))
    })
    .sync("Library", "setFolder", |a| {
        let (folder,): (String,) = args(a)?;
        ret(Library::set_folder(folder))
    })
    .sync("Library", "openFolder", |a| {
        no_args(&a)?;
        ret(Library::open_folder())
    })
    .sync("Library", "revision", |a| {
        no_args(&a)?;
        ret(Library::revision())
    })
    .sync("Library", "overall", |a| {
        no_args(&a)?;
        ret(Library::overall())
    })
    .sync("Library", "opening", |a| {
        no_args(&a)?;
        ret(Library::opening())
    });

    r.sync("Sources", "search", |a| {
        let (request,): (String,) = args(a)?;
        ret(Sources::search(request))
    })
    .sync("Sources", "setProfile", |a| {
        let (name,): (String,) = args(a)?;
        ret(Sources::set_profile(name))
    })
    .sync("Sources", "check", |a| {
        no_args(&a)?;
        ret(Sources::check())
    })
    .sync("Sources", "result", |a| {
        let (id,): (u32,) = args(a)?;
        ret(Sources::result(id))
    });

    r.sync("Catalog", "revision", |a| {
        no_args(&a)?;
        ret(Catalog::revision())
    })
    .sync("Catalog", "home", |a| {
        no_args(&a)?;
        ret(Catalog::home())
    })
    .sync("Catalog", "browse", |a| {
        let (page,): (String,) = args(a)?;
        ret(Catalog::browse(page))
    })
    .sync("Catalog", "browseMore", |a| {
        let (page,): (String,) = args(a)?;
        ret(Catalog::browse_more(page))
    })
    .sync("Catalog", "chooseFilter", |a| {
        let (page, group, id): (String, String, String) = args(a)?;
        ret(Catalog::choose_filter(page, group, id))
    })
    .sync("Catalog", "title", |a| {
        let (id,): (String,) = args(a)?;
        ret(Catalog::title(id))
    })
    .sync("Catalog", "episodes", |a| {
        let (show, season): (String, u32) = args(a)?;
        ret(Catalog::episodes(show, season))
    })
    .sync("Catalog", "person", |a| {
        let (id,): (String,) = args(a)?;
        ret(Catalog::person(id))
    })
    .sync("Catalog", "episode", |a| {
        let (show, season, number): (String, u32, u32) = args(a)?;
        ret(Catalog::episode(show, season, number))
    })
    .sync("Catalog", "upNext", |a| {
        let (id, position, duration): (String, f64, f64) = args(a)?;
        ret(Catalog::up_next(id, position, duration))
    })
    .sync("Catalog", "tracks", |a| {
        let (id,): (String,) = args(a)?;
        ret(Catalog::tracks(id))
    })
    .sync("Catalog", "episodeReleases", |a| {
        let (key,): (String,) = args(a)?;
        ret(Catalog::episode_releases(key))
    })
    .sync("Catalog", "search", |a| {
        let (query,): (String,) = args(a)?;
        ret(Catalog::search(query))
    })
    .sync("Catalog", "rememberSearch", |a| {
        let (query,): (String,) = args(a)?;
        ret(Catalog::remember_search(query))
    })
    .sync("Catalog", "forgetSearches", |a| {
        no_args(&a)?;
        ret(Catalog::forget_searches())
    })
    .sync("Catalog", "retrySearch", |a| {
        let (query,): (String,) = args(a)?;
        ret(Catalog::retry_search(query))
    })
    .sync("Catalog", "toggleList", |a| {
        let (id,): (String,) = args(a)?;
        ret(Catalog::toggle_list(id))
    })
    .sync("Catalog", "chooseRelease", |a| {
        let (id, index): (String, u32) = args(a)?;
        ret(Catalog::choose_release(id, index))
    })
    .sync("Catalog", "startAt", |a| {
        let (id,): (String,) = args(a)?;
        ret(Catalog::start_at(id))
    })
    .sync("Catalog", "saveProgress", |a| {
        let (id, position, duration): (String, f64, f64) = args(a)?;
        ret(Catalog::save_progress(id, position, duration))
    });

    let host = data_dir;
    r.sync("Meta", "init", move |a| {
        let (dir,): (String,) = args(a)?;
        ret(Meta::init(host_dir(dir, &host)?))
    })
    .sync("Meta", "setTmdbKey", |a| {
        let (key,): (String,) = args(a)?;
        ret(Meta::set_tmdb_key(key))
    })
    .sync("Meta", "status", |a| {
        no_args(&a)?;
        ret(Meta::status())
    })
    .sync("Meta", "revision", |a| {
        no_args(&a)?;
        ret(Meta::revision())
    })
    .sync("Meta", "attribution", |a| {
        no_args(&a)?;
        ret(Meta::attribution())
    })
    .sync("Settings", "project", |a| {
        no_args(&a)?;
        ret(Settings::project())
    })
    .r#async("Catalog", "changed", |a| async move {
        let (after,): (f64,) = args(a)?;
        ret(Catalog::changed(after).await)
    })
    .r#async("Meta", "trending", |a| async move {
        let (kind, language): (String, String) = args(a)?;
        ret(Meta::trending(kind, language).await)
    })
    .r#async("Meta", "title", |a| async move {
        let (id, language): (String, String) = args(a)?;
        ret(Meta::title(id, language).await)
    })
    .r#async("Meta", "season", |a| async move {
        let (id, season, language): (String, u32, String) = args(a)?;
        ret(Meta::season(id, season, language).await)
    })
    .r#async("Meta", "search", |a| async move {
        let (query, language): (String, String) = args(a)?;
        ret(Meta::search(query, language).await)
    });

    r.sync("Fmt", "position", |a| {
        let (seconds,): (u32,) = args(a)?;
        ret(Fmt::position(seconds))
    })
    .sync("Fmt", "size", |a| {
        let (bytes,): (f64,) = args(a)?;
        ret(Fmt::size(bytes))
    })
    .sync("Fmt", "sizeOf", |a| {
        let (have, size): (f64, f64) = args(a)?;
        ret(Fmt::size_of(have, size))
    })
    .sync("Fmt", "speed", |a| {
        let (mib_per_s,): (f64,) = args(a)?;
        ret(Fmt::speed(mib_per_s))
    })
    .sync("Fmt", "hoursMinutes", |a| {
        let (minutes,): (u32,) = args(a)?;
        ret(Fmt::hours_minutes(minutes))
    });

    r
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn table() -> Registry {
        registry(std::env::temp_dir().join("reel-tizen-core-test"))
    }

    /// A CI run (`CI=true` on GitHub Actions; `1` elsewhere), where nothing may be skipped.
    fn on_ci() -> bool {
        matches!(std::env::var("CI").as_deref(), Ok("true" | "1"))
    }

    #[tokio::test]
    async fn calls_app_modules() {
        let r = table();
        assert_eq!(r.call("Fmt", "position", json!([4360])).await, Ok(json!("1:12:40")));
        assert_eq!(r.call("Fmt", "hoursMinutes", json!([95])).await, Ok(json!([1, 35])));
        let home: serde_json::Value = serde_json::from_str(r.call("Catalog", "home", json!([])).await.unwrap().as_str().unwrap()).unwrap();
        assert!(home.is_array() || home.is_object());
    }

    #[tokio::test]
    async fn data_dir_is_the_hosts() {
        let r = table();
        let wrong = r.call("Settings", "load", json!(["/somewhere/else", "[]"])).await;
        assert!(matches!(wrong, Err(Error::BadArgs(m)) if m.contains("GET /health")));
    }

    /// The table has exactly the methods of app/'s generated declarations. Without them (no
    /// `nsh check` in app/ yet) it is skipped on a developer's machine; on CI (`CI` set, as
    /// GitHub Actions sets it) it fails: there it must run (`build/build.sh test-tizen-core`).
    #[test]
    fn matches_the_declarations() {
        let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../../app/.nsh/types/app/native.d.ts");
        let dts = match std::fs::read_to_string(path) {
            Ok(dts) => dts,
            Err(e) if on_ci() => panic!("no {path} ({e}): run `nsh check` in app/ before this test"),
            Err(_) => {
                eprintln!("skipped: no {path} (run `nsh check` in app/)");
                return;
            }
        };
        let mut declared = Vec::new();
        let mut module = None;
        for line in dts.lines() {
            let line = line.trim();
            if let Some(rest) = line.strip_prefix("export interface ") {
                module = rest.strip_suffix("Module {").map(str::to_owned);
            } else if line == "}" {
                module = None;
            } else if let (Some(m), Some((name, _))) = (&module, line.split_once('(')) {
                if !line.starts_with('*') && !line.starts_with("/*") {
                    declared.push(format!("{m}.{name}"));
                }
            }
        }
        declared.sort();
        assert_eq!(table().names(), declared);
    }
}
