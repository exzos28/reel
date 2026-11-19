//! Mapping tests on recorded responses (`fixtures/`, trimmed), and the
//! service end to end on a pre-filled cache. No network, except the
//! `#[ignore]` live test.

use serde_json::{Value, json};

use super::{
    anilist::{self, Anilist},
    animemap,
    cache::{self, CacheKind},
    id::MetaId,
    jikan::Jikan,
    model::*,
    provider::*,
    tmdb::{self, ImageConfig, Tmdb},
};

fn fixture(name: &str) -> Value {
    let path = format!("{}/src/adapters/metadata/fixtures/{name}", env!("CARGO_MANIFEST_DIR"));
    serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap()
}

fn cx(lang: &str) -> MapCx {
    MapCx { lang: lang.into(), images: ImageConfig::from_configuration(&fixture("tmdb_configuration.json")).unwrap() }
}

fn tmdb() -> Tmdb {
    Tmdb::new(Some("test".into()))
}

fn sources(ratings: &[Rating]) -> Vec<RatingSource> {
    ratings.iter().map(|r| r.source).collect()
}

fn aot_entries() -> Vec<AnimeEntry> {
    animemap::parse(
        &std::fs::read(format!("{}/src/adapters/metadata/fixtures/anime-list-full.json", env!("CARGO_MANIFEST_DIR"))).unwrap(),
    )
    .unwrap()
    .iter()
    .filter(|r| r.tmdb_tv == Some(1429))
    .map(|r| r.entry())
    .collect()
}

#[test]
fn image_configuration() {
    let config = ImageConfig::from_configuration(&fixture("tmdb_configuration.json")).unwrap();
    assert_eq!(config.base, "https://image.tmdb.org/t/p/");
    assert!(config.logo.contains(&"w500".to_string()));
    let image = config.image(ImageKind::Poster, "/x.jpg");
    assert_eq!(image.variants.last().unwrap().url, "https://image.tmdb.org/t/p/original/x.jpg");
    assert_eq!(image.variants.last().unwrap().width, None);
    assert_eq!(image.variants[0].width, Some(92));
    assert!(ImageConfig::from_configuration(&json!({})).is_err());
}

#[test]
fn key_kinds() {
    assert!(matches!(tmdb::auth_for("0123456789abcdef0123456789ABCDEF"), Auth::ApiKey(_)));
    assert!(matches!(tmdb::auth_for("eyJhbGciOiJIUzI1NiJ9.e30.x"), Auth::Bearer(_)));
    assert!(!Tmdb::new(Some("  ".into())).configured());
    assert!(matches!(Tmdb::new(None).configuration_request(), Err(ProviderError::NotConfigured)));
}

#[test]
fn request_keys_hold_no_credentials() {
    let secret = "0123456789abcdef0123456789abcdef";
    let req = Tmdb::new(Some(secret.into())).title_request(MetaId::TmdbMovie(603), "pl-PL").unwrap();
    assert!(!req.key.contains(secret));
    assert!(req.key.starts_with("tmdb:/movie/603?"));
    assert!(req.key.contains("include_image_language=pl,en,null"));
    assert_eq!(req.kind, CacheKind::TitleSettled);
}

#[test]
fn tmdb_trending_and_discover() {
    let cards = tmdb().map_cards(&fixture("tmdb_trending_movie.json"), &cx("pl-PL")).unwrap();
    assert_eq!(cards.len(), 3);
    assert!(cards.iter().all(|c| c.kind == TitleKind::Movie && c.id.starts_with("tmdb:movie:")));
    let first = &cards[0];
    assert!(!first.title.is_empty());
    assert!(first.poster.as_ref().unwrap().variants[0].url.starts_with("https://image.tmdb.org/t/p/w92/"));
    assert_eq!(sources(&first.ratings), [RatingSource::Tmdb]);

    let shows = tmdb().map_cards(&fixture("tmdb_discover_tv.json"), &cx("en")).unwrap();
    assert!(shows.iter().all(|c| c.kind == TitleKind::Series && c.id.starts_with("tmdb:tv:")));
}

