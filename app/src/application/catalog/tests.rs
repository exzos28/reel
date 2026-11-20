//! The catalog on recorded `Meta` answers (the metadata layer's fixtures,
//! mapped by its own code): no network.

use super::*;
use reel_domain::fit;
use reel_domain::discover::Sort;
use crate::adapters::metadata::{
    provider::{MapCx, TitleSource},
    tmdb::{ImageConfig, Tmdb},
};

fn fixture(name: &str) -> Value {
    let path = format!("{}/src/adapters/metadata/fixtures/{name}", env!("CARGO_MANIFEST_DIR"));
    serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap()
}

fn cx() -> MapCx {
    MapCx { lang: "pl-PL".into(), images: ImageConfig::from_configuration(&fixture("tmdb_configuration.json")).unwrap() }
}

fn tmdb() -> Tmdb {
    Tmdb::new(Some("test".into()))
}

/// `Meta` answered `call` with `data`; never asked again.
fn seed(call: Call, data: Value) {
    land(&call, &json!({ "data": data }), u64::MAX);
}

fn seed_trending(kind: &'static str, fixture_name: &str) {
    let items = tmdb().map_cards(&fixture(fixture_name), &cx()).unwrap();
    seed(Call::Trending(kind), json!({ "items": items }));
}

const MATRIX: &str = "tmdb:movie:603";
const AOT: &str = "tmdb:tv:1429";

fn seed_matrix() {
    let t = tmdb().map_title(&fixture("tmdb_movie_603.json"), &cx()).unwrap();
    seed(Call::Title(MATRIX.into()), serde_json::to_value(t).unwrap());
}

fn seed_aot() {
    let t = tmdb().map_title(&fixture("tmdb_tv_1429.json"), &cx()).unwrap();
    let season = tmdb().map_season(&fixture("tmdb_tv_1429_season_3.json"), &cx(), AOT, None, &[]).unwrap();
    seed(Call::Title(AOT.into()), serde_json::to_value(t).unwrap());
    seed(Call::Season(AOT.into(), 3), serde_json::to_value(season).unwrap());
}

/// A search answer as `sources` ranks it.
fn release(title: &str, resolution: Option<u16>, source: &str, size_gb: f64, seeders: u64, pack: bool) -> Value {
    json!({
        "id": title, "title": title, "source": format!("magnet:?xt=urn:btih:{title}"),
        "size": size_gb * 1024.0 * 1024.0 * 1024.0, "seeders": seeders, "peers": seeders, "indexer": "test",
        "info": { "resolution": resolution, "hdr": false, "dolby_vision": false, "codec": null, "source": source,
                  "season": null, "episodes": [], "season_pack": pack },
        "seasonPack": pack,
    })
}

fn found(key: &str, releases: Vec<Value>) {
    SEARCHES.lock().unwrap().insert(key.into(), Search { releases: Some(releases), failed: None, ended: None });
}

/// Takes the stores for the test, empty, with TMDB and a source as given.
fn fresh(tmdb_on: bool, source: bool) -> std::sync::MutexGuard<'static, ()> {
    let guard = TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    reset(tmdb_on, source);
    guard
}

fn reset(tmdb_on: bool, source: bool) {
    SLOTS.0.lock().unwrap().clear();
    SEARCHES.lock().unwrap().clear();
    CHOSEN.lock().unwrap().clear();
    crate::application::watchlist::clear();
    SHOWN.lock().unwrap().clear();
    filters::clear();
    paging::clear();
    progress::clear();
    search::reset();
    *TEST_TMDB.lock().unwrap() = Some(tmdb_on);
    *TEST_SOURCE.lock().unwrap() = Some(source);
}

#[test]
fn keys() {
    assert_eq!(episode_key(AOT, 3, 2), "tmdb:tv:1429:s3e2");
    assert_eq!(parse_key("tmdb:tv:1429:s3e2"), (AOT, Some((3, 2))));
    assert_eq!(parse_key(MATRIX), (MATRIX, None));
    assert_eq!(parse_key("anilist:21"), ("anilist:21", None));
}

#[test]
fn numbers() {
    assert_eq!(votes(82_000), "82K");
    assert_eq!(votes(6_400), "6.4K");
    assert_eq!(votes(950), "950");
    assert_eq!(votes(1_012), "1K", "no trailing .0");
    assert_eq!(votes(2_000_000), "2M");
    let r = json!([{ "source": "anilist", "value": 85.0, "scale": 100.0, "votes": null }]);
    assert_eq!(rating(&r), ("8.5".into(), String::new()));
    assert_eq!(ymd(&json!("2018-07-23")), Some([2018, 7, 23]));
    assert_eq!(ymd(&json!(null)), None);
}

#[test]
fn home_shelves_from_meta() {
    let _g = fresh(true, false);
    seed_trending("movie", "tmdb_trending_movie.json");
    seed_trending("tv", "tmdb_discover_tv.json");
    seed(Call::Trending("movie-popular"), json!({ "items": [] }));
    seed(Call::Trending("tv-popular"), json!({ "items": [] }));
    seed(Call::Trending("anime"), json!({ "items": [] }));
    let shelves = home_shelves();
    let ids: Vec<_> = shelves.as_array().unwrap().iter().map(|s| s["id"].as_str().unwrap()).collect();
    // Empty shelves (Continue watching, nothing popular, no anime) are left out.
    assert_eq!(ids, vec!["trending_movies", "trending_shows"]);
    // The hero, the first card, is not repeated on its shelf.
    let h = home();
    assert_eq!(h["hero"]["id"], shelves[0]["items"][0]["id"]);
    assert!(h["shelves"][0]["items"].as_array().unwrap().iter().all(|i| i["id"] != h["hero"]["id"]));
    let first = &shelves[0]["items"][0];
    assert_eq!(first["id"], "tmdb:movie:1368337");
    assert_eq!(first["kind"], "movie");
    assert_eq!(first["title"], "Odyseja");
    // The hero's still: the original on a desktop (a wide window on a 2x screen), w1280 elsewhere.
    let still = if cfg!(any(target_os = "macos", windows, all(target_os = "linux", not(target_arch = "arm")))) { "original" } else { "w1280" };
    assert!(first["still"].as_str().unwrap().starts_with(&format!("https://image.tmdb.org/t/p/{still}/")));
    assert!(first["card"].as_str().unwrap().starts_with("https://image.tmdb.org/t/p/w780/"));
    assert!(first["poster"].as_str().unwrap().starts_with("https://image.tmdb.org/t/p/w342/"));
    assert_eq!(first["play"]["id"], "tmdb:movie:1368337");
    assert_eq!(first["release"], Value::Null);
    assert_eq!(first["notice"], Value::Null);
    assert_eq!(shelves[1]["items"][0]["kind"], "show");

    // Nothing at all: a notice card says why.
    reset(true, false);
    for k in ["movie", "tv", "movie-popular", "tv-popular", "anime"] {
        land(&Call::Trending(k), &json!({ "data": null, "error": { "kind": "network" } }), u64::MAX);
    }
    let shelves = home_shelves();
    assert_eq!(shelves, json!([{ "id": "offline", "facet": "kind", "items": [notice("offline")] }]));
    // A notice card alone: the hero says it, and its shelf stays (nothing would be left).
    assert_eq!(home(), json!({ "hero": notice("offline"), "shelves": shelves }));
    assert_eq!(shelves[0]["items"][0]["notice"], "offline");
}

#[test]
fn without_tmdb_anime_and_a_notice() {
    let _g = fresh(false, false);
    let anime = crate::adapters::metadata::anilist::Anilist.map_cards(&fixture("anilist_trending.json"), &cx()).unwrap();
    seed(Call::Trending("anime"), json!({ "items": anime }));
    let shelves = home_shelves();
    assert_eq!(shelves[0]["id"], "anime");
    assert!(shelves[0]["items"][0]["id"].as_str().unwrap().starts_with("anilist:"));
    assert_eq!(shelves[0]["items"][0]["rating"], "8.5");
    assert_eq!(shelves[1]["id"], "no_tmdb");
    assert_eq!(shelves[1]["items"][0]["notice"], "no_tmdb");
    assert_eq!(browse("movies")["trending"][0]["notice"], "no_tmdb");
    // The Anime page works without a TMDB key: AniList's trending.
    let page = browse("anime");
    assert!(page["trending"][0]["id"].as_str().unwrap().starts_with("anilist:"));
}

