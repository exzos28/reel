//! How TMDB and AniList turn the discover filter (`reel_domain::discover`) into their own
//! queries, and read the pages and filter lists they answer.

use std::collections::BTreeMap;

use serde_json::{Value, json};

use super::{anilist::Anilist, provider::*, tmdb::Tmdb};
use reel_domain::discover::*;

fn fixture(name: &str) -> Value {
    let path = format!("{}/src/metadata/fixtures/{name}", env!("CARGO_MANIFEST_DIR"));
    serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap()
}

fn tmdb() -> Tmdb {
    Tmdb::new(Some("test".into()))
}

/// The URL and the query of a TMDB request.
fn get(req: &Request) -> (String, BTreeMap<String, String>) {
    let Call::Get { url, query, .. } = &req.call else { panic!("a GET") };
    (url.clone(), query.iter().cloned().collect())
}

fn filter(genres: &[&str], years: Option<&str>, country: Option<&str>, sort: Sort) -> Filter {
    Filter {
        genres: genres.iter().map(|g| g.to_string()).collect(),
        years: years.map(str::to_owned),
        country: country.map(str::to_owned),
        sort,
    }
}

const TODAY: &str = "2026-11-14";

#[test]
fn without_filters_it_is_the_popular_shelf() {
    let req = tmdb().discover_request(DiscoverKind::Movie, &Filter::default(), "en", TODAY, 1).unwrap();
    let shelf = tmdb().shelf_request(Shelf::PopularMovies, "en").unwrap();
    // The same query, so the same cached answer.
    assert_eq!(req.key, shelf.key);
    let (url, q) = get(&req);
    assert!(url.ends_with("/discover/movie"));
    assert_eq!(q["sort_by"], "popularity.desc");
    assert_eq!(q["include_adult"], "false");
    assert!(!q.contains_key("with_genres"));
}

#[test]
fn tmdb_films_by_genres_decade_country_best_rated() {
    let f = filter(&["18", "80"], Some("2010"), Some("FR"), Sort::TopRated);
    let req = tmdb().discover_request(DiscoverKind::Movie, &f, "pl-PL", TODAY, 1).unwrap();
    let (_, q) = get(&req);
    assert_eq!(q["with_genres"], "18,80", "every genre");
    assert_eq!(q["primary_release_date.gte"], "2010-01-01");
    assert_eq!(q["primary_release_date.lte"], "2019-12-31");
    assert_eq!(q["with_origin_country"], "FR");
    assert_eq!(q["sort_by"], "vote_average.desc");
    assert_eq!(q["vote_count.gte"], "300");
    assert_eq!(q["language"], "pl-PL");
    assert!(req.key.contains("with_genres=18,80"));
    // Another filter, another cache entry.
    let other = tmdb().discover_request(DiscoverKind::Movie, &Filter::default(), "pl-PL", TODAY, 1).unwrap();
    assert_ne!(req.key, other.key);
}

#[test]
fn tmdb_series_newest_stops_at_today() {
    let f = filter(&[], Some("2020"), None, Sort::Newest);
    let (url, q) = get(&tmdb().discover_request(DiscoverKind::Tv, &f, "en", TODAY, 1).unwrap());
    assert!(url.ends_with("/discover/tv"));
    assert_eq!(q["sort_by"], "first_air_date.desc");
    assert_eq!(q["first_air_date.gte"], "2020-01-01");
    assert_eq!(q["first_air_date.lte"], TODAY);
    assert!(!q.contains_key("primary_release_date.lte"));
    // Before 1960: no lower bound; an older decade ends before today anyway.
    let f = filter(&[], Some(OLDER), None, Sort::Newest);
    let (_, q) = get(&tmdb().discover_request(DiscoverKind::Tv, &f, "en", TODAY, 1).unwrap());
    assert!(!q.contains_key("first_air_date.gte"));
    assert_eq!(q["first_air_date.lte"], "1959-12-31");
    let f = filter(&[], None, None, Sort::TopRated);
    let (_, q) = get(&tmdb().discover_request(DiscoverKind::Tv, &f, "en", TODAY, 1).unwrap());
    assert_eq!(q["vote_count.gte"], "200");
}

#[test]
fn series_leave_out_cartoons_kids_and_talk_and_cartoons_leave_out_anime() {
    let (url, q) = get(&tmdb().discover_request(DiscoverKind::Tv, &Filter::default(), "en", TODAY, 1).unwrap());
    assert!(url.ends_with("/discover/tv"));
    assert_eq!(q["without_genres"], "16|10762|10763|10764|10766|10767");
    assert!(!q.contains_key("with_genres"));
    let (url, q) = get(&tmdb().discover_request(DiscoverKind::Cartoons, &Filter::default(), "en", TODAY, 1).unwrap());
    assert!(url.ends_with("/discover/tv"));
    assert_eq!(q["with_genres"], "16");
    assert_eq!(q["without_keywords"], "210024");
    assert!(!q.contains_key("without_genres"));
    // A genre picked on Cartoons narrows Animation down (comma: both).
    let f = filter(&["35"], None, None, Sort::Popular);
    let (_, q) = get(&tmdb().discover_request(DiscoverKind::Cartoons, &f, "en", TODAY, 1).unwrap());
    assert_eq!(q["with_genres"], "16,35");
    // Series and Cartoons are not one cached answer.
    let a = tmdb().discover_request(DiscoverKind::Tv, &Filter::default(), "en", TODAY, 1).unwrap();
    let b = tmdb().discover_request(DiscoverKind::Cartoons, &Filter::default(), "en", TODAY, 1).unwrap();
    assert_ne!(a.key, b.key);
}