#[test]
fn tmdb_search_leaves_out_people() {
    let cards = tmdb().map_cards(&fixture("tmdb_search_multi.json"), &cx("pl-PL")).unwrap();
    assert_eq!(cards.len(), 3);
    assert_eq!(cards[0].id, "tmdb:movie:603");
    assert_eq!(cards[0].title, "Matrix");
    assert_eq!(cards[0].year, Some(1999));
}

#[test]
fn tmdb_movie() {
    let t = tmdb().map_title(&fixture("tmdb_movie_603.json"), &cx("pl-PL")).unwrap();
    assert_eq!(t.id, "tmdb:movie:603");
    assert_eq!(t.kind, TitleKind::Movie);
    assert_eq!(t.title, "Matrix");
    assert_eq!(t.original_title.as_deref(), Some("The Matrix"));
    // For searching releases: the English title, from the translations in the same response.
    assert_eq!(t.english_title.as_deref(), Some("The Matrix"));
    assert_eq!(t.ids.imdb.as_deref(), Some("tt0133093"));
    assert_eq!(t.ids.tmdb, Some(TmdbRef { kind: TmdbKind::Movie, id: 603 }));
    assert_eq!(t.release.year, Some(1999));
    assert_eq!(t.runtime_minutes, Some(136));
    assert_eq!(t.status, Some(TitleStatus::Released));
    assert!(t.countries.contains(&"US".to_string()));
    assert!(t.overview.as_deref().unwrap().starts_with("Thomas Anderson"));
    assert!(t.genres.iter().all(|g| g.id.starts_with("tmdb:")));
    assert_eq!(t.logo.as_ref().unwrap().lang.as_deref(), Some("pl"), "the logo in the UI's language first");
    assert_eq!(t.backdrops[0].lang, None, "backdrops without text first");
    assert!(t.poster.as_ref().unwrap().width.is_some(), "size taken from the image list");
    assert_eq!(sources(&t.ratings), [RatingSource::Tmdb]);
    assert!(t.credits.iter().any(|c| c.role == CreditRole::Cast && c.name == "Keanu Reeves"));
    assert!(t.credits.iter().any(|c| c.job.as_deref() == Some("Director")));
    assert!(!t.credits.iter().any(|c| c.job.as_deref() == Some("Producer")));
    assert_eq!(t.source_url, "https://www.themoviedb.org/movie/603");

    // English UI: the English logo comes first.
    let en = tmdb().map_title(&fixture("tmdb_movie_603.json"), &cx("en")).unwrap();
    assert_eq!(en.logo.unwrap().lang.as_deref(), Some("en"));

    let json = serde_json::to_value(&t).unwrap();
    assert!(json.get("sourceUrl").is_some() && json.get("runtimeMinutes").is_some(), "camelCase");
    assert_eq!(json["kind"], "movie");
    assert_eq!(json["ratings"][0]["source"], "tmdb");
}

#[test]
fn tmdb_age_ratings_and_similar() {
    let movie = tmdb().map_title(&fixture("tmdb_movie_603.json"), &cx("pl-PL")).unwrap();
    let certs: Vec<_> = movie.certifications.iter().map(|c| (c.country.as_str(), c.rating.as_str())).collect();
    // The theatrical rating, not the premiere's empty one; a country without one is left out.
    assert_eq!(certs, [("US", "R"), ("DE", "16")]);
    let ids: Vec<_> = movie.similar.iter().map(|c| c.id.as_str()).collect();
    assert_eq!(ids, ["tmdb:movie:604", "tmdb:movie:605"], "recommendations, without the title itself");
    assert_eq!(movie.similar[0].title, "Matrix Reaktywacja");
    assert!(movie.similar[0].backdrop.is_some());

    let show = tmdb().map_title(&fixture("tmdb_tv_1429.json"), &cx("pl-PL")).unwrap();
    assert!(show.certifications.iter().any(|c| c.country == "US" && c.rating == "TV-MA"));
    // No recommendations: the similar titles.
    assert_eq!(show.similar.len(), 1);
    assert_eq!(show.similar[0].id, "tmdb:tv:31911");
    assert_eq!(show.similar[0].kind, TitleKind::Series);

    let req = tmdb().title_request(MetaId::TmdbTv(1429), "en").unwrap();
    let Call::Get { query, .. } = req.call else { panic!("a GET") };
    let append = &query.iter().find(|(k, _)| k == "append_to_response").unwrap().1;
    assert!(append.contains("content_ratings") && append.contains("recommendations") && append.contains("similar"));
    assert!(!append.contains("release_dates"));
}