#[test]
fn a_film_screen() {
    let _g = fresh(true, false);
    seed_matrix();
    let t = title(MATRIX);
    assert_eq!(t["id"], MATRIX);
    assert_eq!(t["title"], "Matrix");
    assert_eq!(t["minutes"], 136);
    assert_eq!(t["year"], 1999);
    assert_eq!(t["rating"], "8.3");
    assert_eq!(t["votes"], "29K");
    assert_eq!(t["genres"], json!(["Akcja", "Sci-Fi"]));
    assert_eq!(t["releases"], json!([]));
    assert_eq!(t["releasesState"], "no_source");
    assert_eq!(t["playable"], false);
    assert!(matches!(play_source(MATRIX), PlaySource::None));
    // Not known yet: a notice title, so the screen has something to show.
    assert_eq!(title("tmdb:movie:1")["notice"], "loading");
    assert_eq!(title("tmdb:movie:1")["cast"], json!([]));
}

#[test]
fn a_film_screen_below_the_hero() {
    let _g = fresh(true, false);
    seed_matrix();
    let t = title(MATRIX);
    let cast = t["cast"].as_array().unwrap();
    assert_eq!(cast[0]["name"], "Keanu Reeves");
    assert_eq!(cast[0]["character"], "Neo");
    assert_eq!(cast[0]["initials"], "KR");
    assert!(cast[0]["photo"].as_str().unwrap().starts_with("https://image.tmdb.org/t/p/w185/"));
    let jobs: Vec<_> = t["crew"].as_array().unwrap().iter().map(|c| c["job"].as_str().unwrap()).collect();
    assert_eq!(jobs, ["director", "writer", "music"], "no producers");
    assert_eq!(t["crew"][1]["names"].as_array().unwrap().len(), 2);
    assert_eq!(t["originalTitle"], "The Matrix");
    assert_eq!(t["releaseDate"], json!([1999, 3, 31]));
    assert!(t["countries"].as_array().unwrap().contains(&json!("United States")));
    assert!(!t["studios"].as_array().unwrap().is_empty());
    assert_eq!(t["status"], Value::Null, "a film has no status line");
    // The UI is in English: the US rating.
    assert_eq!(t["certification"], "R");
    assert_eq!(t["ratings"], json!([{ "source": "tmdb", "value": "8.3", "votes": "29K" }]));
    let similar: Vec<_> = t["similar"].as_array().unwrap().iter().map(|s| s["id"].as_str().unwrap()).collect();
    assert_eq!(similar, ["tmdb:movie:604", "tmdb:movie:605"]);
    assert_eq!(t["similar"][0]["title"], "Matrix Reaktywacja");
    assert_eq!(t["similar"][0]["kind"], "movie");
    assert!(t["similar"][0]["card"].as_str().unwrap().starts_with("https://image.tmdb.org/t/p/w780/"));
}

#[test]
fn releases_from_the_search_best_quality_first() {
    let _g = fresh(true, true);
    seed_matrix();
    // The title screen starts the search; it runs.
    assert_eq!(title(MATRIX)["releasesState"], "searching");
    assert!(matches!(play_source(MATRIX), PlaySource::Searching));
    found(
        MATRIX,
        vec![
            release("The.Matrix.1999.2160p.UHD.BluRay.REMUX", Some(2160), "remux", 60.0, 40, false),
            release("The.Matrix.1999.1080p.BluRay.x264", Some(1080), "bluray", 8.0, 120, false),
            release("The.Matrix.1999.720p.WEB", Some(720), "web", 2.0, 400, false),
            release("The.Matrix.1999.DVDRip", None, "dvd", 1.0, 3, false),
        ],
    );
    let t = title(MATRIX);
    assert_eq!(t["releasesState"], "done");
    let r = t["releases"].as_array().unwrap();
    let names: Vec<_> = r.iter().map(|x| x["quality"].as_str().unwrap()).collect();
    // One of each quality: all in the short list, best first.
    assert_eq!(names, vec!["4K", "1080p", "720p", "SD"]);
    assert!(r.iter().all(|x| x["top"] == true));
    assert_eq!(r[0]["note"], "needs");
    // 8 GB over 136 min is 9 Mbit/s and 120 share: the best that plays now.
    assert_eq!(r[1]["selected"], true);
    assert_eq!(r[1]["note"], "starts_fast");
    assert_eq!(r[1]["mbit"], 9);
    assert_eq!(r[1]["source"], "BluRay");
    assert_eq!(r[1]["group"], "The.Matrix.1999.1080p.BluRay.x264");
    assert_eq!(r[2]["note"], "starts_fast");
    assert_eq!(r[3]["note"], "few_sharing");
    assert_eq!(r[3]["source"], "DVD");
    // Their names say no languages or codec: the line is the size.
    assert_eq!(r[3]["line"], json!([{ "text": "1 GB" }]));
    assert_eq!(t["release"]["quality"], "1080p");
    assert_eq!(t["release"]["size"], "8 GB");
    match play_source(MATRIX) {
        PlaySource::Ready(s, None, _) => assert_eq!(s, "magnet:?xt=urn:btih:The.Matrix.1999.1080p.BluRay.x264"),
        _ => panic!("a release plays"),
    }

    // The user's choice wins.
    assert!(choose_release(MATRIX, 2));
    assert_eq!(title(MATRIX)["release"]["quality"], "720p");
    assert!(!choose_release(MATRIX, 9));
    assert_eq!(tracks(MATRIX)["releases"].as_array().unwrap().len(), 4);
}

#[test]
fn a_series_screen_with_seasons_and_episodes() {
    let _g = fresh(true, true);
    seed_aot();
    let t = title(AOT);
    assert_eq!(t["kind"], "show");
    assert_eq!(t["seasons"], 4);
    assert_eq!(t["yearEnd"], 2022);
    let seasons = t["seasonList"].as_array().unwrap();
    assert_eq!(seasons.len(), 4, "specials are not a tab");
    assert_eq!(seasons[2]["number"], 3);
    assert_eq!(seasons[2]["episodes"], 22);
    // Nothing watched: Play starts the first episode.
    assert_eq!(t["play"]["id"], "tmdb:tv:1429:s1e1");
    assert_eq!(t["season"], 1);
    assert_eq!(t["resume"], Value::Null);
    assert_eq!(t["status"], "ended");
    assert_eq!(t["certification"], "TV-MA");
    assert_eq!(t["crew"][0]["job"], "music", "no creators listed: the music");
    assert_eq!(t["similar"][0]["id"], "tmdb:tv:31911");
    assert_eq!(t["similar"][0]["kind"], "show");

    let eps = episodes(AOT, 3);
    let e = &eps[1];
    assert_eq!(e["id"], "tmdb:tv:1429:s3e2");
    assert_eq!(e["show"], AOT);
    assert_eq!(e["title"], "Ból");
    assert_eq!(e["minutes"], 24);
    assert_eq!(e["date"], json!([2018, 7, 30]));
    assert!(e["thumb"].as_str().unwrap().starts_with("https://image.tmdb.org/t/p/w300/"));
    assert_eq!(e["watched"], false);
    assert_eq!(episode(AOT, 3, 2)["title"], "Ból");
    assert_eq!(episodes(AOT, 2), json!([]), "a season not known yet");
}