#[test]
fn tmdb_drops_what_is_not_its_own() {
    // AniList's genre names and an unknown decade (filters of another catalog).
    let f = filter(&["Drama", "18"], Some("1850"), None, Sort::Popular);
    let (_, q) = get(&tmdb().discover_request(DiscoverKind::Movie, &f, "en", TODAY, 1).unwrap());
    assert_eq!(q["with_genres"], "18");
    assert!(!q.contains_key("primary_release_date.gte"));
    assert!(tmdb().discover_request(DiscoverKind::Anime, &f, "en", TODAY, 1).is_err());
    assert!(Tmdb::new(None).discover_request(DiscoverKind::Movie, &f, "en", TODAY, 1).is_err());
}

#[test]
fn anilist_variables() {
    let f = filter(&["Drama", "Mecha", "18"], Some("2010"), Some("JP"), Sort::TopRated);
    let req = Anilist.discover_request(&f, 1);
    let Call::Graphql { query, variables, .. } = &req.call else { panic!("GraphQL") };
    assert!(query.contains("genre_in: $genres"));
    assert_eq!(variables["sort"], json!(["SCORE_DESC"]));
    assert_eq!(variables["genres"], json!(["Drama", "Mecha"]));
    assert_eq!(variables["from"], 20_099_999);
    assert_eq!(variables["until"], 20_200_000);
    assert_eq!(variables["country"], "JP");
    assert_eq!(variables["minPopularity"], 5000);
    assert!(req.key.starts_with("anilist:discover:"));

    let req = Anilist.discover_request(&filter(&[], Some(OLDER), None, Sort::Newest), 1);
    let Call::Graphql { variables, .. } = &req.call else { panic!("GraphQL") };
    assert_eq!(variables["sort"], json!(["START_DATE_DESC"]));
    assert_eq!(variables["statusNot"], "NOT_YET_RELEASED");
    assert!(variables.get("from").is_none());
    assert_eq!(variables["until"], 19_600_000);
    let req = Anilist.discover_request(&Filter::default(), 1);
    let Call::Graphql { variables, .. } = &req.call else { panic!("GraphQL") };
    assert_eq!(*variables, json!({ "page": 1, "sort": ["POPULARITY_DESC"] }));
}

#[test]
fn further_pages() {
    let f = filter(&["18"], None, None, Sort::Popular);
    let first = tmdb().discover_request(DiscoverKind::Movie, &f, "en", TODAY, 1).unwrap();
    let second = tmdb().discover_request(DiscoverKind::Movie, &f, "en", TODAY, 2).unwrap();
    assert!(!get(&first).1.contains_key("page"), "page 1 is the query without a page");
    assert_eq!(get(&second).1["page"], "2");
    assert_ne!(first.key, second.key, "each page its own cache entry");

    // TMDB counts 1001 pages but serves 500.
    let body = fixture("tmdb_discover_tv.json");
    assert!(tmdb().discover_more(&body, 1));
    assert!(tmdb().discover_more(&body, 499));
    assert!(!tmdb().discover_more(&body, 500));
    assert!(!tmdb().discover_more(&json!({ "results": [], "total_pages": 3 }), 3));
    assert!(tmdb().discover_more(&json!({ "results": [], "total_pages": 3 }), 2));

    let a1 = Anilist.discover_request(&f, 1);
    let a3 = Anilist.discover_request(&f, 3);
    let Call::Graphql { query, variables, .. } = &a3.call else { panic!("GraphQL") };
    assert!(query.contains("Page(page: $page") && query.contains("hasNextPage"));
    assert_eq!(variables["page"], 3);
    assert_eq!(a1.key, format!("anilist:discover:{}", f.key()));
    assert_ne!(a1.key, a3.key);
    let page = |more: bool| json!({ "data": { "Page": { "pageInfo": { "hasNextPage": more }, "media": [] } } });
    assert!(Anilist.discover_more(&page(true)));
    assert!(!Anilist.discover_more(&page(false)));
}

#[test]
fn genre_and_country_lists() {
    let req = tmdb().genres_request(DiscoverKind::Tv, "pl-PL").unwrap();
    assert!(get(&req).0.ends_with("/genre/tv/list"));
    let genres = tmdb().map_genres(&fixture("tmdb_genre_movie.json")).unwrap();
    assert_eq!(genres[5], ("18".to_string(), "Drama".to_string()));
    let countries = tmdb().map_countries(&fixture("tmdb_countries_pl.json")).unwrap();
    assert!(countries.contains(&("FR".to_string(), "Francja".to_string())));
    // No name in the language asked for: the English one.
    assert!(countries.contains(&("XK".to_string(), "Kosovo".to_string())));
    assert!(get(&tmdb().countries_request("pl-PL").unwrap()).0.ends_with("/configuration/countries"));
}