#[test]
fn tmdb_trailer() {
    let req = tmdb().title_request(MetaId::TmdbMovie(603), "pl-PL").unwrap();
    let Call::Get { query, .. } = req.call else { panic!("a GET") };
    let param = |key: &str| query.iter().find(|(k, _)| k == key).unwrap().1.clone();
    assert!(param("append_to_response").ends_with(",videos"));
    assert_eq!(param("include_video_language"), "pl,en,null");

    let watch = |key: &str| Some(format!("https://www.youtube.com/watch?v={key}"));
    let body = fixture("tmdb_movie_603.json");
    // A fan trailer in Polish loses to official English ones; of those the newest.
    assert_eq!(tmdb().map_title(&body, &cx("pl-PL")).unwrap().trailer, watch("vKQi3bBA1y8"));
    assert_eq!(tmdb().map_title(&body, &cx("en")).unwrap().trailer, watch("vKQi3bBA1y8"));

    // An official one in the content language comes before English.
    let mut polish = body.clone();
    polish["videos"]["results"][1]["official"] = json!(true);
    assert_eq!(tmdb().map_title(&polish, &cx("pl-PL")).unwrap().trailer, watch("plFanTrailer"));
    assert_eq!(tmdb().map_title(&polish, &cx("en")).unwrap().trailer, watch("vKQi3bBA1y8"));

    // No YouTube trailer: the teaser (not the Vimeo trailer, not the featurette).
    let mut teaser = body.clone();
    teaser["videos"]["results"].as_array_mut().unwrap().retain(|v| v["type"] != "Trailer" || v["site"] != "YouTube");
    assert_eq!(tmdb().map_title(&teaser, &cx("pl-PL")).unwrap().trailer, watch("plTeaser"));

    let mut none = body;
    none["videos"]["results"].as_array_mut().unwrap().retain(|v| v["type"] == "Featurette");
    assert_eq!(tmdb().map_title(&none, &cx("pl-PL")).unwrap().trailer, None);
    let json = serde_json::to_value(tmdb().map_title(&fixture("tmdb_tv_1429.json"), &cx("en")).unwrap()).unwrap();
    assert_eq!(json["trailer"], Value::Null, "no videos: null");
}

#[test]
fn tmdb_text_falls_back_by_language() {
    let mut body = fixture("tmdb_movie_603.json");
    body["overview"] = json!("");
    // No Polish translation either: English.
    body["translations"]["translations"].as_array_mut().unwrap().retain(|t| t["iso_639_1"] != "pl");
    let english = body["translations"]["translations"]
        .as_array()
        .unwrap()
        .iter()
        .find(|t| t["iso_639_1"] == "en")
        .unwrap()["data"]["overview"]
        .as_str()
        .unwrap()
        .to_owned();
    let t = tmdb().map_title(&body, &cx("pl-PL")).unwrap();
    assert_eq!(t.overview.as_deref(), Some(english.as_str()));
}