#[test]
fn resume_continue_watching_and_up_next() {
    let _g = fresh(true, true);
    seed_matrix();
    seed_aot();

    // Halfway through S3:E2.
    assert!(save_progress("tmdb:tv:1429:s3e1", 1400.0, 1440.0), "97% is watched");
    assert!(!save_progress("tmdb:tv:1429:s3e2", 600.0, 1440.0));
    assert!(!save_progress(MATRIX, 2472.0, 8160.0));
    assert_eq!(progress::start_at("tmdb:tv:1429:s3e2"), 600.0);

    let t = title(AOT);
    assert_eq!(t["resume"], json!({ "season": 3, "episode": 2 }));
    assert_eq!(t["season"], 3);
    assert_eq!(t["play"], json!({ "id": "tmdb:tv:1429:s3e2", "season": 3, "episode": 2, "start": 600.0 }));
    assert_eq!(t["left"], 14);
    let eps = episodes(AOT, 3);
    assert_eq!(eps[0]["watched"], true);
    assert_eq!(eps[1]["note"], json!({ "left": 14 }));
    assert_eq!(eps[1]["start"], 600.0);

    let m = title(MATRIX);
    assert_eq!(m["stoppedAt"], 2472);
    assert_eq!(m["left"], 95);

    // Continue watching: latest first.
    let shelves = home_shelves();
    assert_eq!(shelves[0]["id"], "continue");
    let ids: Vec<_> = shelves[0]["items"].as_array().unwrap().iter().map(|s| s["id"].as_str().unwrap()).collect();
    assert_eq!(ids, vec![MATRIX, AOT]);
    // Home's hero is the title watched last; Continue watching goes on from the next one.
    let h = home();
    assert_eq!(h["hero"]["id"], MATRIX);
    assert_eq!(h["shelves"][0]["id"], "continue");
    let ids: Vec<_> = h["shelves"][0]["items"].as_array().unwrap().iter().map(|s| s["id"].as_str().unwrap()).collect();
    assert_eq!(ids, vec![AOT]);

    // Finished S3:E2: the show moves on to S3:E3; a finished film drops out.
    save_progress("tmdb:tv:1429:s3e2", 1400.0, 1440.0);
    save_progress(MATRIX, 8000.0, 8160.0);
    let t = title(AOT);
    assert_eq!(t["resume"], json!({ "season": 3, "episode": 3 }));
    assert_eq!(t["play"]["start"], 0.0);
    let ids: Vec<_> = home_shelves()[0]["items"].as_array().unwrap().iter().map(|s| s["id"].as_str().unwrap().to_owned()).collect();
    assert_eq!(ids, vec![AOT.to_owned()]);

    // Up next near the end of an episode; the season fixture holds 5 episodes.
    assert!(up_next("tmdb:tv:1429:s3e2", 100.0, 1440.0).is_null());
    assert_eq!(up_next("tmdb:tv:1429:s3e2", 1420.0, 1440.0)["number"], 3);
    assert!(up_next("tmdb:tv:1429:s3e5", 1420.0, 1440.0).is_null(), "season 4 is not known yet");
    assert!(up_next(MATRIX, 8150.0, 8160.0).is_null());
}

#[test]
fn play_names_what_it_starts_and_episodes_show_their_progress() {
    let _g = fresh(true, true);
    seed_matrix();
    seed_aot();
    let play = |verb: &str, s: Option<u32>, e: Option<u32>, at: Option<u32>| json!({ "verb": verb, "season": s, "episode": e, "at": at });

    // Nothing watched: a film plays, a show plays its first episode, named.
    assert_eq!(title(MATRIX)["playAs"], play("play", None, None, None));
    assert_eq!(title(AOT)["playAs"], play("play", Some(1), Some(1), None));

    // Stopped in: Resume, where.
    save_progress(MATRIX, 2472.0, 8160.0);
    assert_eq!(title(MATRIX)["playAs"], play("resume", None, None, Some(2472)));
    save_progress("tmdb:tv:1429:s3e2", 870.0, 1440.0);
    assert_eq!(title(AOT)["playAs"], play("resume", Some(3), Some(2), Some(870)));

    // The episode's row: the time left instead of its date, and a bar.
    let eps = episodes(AOT, 3);
    assert_eq!(eps[1]["note"], json!({ "left": 10 }));
    assert!((eps[1]["progress"].as_f64().unwrap() - 870.0 / 1440.0).abs() < 1e-9);
    assert_eq!(eps[2]["note"], json!({ "date": [2018, 8, 6] }), "not started: its date");
    assert_eq!(eps[2]["progress"], 0.0);

    // A minute into it still shows on the thumbnail.
    save_progress("tmdb:tv:1429:s3e3", 15.0, 1440.0);
    assert_eq!(episodes(AOT, 3)[2]["progress"], BAR_MIN);

    // Finished: the next episode plays from its start (not "Resume").
    save_progress("tmdb:tv:1429:s3e3", 1400.0, 1440.0);
    let eps = episodes(AOT, 3);
    assert_eq!(eps[2]["progress"], 1.0);
    assert_eq!(eps[2]["note"], json!({ "date": [2018, 8, 6] }), "watched: its date again");
    assert_eq!(title(AOT)["playAs"], play("play", Some(3), Some(4), None));
}

#[test]
fn a_person_page_lists_their_titles_best_known_first() {
    let _g = fresh(true, false);
    seed_matrix();
    const KEANU: &str = "tmdb:person:6384";
    // The cast names each one's page; it is not known yet.
    assert_eq!(title(MATRIX)["cast"][0]["person"], KEANU);
    let p = person(KEANU);
    assert_eq!(p["state"], "loading");
    assert_eq!(p["items"], json!([]));

    let mapped = tmdb().map_person(&fixture("tmdb_person_6384.json"), &cx()).unwrap();
    seed(Call::Person(KEANU.into()), serde_json::to_value(mapped).unwrap());
    let p = person(KEANU);
    assert_eq!(p["state"], "done");
    assert_eq!(p["name"], "Keanu Reeves");
    assert_eq!(p["initials"], "KR");
    assert!(p["photo"].as_str().unwrap().starts_with("https://image.tmdb.org/t/p/"));
    let ids: Vec<_> = p["items"].as_array().unwrap().iter().map(|s| s["id"].as_str().unwrap()).collect();
    // Each title once, the most voted first; no talk show, no film he only directed.
    assert_eq!(ids, ["tmdb:movie:603", "tmdb:movie:604", "tmdb:tv:94954"]);
    assert_eq!(p["items"][2]["kind"], "show");
    // The part he played in each (the first the source names: Neo, not Thomas A. Anderson).
    let roles: Vec<_> = p["items"].as_array().unwrap().iter().map(|s| s["role"].clone()).collect();
    assert_eq!(roles, [json!("Neo"), json!("Neo"), json!("Tex")]);
    assert_eq!(p["facet"], "role");
}

#[test]
fn a_person_the_source_cannot_find_says_so() {
    let _g = fresh(true, false);
    land(&Call::Person("tmdb:person:1".into()), &json!({ "data": null }), u64::MAX);
    assert_eq!(person("tmdb:person:1")["state"], "unavailable");
}

/// What the engine read of the torrents' files, by link (tests set it).
pub(super) static TORRENT_FILES: LazyLock<Mutex<HashMap<String, Vec<(usize, String, u64)>>>> = LazyLock::new(Default::default);

/// A release of a season that names its episodes ("S03E01-05").
fn episodes_release(title: &str, season: u32, episodes: &[u32], seeders: u64) -> Value {
    let mut r = release(title, Some(1080), "web", 10.0, seeders, episodes.len() != 1);
    r["info"]["season"] = json!(season);
    r["info"]["episodes"] = json!(episodes);
    r
}

#[test]
fn an_episode_plays_from_its_seasons_release() {
    let _g = fresh(true, true);
    seed_aot();
    TORRENT_FILES.lock().unwrap().clear();
    let key = "tmdb:tv:1429:s3e2";
    let season = season_key(AOT, 3);
    assert!(matches!(play_source(key), PlaySource::Searching));
    assert!(SEARCHES.lock().unwrap().contains_key(&season), "playing searches the season");
    found(&season, vec![release("Attack.on.Titan.S03.1080p.WEB", Some(1080), "web", 22.0, 90, true)]);
    match play_source(key) {
        PlaySource::Ready(_, Some((3, 2)), _) => {}
        _ => panic!("the pack plays episode 2"),
    }
    // 22 GB over 22 episodes of 24 min: 6 Mbit/s.
    assert_eq!(tracks(key)["releases"][0]["mbit"], 6);
    assert_eq!(tracks(key)["releases"][0]["pack"], true);
    assert_eq!(episodes(AOT, 3)[1]["quality"], "1080p");
    assert_eq!(episodes(AOT, 3)[1]["inRelease"], "unknown", "a pack named for the whole season");
}

