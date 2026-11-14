//! The catalog on recorded `Meta` answers (the metadata layer's fixtures,
//! mapped by its own code): no network.

use super::*;
use crate::metadata::{
    provider::{MapCx, TitleSource},
    tmdb::{ImageConfig, Tmdb},
};

fn fixture(name: &str) -> Value {
    let path = format!("{}/src/metadata/fixtures/{name}", env!("CARGO_MANIFEST_DIR"));
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
    SEARCHES.lock().unwrap().insert(key.into(), Search { releases: Some(releases), failed: None });
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
    LIST.lock().unwrap().clear();
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
    let shelves = home();
    let ids: Vec<_> = shelves.as_array().unwrap().iter().map(|s| s["id"].as_str().unwrap()).collect();
    // Empty shelves (Continue watching, nothing popular, no anime) are left out.
    assert_eq!(ids, vec!["trending_movies", "trending_shows"]);
    let first = &shelves[0]["items"][0];
    assert_eq!(first["id"], "tmdb:movie:1368337");
    assert_eq!(first["kind"], "movie");
    assert_eq!(first["title"], "Odyseja");
    assert!(first["still"].as_str().unwrap().starts_with("https://image.tmdb.org/t/p/w1280/"));
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
    let shelves = home();
    assert_eq!(shelves, json!([{ "id": "offline", "items": [notice("offline")] }]));
    assert_eq!(shelves[0]["items"][0]["notice"], "offline");
}

#[test]
fn without_tmdb_anime_and_a_notice() {
    let _g = fresh(false, false);
    let anime = crate::metadata::anilist::Anilist.map_cards(&fixture("anilist_trending.json"), &cx()).unwrap();
    seed(Call::Trending("anime"), json!({ "items": anime }));
    let shelves = home();
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
    assert_eq!(r[3]["bars"], 1);
    assert_eq!(t["release"]["quality"], "1080p");
    assert_eq!(t["release"]["size"], "8 GB");
    match play_source(MATRIX) {
        PlaySource::Ready(s, None) => assert_eq!(s, "magnet:?xt=urn:btih:The.Matrix.1999.1080p.BluRay.x264"),
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
    assert_eq!(eps[1]["left"], 14);
    assert_eq!(eps[1]["start"], 600.0);

    let m = title(MATRIX);
    assert_eq!(m["stoppedAt"], 2472);
    assert_eq!(m["left"], 95);

    // Continue watching: latest first.
    let shelves = home();
    assert_eq!(shelves[0]["id"], "continue");
    let ids: Vec<_> = shelves[0]["items"].as_array().unwrap().iter().map(|s| s["id"].as_str().unwrap()).collect();
    assert_eq!(ids, vec![MATRIX, AOT]);

    // Finished S3:E2: the show moves on to S3:E3; a finished film drops out.
    save_progress("tmdb:tv:1429:s3e2", 1400.0, 1440.0);
    save_progress(MATRIX, 8000.0, 8160.0);
    let t = title(AOT);
    assert_eq!(t["resume"], json!({ "season": 3, "episode": 3 }));
    assert_eq!(t["play"]["start"], 0.0);
    let ids: Vec<_> = home()[0]["items"].as_array().unwrap().iter().map(|s| s["id"].as_str().unwrap().to_owned()).collect();
    assert_eq!(ids, vec![AOT.to_owned()]);

    // Up next near the end of an episode; the season fixture holds 5 episodes.
    assert!(up_next("tmdb:tv:1429:s3e2", 100.0, 1440.0).is_null());
    assert_eq!(up_next("tmdb:tv:1429:s3e2", 1420.0, 1440.0)["number"], 3);
    assert!(up_next("tmdb:tv:1429:s3e5", 1420.0, 1440.0).is_null(), "season 4 is not known yet");
    assert!(up_next(MATRIX, 8150.0, 8160.0).is_null());
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
        PlaySource::Ready(_, Some((3, 2))) => {}
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
    assert!(matches!(play_source("tmdb:tv:1429:s3e2"), PlaySource::Ready(s, Some((3, 2))) if s.contains("E01-05")));
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
    assert!(matches!(play_source(thirteen), PlaySource::Ready(s, _) if s.contains("E13")));
    assert_eq!(episodes(AOT, 3)[3]["inRelease"], "own");
    assert!(matches!(play_source("tmdb:tv:1429:s3e3"), PlaySource::Ready(s, _) if s.contains("E01-05")), "the others keep the season's");
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
    let anime = crate::metadata::anilist::Anilist.map_cards(&fixture("anilist_trending.json"), &cx()).unwrap();
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
    for q in ["dune", "Arrival", "  frieren  ", "DUNE"] {
        search::remember(q);
    }
    search::remember(" ");
    assert_eq!(search::search("")["recent"], json!(["DUNE", "frieren", "Arrival"]));
    for i in 0..15 {
        search::remember(&format!("q{i}"));
    }
    assert_eq!(search::recent().len(), search::RECENT_MAX);
    assert_eq!(search::recent()[0], "q14");
    // Read back from the file.
    search::reset();
    assert_eq!(search::recent()[0], "q14");
    assert!(dir.join("recent_searches.json").exists());
    *DATA_DIR.lock().unwrap() = None;
    let _ = std::fs::remove_dir_all(&dir);
}

/// Home from the real sources (TMDB with the build's key, AniList):
/// `REEL_TMDB_TOKEN=… cargo test -- --ignored live_home --nocapture`.
#[test]
#[ignore]
fn live_home() {
    let _g = fresh(crate::metadata::tmdb::build_key().is_some(), false);
    *TEST_TMDB.lock().unwrap() = None;
    let rt = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
    for kind in ["movie", "tv", "movie-popular", "tv-popular", "anime"] {
        let text = rt.block_on(metadata::trending(kind.into(), "en".into()));
        land(&Call::Trending(kind), &serde_json::from_str(&text).unwrap(), u64::MAX);
    }
    let shelves = home();
    for s in shelves.as_array().unwrap() {
        let items = s["items"].as_array().unwrap();
        let first = &items[0];
        println!("{}: {} items; first {} {:?} still {}", s["id"], items.len(), first["id"], first["title"], first["still"]);
    }
    assert!(shelves.as_array().unwrap().iter().any(|s| s["id"] == "trending_movies" || s["id"] == "no_tmdb"));
}