#[test]
fn tmdb_series() {
    let t = tmdb().map_title(&fixture("tmdb_tv_1429.json"), &cx("pl-PL")).unwrap();
    assert_eq!(t.id, "tmdb:tv:1429");
    assert_eq!(t.kind, TitleKind::Series);
    assert_eq!(t.ids.imdb.as_deref(), Some("tt2560140"));
    assert_eq!(t.ids.tvdb, Some(267440));
    assert_eq!(t.ids.wikidata.as_deref(), Some("Q22126305"));
    assert_eq!(t.status, Some(TitleStatus::Ended));
    assert_eq!(t.seasons.len(), 5);
    assert_eq!(t.season_count, Some(4));
    assert_eq!(t.release.year, Some(2013));
    assert!(t.next_episode.is_none());
    assert_eq!(tmdb::absolute_base(&t.seasons, 1), Some(0));
    assert_eq!(tmdb::absolute_base(&t.seasons, 3), Some(37));
    assert_eq!(tmdb::absolute_base(&t.seasons, 0), None);
    assert_eq!(tmdb::absolute_base(&t.seasons, 9), None, "a season not listed");
    assert_eq!(CacheKind::TitleSettled.refine(&fixture("tmdb_tv_1429.json"), cache::now()), CacheKind::TitleSettled);
}

#[test]
fn tmdb_season_with_three_coordinates() {
    let entries = aot_entries();
    let s = tmdb()
        .map_season(&fixture("tmdb_tv_1429_season_3.json"), &cx("pl-PL"), "tmdb:tv:1429", Some(37), &entries)
        .unwrap();
    assert_eq!(s.number, 3);
    assert_eq!(s.title_id, "tmdb:tv:1429");
    let e1 = &s.episodes[0];
    assert_eq!((e1.season, e1.number, e1.absolute), (3, 1, Some(38)));
    assert_eq!(e1.anime, Some(AnimeEpisodeRef { anilist: Some(99147), anidb: Some(13241), number: 1 }));
    assert!(e1.still.is_some());
    let e13 = s.episodes.iter().find(|e| e.number == 13).unwrap();
    assert_eq!(e13.absolute, Some(50));
    assert_eq!(e13.anime, Some(AnimeEpisodeRef { anilist: Some(104578), anidb: Some(14444), number: 1 }));
    assert_eq!(
        CacheKind::SeasonAiring.refine(&fixture("tmdb_tv_1429_season_3.json"), cache::now()),
        CacheKind::SeasonSettled
    );
}

#[test]
fn anime_episode_needs_unambiguous_entries() {
    let entry = |anilist, offset| AnimeEntry {
        anilist: Some(anilist),
        mal: None,
        anidb: None,
        kitsu: None,
        format: None,
        tmdb_season: Some(1),
        episode_offset: offset,
        episodes: None,
        ratings: vec![],
    };
    assert_eq!(tmdb::anime_episode(&[entry(1, None), entry(2, None)], 1, 3), None);
    assert_eq!(tmdb::anime_episode(&[entry(1, None), entry(2, Some(12))], 1, 3).unwrap().anilist, Some(1));
    assert_eq!(tmdb::anime_episode(&[entry(1, None)], 2, 3), None, "no entry for that season");
    let mut bounded = entry(1, None);
    bounded.episodes = Some(12);
    assert_eq!(tmdb::anime_episode(&[bounded], 1, 13), None, "past the entry's episodes");
}