#[test]
fn an_episode_not_in_its_seasons_release_asks_for_another() {
    let _g = fresh(true, true);
    seed_aot();
    TORRENT_FILES.lock().unwrap().clear();
    let season = season_key(AOT, 3);
    // A pack of 1–5 (packs first, though fewer share it), and episode 14 alone.
    found(&season, vec![
        episodes_release("AoT.S03E01-05.1080p", 3, &[1, 2, 3, 4, 5], 60),
        episodes_release("AoT.S03E14.1080p", 3, &[14], 300),
    ]);
    assert!(matches!(play_source("tmdb:tv:1429:s3e2"), PlaySource::Ready(s, Some((3, 2)), _) if s.contains("E01-05")));
    assert!(matches!(play_source("tmdb:tv:1429:s3e13"), PlaySource::NotInRelease));
    // The fixture's season lists episodes 1, 2, 3, 13 and 14.
    let eps = episodes(AOT, 3);
    assert_eq!(eps[1]["inRelease"], "yes");
    assert_eq!(eps[3]["inRelease"], "no");
    assert_eq!(eps[3]["quality"], Value::Null, "no quality for what it is not in");

    // The viewer picks a release for episode 13 alone.
    let thirteen = "tmdb:tv:1429:s3e13";
    let mine = episode_releases(thirteen);
    assert_eq!(mine["releasesState"], "searching");
    assert_eq!(mine["seasonRelease"]["quality"], "1080p");
    found(thirteen, vec![episodes_release("AoT.S03E13.720p", 3, &[13], 40)]);
    assert!(choose_release(thirteen, 0));
    assert!(matches!(play_source(thirteen), PlaySource::Ready(s, ..) if s.contains("E13")));
    assert_eq!(episodes(AOT, 3)[3]["inRelease"], "own");
    assert!(matches!(play_source("tmdb:tv:1429:s3e3"), PlaySource::Ready(s, ..) if s.contains("E01-05")), "the others keep the season's");
}

#[test]
fn a_releases_files_settle_what_its_name_only_suggests() {
    let _g = fresh(true, true);
    seed_aot();
    let season = season_key(AOT, 3);
    let pack = release("Attack.on.Titan.Season.3.1080p", Some(1080), "web", 22.0, 90, true);
    let link = pack["source"].as_str().unwrap().to_owned();
    found(&season, vec![pack]);
    assert_eq!(episodes(AOT, 3)[3]["inRelease"], "unknown");
    let files = (1..=3).map(|e| (e - 1, format!("AoT/Attack.on.Titan.S03E{e:02}.mkv"), 1u64 << 30)).collect();
    TORRENT_FILES.lock().unwrap().insert(link, files);
    let eps = episodes(AOT, 3);
    assert_eq!(eps[2]["inRelease"], "yes");
    assert_eq!(eps[3]["inRelease"], "no", "its files stop at episode 3 (eps[3] is episode 13)");
    assert!(matches!(play_source("tmdb:tv:1429:s3e13"), PlaySource::NotInRelease));
    TORRENT_FILES.lock().unwrap().clear();
}

fn group<'a>(page: &'a Value, id: &str) -> &'a Value {
    page["filters"].as_array().unwrap().iter().find(|g| g["id"] == id).unwrap()
}

fn selected(page: &Value, id: &str) -> Vec<String> {
    list_of(&group(page, id)["options"])
        .iter()
        .filter(|o| o["selected"] == true)
        .map(|o| o["id"].as_str().unwrap().to_owned())
        .collect()
}

fn discover_cards(fixture_name: &str) -> Value {
    json!({ "items": tmdb().map_cards(&fixture(fixture_name), &cx()).unwrap() })
}

#[test]
fn browse_filters_offer_and_mark() {
    let _g = fresh(true, false);
    let genres = tmdb().map_genres(&fixture("tmdb_genre_movie.json")).unwrap();
    let countries = tmdb().map_countries(&fixture("tmdb_countries_pl.json")).unwrap();
    seed(Call::FilterOptions(DiscoverKind::Movie), json!({ "genres": genres, "countries": countries }));
    seed(Call::Discover(DiscoverKind::Movie, Filter::default(), 1), discover_cards("tmdb_trending_movie.json"));
    let page = browse("movies");
    assert_eq!(page["allState"], "done");
    assert!(!page["all"].as_array().unwrap().is_empty());
    let ids: Vec<&str> = list_of(&page["filters"]).iter().map(|g| g["id"].as_str().unwrap()).collect();
    assert_eq!(ids, ["genres", "years", "countries", "sort"]);
    assert_eq!(group(&page, "genres")["multi"], true);
    assert_eq!(group(&page, "sort")["clear"], false);
    assert_eq!(group(&page, "genres")["options"][5], json!({ "id": "18", "name": "Drama", "key": null, "n": null, "selected": false }));
    let years = &group(&page, "years")["options"];
    assert_eq!(years[1], json!({ "id": "2010", "name": null, "key": "decade", "n": 2010, "selected": false }));
    assert_eq!(list_of(years).last().unwrap()["key"], "older");
    // Names in the content language from TMDB, the English ones where it has none.
    let france = list_of(&group(&page, "countries")["options"]).iter().find(|o| o["id"] == "FR").unwrap().clone();
    assert_eq!(france["name"], "Francja");
    let uk = list_of(&group(&page, "countries")["options"]).iter().find(|o| o["id"] == "GB").unwrap().clone();
    assert_eq!(uk["name"], "United Kingdom");
    assert_eq!(selected(&page, "sort"), ["popular"]);
    assert_eq!(group(&page, "sort")["options"][1]["key"], "top_rated");

    assert!(choose_filter("movies", "genres", "18"));
    assert!(choose_filter("movies", "genres", "80"));
    assert!(choose_filter("movies", "years", "2010"));
    assert!(choose_filter("movies", "sort", "top_rated"));
    assert!(!choose_filter("movies", "sort", "top_rated"));
    let page = browse("movies");
    assert_eq!(selected(&page, "genres"), ["80", "18"]);
    assert_eq!(selected(&page, "years"), ["2010"]);
    assert_eq!(selected(&page, "sort"), ["top_rated"]);
    // Other pages keep their own.
    assert!(selected(&browse("shows"), "genres").is_empty());
}

#[test]
fn a_new_filter_keeps_the_last_grid_until_its_answer() {
    let _g = fresh(true, false);
    seed(Call::Discover(DiscoverKind::Movie, Filter::default(), 1), discover_cards("tmdb_trending_movie.json"));
    let before = browse("movies")["all"].clone();
    assert!(!before.as_array().unwrap().is_empty());

    choose_filter("movies", "countries", "FR");
    let page = browse("movies");
    assert_eq!(page["allState"], "loading");
    assert_eq!(page["all"], before, "the last grid while the new one loads");
    assert_eq!(selected(&page, "countries"), ["FR"]);

    let mut fr = Filter::default();
    fr.country = Some("FR".into());
    seed(Call::Discover(DiscoverKind::Movie, fr.clone(), 1), json!({ "items": [] }));
    let page = browse("movies");
    assert_eq!(page["allState"], "empty");
    assert!(page["all"].as_array().unwrap().is_empty());

    seed(Call::Discover(DiscoverKind::Movie, fr, 1), discover_cards("tmdb_discover_tv.json"));
    let page = browse("movies");
    assert_eq!(page["allState"], "done");
    assert_ne!(page["all"], before);

    // Clearing goes back to the first grid, known already.
    assert!(choose_filter("movies", "countries", ""));
    assert_eq!(browse("movies")["all"], before);
}

#[test]
fn anime_filters_are_anilists() {
    let _g = fresh(false, false);
    // Shows without TMDB browse anime, with the Anime page's filters.
    choose_filter("anime", "genres", "Mecha");
    let page = browse("shows");
    assert_eq!(selected(&page, "genres"), Vec::<String>::new(), "the genre names are not in yet");
    seed(
        Call::FilterOptions(DiscoverKind::Anime),
        json!({ "genres": [["Mecha", "Mecha"], ["Drama", "Drama"]], "countries": [] }),
    );
    let page = browse("shows");
    assert_eq!(selected(&page, "genres"), ["Mecha"]);
    // Anime is filtered by its format, not its country.
    let ids: Vec<&str> = list_of(&page["filters"]).iter().map(|g| g["id"].as_str().unwrap()).collect();
    assert_eq!(ids, ["genres", "years", "format", "sort"]);
    let formats: Vec<&str> =
        list_of(&group(&page, "format")["options"]).iter().map(|o| o["key"].as_str().unwrap()).collect();
    assert_eq!(formats, ["format_tv", "format_movie", "format_special"]);
    assert!(choose_filter("anime", "format", "movie"));
    assert_eq!(selected(&browse("anime"), "format"), ["movie"]);
    assert_eq!(browse("anime")["filtered"], true);
    // Clear: the filters go, the order stays.
    assert!(choose_filter("anime", "sort", "newest"));
    assert!(choose_filter("anime", "all", ""));
    let page = browse("anime");
    assert_eq!(page["filtered"], false);
    assert!(selected(&page, "genres").is_empty());
    assert_eq!(selected(&page, "sort"), ["newest"]);
    // Movies has nothing to filter without TMDB.
    assert_eq!(browse("movies")["filters"], json!([]));
    assert!(!choose_filter("movies", "genres", "18"));
}

// ---- The browse grid page by page (stand-in pages made of fixture cards).

fn fixture_cards(fixture_name: &str) -> Vec<Value> {
    list_of(&discover_cards(fixture_name)["items"]).to_vec()
}

/// A discover answer: `cards`, and whether the source has a page after it.
fn discover_page(cards: &[Value], more: bool) -> Value {
    json!({ "items": cards, "more": more })
}

fn movies_page(n: u32) -> Call {
    Call::Discover(DiscoverKind::Movie, Filter::default(), n)
}

fn grid_ids(page: &Value) -> Vec<String> {
    list_of(&page["all"]).iter().map(|s| s["id"].as_str().unwrap().to_owned()).collect()
}

fn card_ids(cards: &[Value]) -> Vec<String> {
    let mut seen = HashSet::new();
    cards.iter().map(|c| c["id"].as_str().unwrap().to_owned()).filter(|id| seen.insert(id.clone())).collect()
}

#[test]
fn the_grid_grows_page_by_page_without_repeats_until_the_end() {
    let _g = fresh(true, false);
    let films = fixture_cards("tmdb_trending_movie.json");
    let shows = fixture_cards("tmdb_discover_tv.json");
    let (a, b) = films.split_at(films.len() / 2);
    seed(movies_page(1), discover_page(a, true));
    let page = browse("movies");
    assert_eq!(grid_ids(&page), card_ids(a));
    assert_eq!((page["more"].clone(), page["moreState"].clone()), (json!(true), json!("idle")));

    assert!(browse_more("movies"), "page 2 is asked for");
    let page = browse("movies");
    assert_eq!(page["moreState"], "loading");
    assert_eq!(grid_ids(&page), card_ids(a), "the grid stays while it comes");
    assert!(!browse_more("movies"), "one page at a time");

    // Page 2 repeats the last card of page 1 (the list moved between the asks).
    let mut second = vec![a.last().unwrap().clone()];
    second.extend_from_slice(b);
    seed(movies_page(2), discover_page(&second, true));
    let page = browse("movies");
    assert_eq!(grid_ids(&page), card_ids(&films), "page 1's cards first, each title once");
    assert_eq!((page["more"].clone(), page["moreState"].clone()), (json!(true), json!("idle")));

    // The source's last page.
    assert!(browse_more("movies"));
    seed(movies_page(3), discover_page(&shows, false));
    let page = browse("movies");
    let all: Vec<Value> = films.iter().chain(&shows).cloned().collect();
    assert_eq!(grid_ids(&page), card_ids(&all));
    assert_eq!(page["more"], false);
    assert!(!browse_more("movies"), "nothing after the last page");
}

#[test]
fn a_page_that_fails_keeps_the_grid_and_is_asked_again() {
    let _g = fresh(true, false);
    let films = fixture_cards("tmdb_trending_movie.json");
    seed(movies_page(1), discover_page(&films, true));
    assert!(browse_more("movies"));
    let before = browse("movies")["all"].clone();
    land(&movies_page(2), &json!({ "data": null, "error": { "kind": "network" } }), u64::MAX);
    let page = browse("movies");
    assert_eq!(page["all"], before, "what shows stays");
    assert_eq!((page["more"].clone(), page["moreState"].clone()), (json!(true), json!("failed")));
    assert!(!browse_more("movies"), "not again at once");

    // A while later asking again asks for the same page.
    SLOTS.0.lock().unwrap().get_mut(&movies_page(2).key()).unwrap().failed_at =
        Some(Instant::now() - Duration::from_secs(10));
    assert!(browse_more("movies"));
    assert_eq!(browse("movies")["moreState"], "loading");
    seed(movies_page(2), discover_page(&fixture_cards("tmdb_discover_tv.json"), false));
    let page = browse("movies");
    assert_eq!(page["moreState"], "idle");
    assert!(list_of(&page["all"]).len() > list_of(&before).len());
}

#[test]
fn a_new_filter_or_sort_starts_from_page_one() {
    let _g = fresh(true, false);
    let films = fixture_cards("tmdb_trending_movie.json");
    let shows = fixture_cards("tmdb_discover_tv.json");
    let (a, b) = films.split_at(films.len() / 2);
    seed(movies_page(1), discover_page(a, true));
    assert!(browse_more("movies"));
    seed(movies_page(2), discover_page(b, true));
    let two_pages = browse("movies")["all"].clone();
    assert_eq!(grid_ids(&browse("movies")), card_ids(&films));

    assert!(choose_filter("movies", "sort", "top_rated"));
    let page = browse("movies");
    assert_eq!(page["allState"], "loading");
    assert_eq!(page["all"], two_pages, "the last grid, all of it, until the new one lands");
    assert_eq!(page["more"], false);
    assert!(!browse_more("movies"), "nothing to page before the new grid's first page");

    let top = Filter { sort: Sort::TopRated, ..Filter::default() };
    seed(Call::Discover(DiscoverKind::Movie, top.clone(), 1), discover_page(&shows, true));
    let page = browse("movies");
    assert_eq!(grid_ids(&page), card_ids(&shows), "page 1 only");
    assert!(browse_more("movies"));
    assert!(SLOTS.0.lock().unwrap().get(&Call::Discover(DiscoverKind::Movie, top, 2).key()).is_some_and(|s| s.loading));

    // Back to the first order: it starts again from its page 1 too.
    assert!(choose_filter("movies", "sort", "popular"));
    assert_eq!(grid_ids(&browse("movies")), card_ids(a));
}

/// Pages 1 and 2 of the Movies grid from TMDB (with the build's key):
/// `REEL_TMDB_TOKEN=… cargo test -- --ignored live_browse_pages --nocapture`.
#[test]
#[ignore]
fn live_browse_pages() {
    let _g = fresh(crate::adapters::metadata::tmdb::build_key().is_some(), false);
    let rt = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
    for n in [1, 2] {
        let text = rt.block_on(crate::adapters::metadata::discover(DiscoverKind::Movie, Filter::default(), "en".into(), n));
        let envelope: Value = serde_json::from_str(&text).unwrap();
        println!("page {n}: {} items, more {}", list_of(&envelope["data"]["items"]).len(), envelope["data"]["more"]);
        land(&movies_page(n), &envelope, u64::MAX);
        if n == 1 {
            assert!(browse_more("movies"));
        }
    }
    let page = browse("movies");
    assert!(list_of(&page["all"]).len() > 20, "two pages");
}

#[test]
fn list() {
    let _g = fresh(true, false);
    assert!(!in_list(MATRIX));
    assert!(toggle_list(MATRIX));
    assert!(!toggle_list(MATRIX));
}

/// `Meta.search` answered `query`: TMDB's search fixture and AniList's trending as its anime.
fn seed_search(query: &str) {
    let tmdb_cards = tmdb().map_cards(&fixture("tmdb_search_multi.json"), &cx()).unwrap();
    let anime = crate::adapters::metadata::anilist::Anilist.map_cards(&fixture("anilist_trending.json"), &cx()).unwrap();
    // AniList lists one TMDB already found: it shows once.
    let mut anilist = vec![serde_json::to_value(&tmdb_cards[0]).unwrap()];
    anilist.extend(anime.iter().map(|c| serde_json::to_value(c).unwrap()));
    let data = json!({ "sections": [
        { "source": "tmdb", "items": tmdb_cards },
        { "source": "anilist", "items": anilist },
    ] });
    search::land(&search::answer_key(query, &settings::content_language()), &json!({ "data": data }));
}