#[test]
fn anilist_media() {
    let t = Anilist.map_title(&fixture("anilist_media_16498.json"), &cx("pl-PL")).unwrap();
    assert_eq!(t.id, "anilist:16498");
    assert_eq!(t.kind, TitleKind::Series);
    assert_eq!(t.title, "Attack on Titan");
    assert_eq!(t.original_title.as_deref(), Some("進撃の巨人"));
    assert_eq!(t.english_title.as_deref(), Some("Attack on Titan"));
    assert_eq!(t.anime.as_ref().and_then(|a| a.romaji.as_deref()), Some("Shingeki no Kyojin"));
    assert_eq!(t.ids.anilist, Some(16498));
    assert_eq!(t.ids.mal, Some(16498));
    assert_eq!(t.status, Some(TitleStatus::Ended));
    assert_eq!(t.release.date.as_deref(), Some("2013-04-07"));
    assert_eq!(t.episode_count, Some(25));
    let anime = t.anime.as_ref().unwrap();
    assert_eq!(anime.format, Some(AnimeFormat::Tv));
    assert_eq!(anime.season.as_deref(), Some("spring"));
    assert_eq!(anime.season_year, Some(2013));
    assert!(anime.aliases.contains(&"Shingeki no Kyojin".to_string()));
    assert!(!anime.aliases.contains(&"Attack on Titan".to_string()));
    assert!(!anime.tags.contains(&"Tragedy".to_string()), "spoiler tags are left out");
    assert_eq!(anime.studios, ["WIT STUDIO"]);
    assert_eq!(t.ratings, [Rating { source: RatingSource::Anilist, value: 85.0, scale: 100.0, votes: None }]);
    let poster = t.poster.as_ref().unwrap();
    assert_eq!(poster.color.as_deref(), Some("#f1a143"));
    assert_eq!(poster.variants.len(), 3);
    assert_eq!(t.backdrop.as_ref().unwrap().kind, ImageKind::Banner);
    assert_eq!(t.trailer.as_deref(), Some("https://www.youtube.com/watch?v=LHtdKWJdif4"));
    let mut other = fixture("anilist_media_16498.json");
    other["data"]["Media"]["trailer"] = json!({ "id": "x2abc", "site": "dailymotion" });
    assert_eq!(Anilist.map_title(&other, &cx("en")).unwrap().trailer, None, "only YouTube");
    let overview = t.overview.as_deref().unwrap();
    assert!(overview.starts_with("Several hundred years ago"));
    assert!(!overview.contains('<'), "no markup");
    assert!(t.credits.iter().any(|c| c.role == CreditRole::Cast && c.character.is_some()));
    assert!(t.credits.iter().any(|c| c.job.as_deref() == Some("Director")));
    assert_eq!(
        CacheKind::TitleOngoing.refine(&fixture("anilist_media_16498.json"), cache::now()),
        CacheKind::TitleSettled
    );
}

#[test]
fn anilist_lists_and_entries() {
    let cards = Anilist.map_cards(&fixture("anilist_trending.json"), &cx("en")).unwrap();
    assert_eq!(cards.len(), 3);
    assert_eq!(cards[0].id, "anilist:195516");
    assert!(cards.iter().all(|c| c.anime && c.source == ProviderId::Anilist));
    assert!(cards[0].poster.is_some());

    let entries = Anilist.map_entries(&fixture("anilist_entries.json")).unwrap();
    assert_eq!(entries.len(), 4);
    let e = &entries[1];
    assert_eq!((e.anilist, e.mal, e.format, e.episodes), (20958, Some(25777), Some(AnimeFormat::Tv), Some(12)));
    assert_eq!(e.score.as_ref().unwrap().scale, 100.0);

    let req = Anilist.entries_request(&[3, 1, 2, 1]);
    assert_eq!(req.key, "anilist:entries:1,2,3");
    assert!(matches!(Anilist.season_request(MetaId::Anilist(1), 1, "en"), Err(ProviderError::Unsupported)));
}

#[test]
fn anilist_plain_text_and_seasons() {
    assert_eq!(
        anilist::plain_text("Line one.<br><br>\n<i>Line &amp; two</i>&#039;s.<br>\r\n(Source: X)"),
        "Line one.\n\nLine & two's.\n(Source: X)"
    );
    assert_eq!(anilist::current_season(1_763_000_000), ("FALL", 2025));
    assert_eq!(anilist::current_season(1_740_000_000), ("WINTER", 2025));
}