fn row_ids(found: &Value, row: &str) -> Vec<String> {
    let section = found["sections"].as_array().unwrap().iter().find(|s| s["id"] == row);
    section.map_or(vec![], |s| s["items"].as_array().unwrap().iter().map(|i| i["id"].as_str().unwrap().to_owned()).collect())
}

#[test]
fn search_groups_and_dedupes_the_answer() {
    let _g = fresh(true, false);
    let first = search::search("  Matrix ");
    assert_eq!(first["state"], "searching");
    assert_eq!(first["query"], "Matrix");
    assert_eq!(first["sections"], json!([]));
    assert_eq!(search::wanted(), search::answer_key("matrix", &settings::content_language()));
    seed_search("matrix");
    let found = search::search("Matrix");
    assert_eq!(found["state"], "done");
    assert_eq!(found["tmdb"], true);
    let ids: Vec<_> = found["sections"].as_array().unwrap().iter().map(|s| s["id"].as_str().unwrap()).collect();
    assert_eq!(ids[0], "movies");
    assert!(ids.contains(&"anime"));
    let movies = row_ids(&found, "movies");
    assert_eq!(&movies[..2], ["tmdb:movie:603", "tmdb:movie:604"]);
    // Matrix came from AniList too: listed once, with the films.
    let all: Vec<String> = ["movies", "shows", "anime"].iter().flat_map(|r| row_ids(&found, r)).collect();
    assert_eq!(all.iter().filter(|i| *i == "tmdb:movie:603").count(), 1);
    assert!(row_ids(&found, "anime").iter().all(|i| i.starts_with("anilist:")));
    // A card is the shelves' summary.
    let card = &found["sections"][0]["items"][0];
    assert_eq!(card["title"], "Matrix");
    assert_eq!(card["kind"], "movie");
    assert!(card["card"].as_str().unwrap().starts_with("https://image.tmdb.org/t/p/w780/"));
    assert_eq!(card["play"]["id"], "tmdb:movie:603");
}

#[test]
fn search_keeps_the_last_results_while_the_next_query_comes() {
    let _g = fresh(true, false);
    seed_search("matrix");
    assert_eq!(search::search("matrix")["state"], "done");
    // Typing on: the older rows stay while it searches.
    let typing = search::search("matrix r");
    assert_eq!(typing["state"], "searching");
    assert_eq!(row_ids(&typing, "movies")[0], "tmdb:movie:603");
    // An answer for a query no longer wanted is kept, not shown.
    seed_search("matri");
    assert_eq!(search::search("matrix r")["state"], "searching");
    assert_eq!(search::search("MATRI")["state"], "done", "known already, whatever the case");
    // Nothing found.
    search::land(&search::answer_key("zzz", &settings::content_language()), &json!({ "data": { "sections": [] } }));
    let none = search::search("zzz");
    assert_eq!(none["state"], "done");
    assert_eq!(none["sections"], json!([]));
    // The sources did not answer; typed again, it is asked again.
    search::search("offline");
    search::land(&search::answer_key("offline", &settings::content_language()), &json!({ "data": null, "error": { "kind": "network" } }));
    assert_eq!(search::search("offline")["state"], "failed");
    search::search("other");
    assert_eq!(search::search("offline")["state"], "searching");
}

/// TMDB's films did not answer, its series and AniList did.
fn land_without_films(query: &str) {
    let shows = tmdb().map_cards(&fixture("tmdb_discover_tv.json"), &cx()).unwrap();
    let data = json!({ "sections": [
        { "source": "tmdb", "items": shows },
        { "source": "anilist", "items": [] },
    ], "failed": ["tmdbMovies"] });
    search::land(&search::answer_key(query, &settings::content_language()), &json!({ "data": data }));
}

#[test]
fn a_row_whose_source_did_not_answer_says_so_and_is_asked_again() {
    let _g = fresh(true, false);
    search::search("night");
    land_without_films("night");
    let found = search::search("night");
    assert_eq!(found["state"], "done");
    let rows: Vec<_> = found["sections"].as_array().unwrap().iter().map(|s| (s["id"].as_str().unwrap(), s["state"].as_str().unwrap())).collect();
    // Movies did not load: it stays, as failed; Anime found nothing: left out.
    assert_eq!(rows, [("movies", "failed"), ("shows", "done")]);
    assert_eq!(found["sections"][0]["items"], json!([]));
    // Try again: asked again, the rows stay while it searches.
    search::retry("night");
    let again = search::search("night");
    assert_eq!(again["state"], "searching");
    assert_eq!(again["sections"][1]["id"], "shows");
    seed_search("night");
    let ok = search::search("night");
    assert_eq!(ok["state"], "done");
    assert!(ok["sections"].as_array().unwrap().iter().all(|s| s["state"] == "done"));
    // A partial answer is asked again when the query comes back (typed or from the history).
    land_without_films("day");
    search::search("other");
    assert_eq!(search::search("day")["state"], "searching");
    // A row with something in it shows it, whatever failed.
    let mut data = json!({ "sections": [
        { "source": "tmdb", "items": tmdb().map_cards(&fixture("tmdb_search_multi.json"), &cx()).unwrap() },
    ], "failed": ["anilist"] });
    search::search("mixed");
    search::land(&search::answer_key("mixed", &settings::content_language()), &json!({ "data": data.take() }));
    let mixed = search::search("mixed");
    let ids: Vec<_> = mixed["sections"].as_array().unwrap().iter().map(|s| (s["id"].as_str().unwrap(), s["state"].as_str().unwrap())).collect();
    assert_eq!(ids, [("movies", "done"), ("anime", "failed")]);
}

#[test]
fn search_without_tmdb_says_so() {
    let _g = fresh(false, false);
    search::search("frieren");
    seed_search("frieren");
    assert_eq!(search::search("frieren")["tmdb"], false);
}