#[test]
fn jikan_score() {
    let score = Jikan.map_score(&fixture("jikan_anime_16498.json")).unwrap().unwrap();
    assert_eq!(score, Rating { source: RatingSource::Mal, value: 8.55, scale: 10.0, votes: Some(2_900_000) });
    assert_eq!(Jikan.map_score(&json!({"data": {"mal_id": 1, "score": null}})).unwrap(), None);
    assert!(Jikan.map_score(&json!({"status": 404})).is_err());
    assert_eq!(Jikan.anime_request(16498).key, "jikan:anime:16498");
}

#[test]
fn anime_merges_into_the_tmdb_title() {
    let base = tmdb().map_title(&fixture("tmdb_tv_1429.json"), &cx("pl-PL")).unwrap();
    let anilist = Anilist.map_title(&fixture("anilist_media_16498.json"), &cx("pl-PL")).unwrap();
    let mut entries = aot_entries();
    let primary = super::primary_entry(&entries);
    assert_eq!(entries[primary].anilist, Some(16498));
    entries[primary].ratings = vec![
        Rating { source: RatingSource::Anilist, value: 85.0, scale: 100.0, votes: None },
        Jikan.map_score(&fixture("jikan_anime_16498.json")).unwrap().unwrap(),
    ];
    let mut with_trailer = base.clone();
    with_trailer.trailer = Some("https://www.youtube.com/watch?v=tmdb".into());
    let kept = super::merge_anime(with_trailer, entries.clone(), primary, Some(anilist.clone()));
    assert_eq!(kept.trailer.as_deref(), Some("https://www.youtube.com/watch?v=tmdb"), "TMDB's trailer first");
    assert_eq!(base.trailer, None);
    let t = super::merge_anime(base.clone(), entries, primary, Some(anilist));
    assert_eq!(t.trailer.as_deref(), Some("https://www.youtube.com/watch?v=LHtdKWJdif4"), "else AniList's");
    assert_eq!(t.id, "tmdb:tv:1429");
    assert_eq!(t.title, base.title, "TMDB keeps the text in the UI's language");
    assert_eq!(t.overview, base.overview);
    assert_eq!(sources(&t.ratings), [RatingSource::Tmdb, RatingSource::Anilist, RatingSource::Mal]);
    assert_eq!((t.ids.anilist, t.ids.mal, t.ids.anidb), (Some(16498), Some(16498), Some(9541)));
    assert_eq!(t.ids.imdb.as_deref(), Some("tt2560140"));
    let anime = t.anime.unwrap();
    assert_eq!(anime.entries.len(), 4);
    assert!(anime.aliases.contains(&"Attack on Titan".to_string()));
    assert!(anime.aliases.contains(&"Shingeki no Kyojin".to_string()));
    assert!(!anime.aliases.contains(&base.title));
    assert_eq!(anime.season.as_deref(), Some("spring"));
}

#[test]
fn envelope_shape() {
    let mut age = super::Age::default();
    age.warn(ProviderId::Jikan, &ProviderError::RateLimited(Some(3)));
    let ok = super::envelope(Ok((json!({"items": []}), age)), 7);
    assert_eq!(ok["error"], Value::Null);
    assert_eq!(ok["revision"], 7);
    assert_eq!(ok["warnings"][0]["kind"], "rateLimited");
    assert_eq!(ok["warnings"][0]["provider"], "jikan");
    let err = super::envelope(Err((ProviderError::NotConfigured, Some(ProviderId::Tmdb))), 0);
    assert_eq!(err["data"], Value::Null);
    assert_eq!(err["error"]["kind"], "notConfigured");
    assert_eq!(err["error"]["provider"], "tmdb");
}

/// The service end to end on the global (in-memory) cache filled with the
/// fixtures, so nothing goes to the network. The only test that touches the
/// global service.
#[test]
fn service_answers_from_the_cache() {
    let svc = super::service();
    super::set_tmdb_key("offline-test-key");
    let now = cache::now();
    {
        let mut c = svc.cache.lock().unwrap();
        let rows = animemap::parse(
            &std::fs::read(format!("{}/src/adapters/metadata/fixtures/anime-list-full.json", env!("CARGO_MANIFEST_DIR")))
                .unwrap(),
        )
        .unwrap();
        animemap::replace(c.conn(), &rows).unwrap();
        c.set_meta("animeLists.fetchedAt", &now.to_string());
        let t = tmdb();
        let put = |c: &cache::Cache, req: Request, file: &str| {
            let body = fixture(file);
            c.put(&req.key, req.provider, req.kind.refine(&body, now), &body, now);
        };
        put(&c, t.configuration_request().unwrap(), "tmdb_configuration.json");
        put(&c, t.title_request(MetaId::TmdbTv(1429), "pl-PL").unwrap(), "tmdb_tv_1429.json");
        put(&c, t.season_request(MetaId::TmdbTv(1429), 3, "pl-PL").unwrap(), "tmdb_tv_1429_season_3.json");
        put(&c, Anilist.entries_request(&[16498, 20958, 99147, 104578]), "anilist_entries.json");
        put(&c, Anilist.title_request(MetaId::Anilist(16498), "pl-PL").unwrap(), "anilist_media_16498.json");
        put(&c, Jikan.anime_request(16498), "jikan_anime_16498.json");
        put(&c, Anilist.shelf_request(Shelf::TrendingAnime, "pl-PL").unwrap(), "anilist_trending.json");
    }

    let call = |f: std::pin::Pin<Box<dyn std::future::Future<Output = String>>>| -> Value {
        serde_json::from_str(&svc.rt.block_on(f)).unwrap()
    };

    // An AniList ID answers with the one TMDB title it belongs to.
    let r = call(Box::pin(super::title("anilist:16498".into(), "pl-PL".into())));
    assert_eq!(r["error"], Value::Null, "{r}");
    assert_eq!(r["warnings"], json!([]), "{r}");
    assert_eq!(r["stale"], false);
    let data = &r["data"];
    assert_eq!(data["id"], "tmdb:tv:1429");
    assert_eq!(data["title"], "Atak Tytanów");
    let ratings: Vec<&str> =
        data["ratings"].as_array().unwrap().iter().map(|r| r["source"].as_str().unwrap()).collect();
    assert_eq!(ratings, ["tmdb", "anilist", "mal"]);
    assert_eq!(data["anime"]["entries"].as_array().unwrap().len(), 4);
    assert_eq!(data["anime"]["entries"][1]["episodes"], 12);

    let s = call(Box::pin(super::season("anilist:16498".into(), 3, "pl-PL".into())));
    assert_eq!(s["error"], Value::Null, "{s}");
    assert_eq!(s["data"]["episodes"][0]["absolute"], 38);
    assert_eq!(s["data"]["episodes"][0]["anime"]["anilist"], 99147);

    let shelf = call(Box::pin(super::trending("anime".into(), "pl-PL".into())));
    assert_eq!(shelf["data"]["items"].as_array().unwrap().len(), 3);

    let bad = call(Box::pin(super::title("imdb:tt0133093".into(), "en".into())));
    assert_eq!(bad["error"]["kind"], "badId");
    let shelf = call(Box::pin(super::trending("documentaries".into(), "en".into())));
    assert_eq!(shelf["error"]["kind"], "unsupported");

    let status = super::status();
    assert_eq!(status["tmdb"]["key"], "user");
    assert_eq!(status["animeLists"]["entries"], 6);
    assert_eq!(super::attribution()[0]["notice"], tmdb::NOTICE);

    super::set_tmdb_key("");
}