#[test]
fn an_empty_query_lists_the_recent_searches_kept_in_the_data_dir() {
    let _g = fresh(true, false);
    let dir = std::env::temp_dir().join(format!("reel-search-test-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    *DATA_DIR.lock().unwrap() = Some(dir.clone());
    let empty = search::search("   ");
    assert_eq!(empty["state"], "recent");
    assert_eq!(empty["recent"], json!([]));
    assert_eq!(empty["sections"], json!([]), "nothing trending came yet");
    // Before anything was searched: what is trending, to start from.
    seed_trending("movie", "tmdb_trending_movie.json");
    seed_trending("tv", "tmdb_discover_tv.json");
    let start = search::search("");
    assert_eq!(start["sections"][0]["id"], "trending");
    assert_eq!(start["sections"][0]["facet"], "kind");
    let kinds: Vec<_> = list_of(&start["sections"][0]["items"]).iter().take(2).map(|s| s["kind"].clone()).collect();
    assert_eq!(kinds, [json!("movie"), json!("show")], "films and series in turn");
    for q in ["dune", "Arrival", "  frieren  ", "DUNE"] {
        search::remember(q);
    }
    search::remember(" ");
    assert_eq!(search::search("")["recent"], json!(["DUNE", "frieren", "Arrival"]));
    assert_eq!(search::search("")["sections"], json!([]), "the recent searches instead");
    for i in 0..15 {
        search::remember(&format!("q{i}"));
    }
    assert_eq!(search::recent().len(), search::RECENT_MAX);
    assert_eq!(search::recent()[0], "q14");
    // Read back from the file.
    search::reset();
    assert_eq!(search::recent()[0], "q14");
    assert!(dir.join("recent_searches.json").exists());
    // Clear: gone from the list and from the file.
    search::forget();
    assert_eq!(search::search("")["recent"], json!([]));
    assert!(!dir.join("recent_searches.json").exists());
    search::reset();
    assert!(search::recent().is_empty());
    *DATA_DIR.lock().unwrap() = None;
    let _ = std::fs::remove_dir_all(&dir);
}

/// Home from the real sources (TMDB with the build's key, AniList):
/// `REEL_TMDB_TOKEN=… cargo test -- --ignored live_home --nocapture`.
#[test]
#[ignore]
fn live_home() {
    let _g = fresh(crate::adapters::metadata::tmdb::build_key().is_some(), false);
    *TEST_TMDB.lock().unwrap() = None;
    let rt = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
    for kind in ["movie", "tv", "movie-popular", "tv-popular", "anime"] {
        let text = rt.block_on(crate::adapters::metadata::trending(kind.into(), "en".into()));
        land(&Call::Trending(kind), &serde_json::from_str(&text).unwrap(), u64::MAX);
    }
    let shelves = home_shelves();
    for s in shelves.as_array().unwrap() {
        let items = s["items"].as_array().unwrap();
        let first = &items[0];
        println!("{}: {} items; first {} {:?} still {}", s["id"], items.len(), first["id"], first["title"], first["still"]);
    }
    assert!(shelves.as_array().unwrap().iter().any(|s| s["id"] == "trending_movies" || s["id"] == "no_tmdb"));
}

#[test]
fn changed_answers_the_moment_the_revision_moves() {
    let _g = fresh(true, false);
    let rt = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
    bump();
    let now = revision();
    assert!(rt.block_on(changed(now - 1)) >= now, "already past: at once");
    let started = std::time::Instant::now();
    let waiter = std::thread::spawn(move || {
        let rt = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
        rt.block_on(changed(now))
    });
    std::thread::sleep(Duration::from_millis(100));
    bump();
    assert!(waiter.join().unwrap() > now);
    assert!(started.elapsed() < Duration::from_secs(5), "woken by the change, not the timeout");
}

#[test]
fn a_well_shared_4k_is_the_default_and_a_remux_is_not() {
    // A 170 min film: 4K WEB-DL 25 GB (~20 Mbit/s), 4K remux 80 GB (~63 Mbit/s), 1080p 8 GB.
    let r = |res: u64, gb: f64, seeders: u64| json!({ "info": { "resolution": res }, "size": gb * 1e9, "seeders": seeders });
    let releases = [r(2160, 80.0, 900), r(2160, 25.0, 2231), r(1080, 8.0, 5000)];
    assert_eq!(chosen("film:test-4k-default", &releases, 170, 1), Some(1), "the 4K WEB-DL");
    let few = [r(2160, 25.0, 20), r(1080, 8.0, 5000)];
    assert_eq!(chosen("film:test-4k-few", &few, 170, 1), Some(1), "a 4K with few people sharing waits: 1080p");
}

#[test]
fn a_new_source_drops_what_the_old_one_found() {
    let _g = fresh(true, true);
    found("tmdb:movie:603", vec![release("The.Matrix.1999.1080p", Some(1080), "BluRay", 8.0, 100, false)]);
    let rev = revision();
    source_changed();
    assert!(search_of("tmdb:movie:603").is_none(), "searched again on the new source");
    assert!(revision() > rev, "the screens read again");
}

#[test]
fn a_phone_plays_the_best_picture_up_to_1080p_when_one_plays_now() {
    let r = |res: u64, gb: f64, peers: u64| serde_json::json!({ "info": { "resolution": res }, "size": gb * 1e9, "seeders": peers, "peers": peers, "seasonPack": false });
    let phone = fit::limits(Some("phone"));
    let any = fit::Limits::NONE;
    let all = |_: &Value| true;
    let releases = vec![r(2160, 20.0, 161), r(1080, 8.0, 468)];
    assert_eq!(picked_within(phone, "film", &releases, 136, 1, all), Some(1), "a phone: 1080p");
    assert_eq!(picked_within(any, "film", &releases, 136, 1, all), Some(0), "a TV: the 4K, which plays now too");
    // Nothing within the limits that people share: the best that plays now.
    let only_4k = vec![r(2160, 20.0, 300), r(1080, 8.0, 3)];
    assert_eq!(picked_within(phone, "film", &only_4k, 136, 1, all), Some(0));
}

#[test]
fn a_phone_skips_a_remux_for_a_release_of_a_sane_size() {
    let r = |res: u64, gb: f64, peers: u64| serde_json::json!({ "info": { "resolution": res }, "size": gb * 1e9, "seeders": peers, "peers": peers, "seasonPack": false });
    let phone = fit::limits(Some("phone"));
    let all = |_: &Value| true;
    // Night of the Living Dead, 96 minutes: a 25 GB 1080p remux plays now, a 2.5 GB 1080p WEB-DL too.
    let releases = vec![r(1080, 25.0, 400), r(1080, 2.5, 120), r(720, 0.7, 300)];
    assert_eq!(picked_within(phone, "film", &releases, 96, 1, all), Some(1));
    assert_eq!(picked_within(fit::Limits::NONE, "film", &releases, 96, 1, all), Some(0), "a desktop: the most shared 1080p");
    // The small ones are slow (under 50 people): still the best within the limits shared by 10 or more.
    let slow = vec![r(1080, 25.0, 400), r(1080, 2.5, 30), r(720, 0.7, 40)];
    assert_eq!(picked_within(phone, "film", &slow, 96, 1, all), Some(1), "1080p before 720p");
    // No runtime from the catalog: a film's usual two hours still keeps the remux out.
    assert_eq!(picked_within(phone, "film", &releases, 0, 1, all), Some(1));
    // A season pack's share per episode: 40 GB over 8 episodes of an hour is 5 GB an hour.
    let pack = |gb: f64, peers: u64| serde_json::json!({ "info": { "resolution": 1080 }, "size": gb * 1e9, "seeders": peers, "peers": peers, "seasonPack": true });
    let season = "tmdb:tv:1:s1";
    assert_eq!(picked_within(phone, season, &[pack(120.0, 300), pack(40.0, 200)], 60, 8, all), Some(1));
    // Its episode count not known: judged by its picture alone (not every pack kept out).
    assert_eq!(picked_within(phone, season, &[pack(120.0, 300), pack(40.0, 200)], 60, 1, all), Some(0));
}

#[test]
fn without_limits_the_pick_is_as_before() {
    // The old rule: the best that plays now (quality, people, first), else the most shared.
    let old = |rs: &[Value], minutes: u32| {
        let now = rs.iter().enumerate().filter(|(_, r)| plays_now(peers(r), mbit(r, minutes, 1)));
        now.max_by_key(|(i, r)| (quality_rank(r), peers(r), std::cmp::Reverse(*i)))
            .or_else(|| rs.iter().enumerate().max_by_key(|(i, r)| (peers(r), std::cmp::Reverse(*i))))
            .map(|(i, _)| i)
    };
    let mut seed = 7u64;
    let mut next = |n: u64| {
        seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        (seed >> 33) % n
    };
    for _ in 0..500 {
        let rs: Vec<Value> = (0..1 + next(6))
            .map(|_| {
                let res = [480, 720, 1080, 2160][next(4) as usize];
                let peers = [0, 3, 12, 49, 50, 80, 400][next(7) as usize];
                serde_json::json!({ "info": { "resolution": res }, "size": (1 + next(60)) as f64 * 1e9, "seeders": peers, "peers": peers, "seasonPack": false })
            })
            .collect();
        let minutes = [0, 90, 136][next(3) as usize];
        assert_eq!(picked_within(fit::Limits::NONE, "film", &rs, minutes, 1, |_| true), old(&rs, minutes), "{rs:?}");
    }
}

#[test]
fn save_offers_the_smaller_release_play_would_pick_among_those_that_fit() {
    let _g = fresh(true, true);
    seed(Call::Title(MATRIX.into()), json!({ "id": MATRIX, "kind": "movie", "title": "The Matrix", "runtimeMinutes": 136, "release": { "year": 1999 } }));
    let gib = 1024.0 * 1024.0 * 1024.0;
    found(MATRIX, vec![release("Matrix.1080p.Remux", Some(1080), "remux", 25.0, 400, false), release("Matrix.720p.WEB", Some(720), "web", 1.4, 200, false), release("Matrix.480p", Some(480), "dvd", 0.7, 300, false)]);
    assert_eq!(save_size(MATRIX, None), Some((25.0 * gib) as u64), "a desktop saves Play's release");
    let smaller = smaller_release(MATRIX, |b| b < (19.0 * gib) as u64).unwrap();
    assert_eq!(smaller["id"], "Matrix.720p.WEB");
    assert_eq!(smaller["quality"], "720p");
    assert_eq!(save_size(MATRIX, Some("Matrix.720p.WEB")), Some((1.4 * gib) as u64));
    assert!(smaller_release(MATRIX, |_| false).is_none(), "none fits");
    let SaveAsk::Ready(req) = save_request(MATRIX, Some("Matrix.720p.WEB")) else { panic!("ready") };
    assert_eq!(req.source, "magnet:?xt=urn:btih:Matrix.720p.WEB");
    assert!(CHOSEN.lock().unwrap().is_empty(), "Play's release stays");
}

#[test]
fn an_episode_dated_after_today_is_upcoming() {
    assert_eq!(civil(0), [1970, 1, 1]);
    assert_eq!(civil(20_409), [2025, 11, 17]);
    assert!(upcoming(Some([2026, 11, 20]), [2026, 11, 17]));
    assert!(!upcoming(Some([2026, 11, 17]), [2026, 11, 17]), "today's has aired");
    assert!(!upcoming(None, [2026, 11, 17]));
}

#[test]
fn a_search_from_before_the_source_changed_does_not_land() {
    let _g = fresh(true, true);
    let before = SEARCH_GEN.load(Ordering::Relaxed);
    source_changed();
    record_search("film", before, Search { releases: None, failed: Some("the old source died".into()), ended: None });
    assert!(SEARCHES.lock().unwrap().get("film").is_none(), "the old source's failure is dropped");
    record_search("film", SEARCH_GEN.load(Ordering::Relaxed), Search { releases: Some(vec![]), failed: None, ended: None });
    assert!(SEARCHES.lock().unwrap().get("film").is_some(), "the new one's lands");
}


#[test]
fn releases_are_searched_by_the_title_then_its_english_romaji_and_original_names() {
    use super::{Info, search_titles};
    // Polish UI, an anime: the Polish title, then the English and romaji ones (at most three).
    let frieren = Info {
        title: "Frieren: U kresu drogi".into(),
        english_title: Some("Frieren: Beyond Journey's End".into()),
        romaji: Some("Sousou no Frieren".into()),
        original_title: Some("葬送のフリーレン".into()),
        ..Default::default()
    };
    assert_eq!(
        search_titles(&frieren),
        ("Frieren: U kresu drogi".to_string(), vec!["Frieren: Beyond Journey's End".to_string(), "Sousou no Frieren".to_string()])
    );
    // English UI: the English title is the title, not searched twice; then the original.
    let en = Info { title: "Spirited Away".into(), english_title: Some("Spirited Away".into()), original_title: Some("千と千尋の神隠し".into()), ..Default::default() };
    assert_eq!(search_titles(&en), ("Spirited Away".to_string(), vec!["千と千尋の神隠し".to_string()]));
    // A short one-word name would match other titles' releases: not searched by.
    let up = Info { title: "Вверх".into(), english_title: Some("Up".into()), original_title: Some("Up".into()), ..Default::default() };
    assert_eq!(search_titles(&up), ("Вверх".to_string(), vec![]));
}


#[test]
fn a_failed_search_is_asked_again_a_while_after() {
    use super::{RETRY_FAILED_AFTER, Search, search_wanted};
    use std::time::{Duration, Instant};
    let now = Instant::now();
    let failed = |ago: Duration| Search { failed: Some("HTTP 429".into()), ended: now.checked_sub(ago), ..Default::default() };
    assert!(search_wanted(None, now), "never asked");
    assert!(!search_wanted(Some(&Search::default()), now), "still running");
    assert!(!search_wanted(Some(&Search { releases: Some(vec![]), ended: Some(now), ..Default::default() }), now), "found nothing: stays");
    assert!(!search_wanted(Some(&failed(Duration::from_secs(5))), now), "failed just now: not again at once");
    assert!(search_wanted(Some(&failed(RETRY_FAILED_AFTER)), now), "failed a while ago: again");
}

#[test]
fn a_whole_show_labelled_season_one_plays_any_season() {
    let _g = fresh(true, true);
    seed_aot();
    TORRENT_FILES.lock().unwrap().clear();
    // TMDB's AoT: seasons of 25, 12, 22 and 28, 87 episodes; S3E2 is the show's 39.
    let title = "Атака титанов / Attack on Titan / S1E1-87 of 87 [2013-2023]";
    let mut r = episodes_release(title, 1, &(1..=87).collect::<Vec<_>>(), 90);
    r["size"] = json!(87.0 * 1024.0 * 1024.0 * 1024.0);
    found(&season_key(AOT, 3), vec![r]);
    match play_source("tmdb:tv:1429:s3e2") {
        PlaySource::Ready(_, Some((3, 2)), Some(t)) => assert_eq!((t.start, t.size), (38, 22)),
        _ => panic!("the whole show's pack plays season 3"),
    }
    assert_eq!(episodes(AOT, 3)[1]["inRelease"], "yes", "its name says it holds the show's 39");
    // Its size is shared out over its own 87 episodes, not season 3's 22.
    assert_eq!(tracks("tmdb:tv:1429:s3e2")["releases"][0]["mbit"], 6);
    // Once its files are known, they decide: numbered through, 039 is S3E2.
    let files = (1..=87).map(|n| (n as usize - 1, format!("[Group] Shingeki no Kyojin - {n:03} [1080p].mkv"), 1)).collect();
    TORRENT_FILES.lock().unwrap().insert(format!("magnet:?xt=urn:btih:{title}"), files);
    assert_eq!(episodes(AOT, 3)[1]["inRelease"], "yes");
    assert!(matches!(play_source("tmdb:tv:1429:s3e2"), PlaySource::Ready(..)));
}

/// A release row's second line: the audio its name says, then the picture, then the size; the
/// spoken label says it all with the people sharing and how it starts.
#[test]
fn a_release_row_says_its_audio_picture_and_size() {
    let name = "Ночь живых мертвецов / Night of the Living Dead [1968, США, ужасы, BDRip 2160p] MVO + Original Eng + Sub (Rus, Eng) HDR10 DV HEVC";
    let info = reel_domain::release::parse(name);
    let r = json!({ "title": name, "size": 700.0 * 1024.0 * 1024.0, "seasonPack": false, "info": info });
    let (line, spoken) = release_parts(&r, 3, 2);
    assert_eq!(
        json!(line),
        json!([
            { "audio": [{ "language": "ru", "voice": "mvo" }, { "language": "en", "voice": null }] },
            { "text": "H.265 · DV · HDR" },
            { "text": "700 MB" },
        ])
    );
    assert_eq!(spoken[0], json!({ "text": "4K BluRay" }));
    assert_eq!(spoken[1..4], line[..]);
    assert_eq!(spoken[4], json!({ "key": "release.sharing", "count": 3 }));
    assert_eq!(spoken[5], json!({ "key": "release.note.few_sharing", "mbit": 2 }));
    // The row's first line leaves HDR to the second; the player's list keeps it.
    assert_eq!(source_name(&r), "BluRay");
    assert_eq!(source_label(&r), "BluRay DV");

    // A season pack's size is the pack's; a name that says nothing gives the size alone.
    let pack = json!({ "title": "Show S01", "size": 4.0 * 1024.0 * 1024.0 * 1024.0, "seasonPack": true, "info": reel_domain::release::parse("Show S01") });
    assert_eq!(json!(release_parts(&pack, 50, 1).0), json!([{ "key": "release.pack", "size": "4 GB" }]));
}

#[test]
fn the_picture_line() {
    let v = |name: &str| video_label(&json!({ "info": reel_domain::release::parse(name) }));
    assert_eq!(v("Film.2010.1080p.BluRay.x264"), "H.264");
    assert_eq!(v("Film 2160p WEB-DL DV H265"), "H.265 · DV");
    assert_eq!(v("Film 2160p WEB HDR10 AV1"), "AV1 · HDR");
    assert_eq!(v("Film DVDRip"), "");
}