/// Against the real TMDB: `set -a; . ../.env; set +a; cargo test -- --ignored`.
#[test]
#[ignore = "needs the network and REEL_TMDB_TOKEN"]
fn live_tmdb() {
    let Ok(key) = std::env::var("REEL_TMDB_TOKEN") else {
        eprintln!("REEL_TMDB_TOKEN is not set; skipping");
        return;
    };
    let rt = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
    let client = super::http::client();
    let limiter = super::http::Limiter::new(5.0, 5.0);
    let t = Tmdb::new(Some(key));
    rt.block_on(async {
        let config = super::http::fetch(&client, &limiter, &t.configuration_request().unwrap().call).await.unwrap();
        let cx = MapCx { lang: "pl-PL".into(), images: ImageConfig::from_configuration(&config).unwrap() };
        let body =
            super::http::fetch(&client, &limiter, &t.title_request(MetaId::TmdbMovie(603), "pl-PL").unwrap().call)
                .await
                .unwrap();
        let title = t.map_title(&body, &cx).unwrap();
        assert_eq!(title.ids.imdb.as_deref(), Some("tt0133093"));
        assert!(title.poster.is_some() && title.logo.is_some());
        assert!(title.certifications.iter().any(|c| c.country == "US"), "release_dates appended");
        assert!(!title.similar.is_empty(), "recommendations appended");
        assert!(title.credits.iter().any(|c| c.role == CreditRole::Cast && c.profile.is_some()));
        let trending =
            super::http::fetch(&client, &limiter, &t.shelf_request(Shelf::TrendingSeries, "en").unwrap().call)
                .await
                .unwrap();
        assert!(!t.map_cards(&trending, &cx).unwrap().is_empty());
        let bad = Tmdb::new(Some("eyJ-not-a-token".into()));
        let refused = super::http::fetch(&client, &limiter, &bad.configuration_request().unwrap().call).await;
        assert_eq!(refused.unwrap_err(), ProviderError::Unauthorized);
    });
}

/// The whole service against the real sources (anime lists download,
/// AniList, Jikan, TMDB with the project key): `set -a; . ../.env; set +a;
/// cargo test live_service -- --ignored --nocapture`.
#[test]
#[ignore = "needs the network and REEL_TMDB_TOKEN"]
fn live_service() {
    let Ok(key) = std::env::var("REEL_TMDB_TOKEN") else {
        eprintln!("REEL_TMDB_TOKEN is not set; skipping");
        return;
    };
    let dir = std::env::temp_dir().join(format!("reel-meta-live-{}", std::process::id()));
    super::init(Some(&dir));
    super::set_tmdb_key(&key);
    let svc = super::service();
    for _ in 0..120 {
        if super::status()["animeLists"]["entries"].as_u64().unwrap_or(0) > 0 {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(500));
    }
    assert!(super::status()["animeLists"]["entries"].as_u64().unwrap() > 10_000);
    let r: Value =
        serde_json::from_str(&svc.rt.block_on(super::title("anilist:16498".into(), "pl-PL".into()))).unwrap();
    eprintln!("warnings: {}", r["warnings"]);
    assert_eq!(r["data"]["id"], "tmdb:tv:1429", "{r}");
    let shelf: Value = serde_json::from_str(&svc.rt.block_on(super::trending("anime".into(), "en".into()))).unwrap();
    assert!(!shelf["data"]["items"].as_array().unwrap().is_empty(), "{shelf}");
    let found: Value = serde_json::from_str(&svc.rt.block_on(super::search("frieren".into(), "en".into()))).unwrap();
    eprintln!(
        "search: {}",
        found["data"]["sections"]
            .as_array()
            .unwrap()
            .iter()
            .map(|s| format!("{}:{}", s["source"], s["items"].as_array().unwrap().len()))
            .collect::<Vec<_>>()
            .join(" ")
    );
    // A second call comes from the cache.
    let again: Value =
        serde_json::from_str(&svc.rt.block_on(super::title("tmdb:tv:1429".into(), "pl-PL".into()))).unwrap();
    assert_eq!(again["stale"], false);
    super::set_tmdb_key("");
    let _ = std::fs::remove_dir_all(&dir);
}
