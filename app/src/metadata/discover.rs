//! Browsing a whole catalog with filters: which genres, decade, origin
//! country and order. The filter is the same for every source; TMDB
//! (`Tmdb::discover_request`) and AniList (`Anilist::discover_request`) each
//! turn it into their own query. The lists the filters offer (decades,
//! countries, orders, AniList's genres) are here too; TMDB's genres and the
//! country names in the UI's language come from TMDB itself.

/// Which catalog is browsed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum DiscoverKind {
    Movie,
    Tv,
    Anime,
}

impl DiscoverKind {
    pub fn as_str(self) -> &'static str {
        match self {
            DiscoverKind::Movie => "movie",
            DiscoverKind::Tv => "tv",
            DiscoverKind::Anime => "anime",
        }
    }
}

/// The order of the results.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default)]
pub enum Sort {
    #[default]
    Popular,
    /// Best rated among the titles enough people rated.
    TopRated,
    /// Latest first, among what is out.
    Newest,
}

impl Sort {
    pub const ALL: [Sort; 3] = [Sort::Popular, Sort::TopRated, Sort::Newest];

    pub fn as_str(self) -> &'static str {
        match self {
            Sort::Popular => "popular",
            Sort::TopRated => "top_rated",
            Sort::Newest => "newest",
        }
    }

    pub fn parse(s: &str) -> Option<Sort> {
        Sort::ALL.into_iter().find(|x| x.as_str() == s)
    }
}

/// The decades offered, newest first; `OLDER` is everything before the last.
pub const DECADES: [u16; 7] = [2020, 2010, 2000, 1990, 1980, 1970, 1960];
pub const OLDER: &str = "older";

/// A decade option ("2010", or `OLDER`) as the years it spans, both inclusive
/// (`None`: open).
pub fn years_of(option: &str) -> Option<(Option<u16>, Option<u16>)> {
    if option == OLDER {
        return Some((None, Some(DECADES[DECADES.len() - 1] - 1)));
    }
    let from: u16 = option.parse().ok()?;
    DECADES.contains(&from).then_some((Some(from), Some(from + 9)))
}

/// Origin countries offered for films and series (ISO 3166-1): the ones
/// that make the most of what TMDB lists.
pub const COUNTRIES: [&str; 20] = [
    "US", "GB", "FR", "DE", "IT", "ES", "JP", "KR", "IN", "CN", "HK", "CA", "AU", "SE", "DK", "NO", "PL", "MX", "BR",
    "TR",
];

/// Origin countries offered for anime (AniList's `countryOfOrigin`).
pub const ANIME_COUNTRIES: [&str; 4] = ["JP", "CN", "KR", "TW"];

/// AniList's genres (its `GenreCollection`, without the adult one). AniList
/// names them in English only.
pub const ANIME_GENRES: [&str; 18] = [
    "Action",
    "Adventure",
    "Comedy",
    "Drama",
    "Ecchi",
    "Fantasy",
    "Horror",
    "Mahou Shoujo",
    "Mecha",
    "Music",
    "Mystery",
    "Psychological",
    "Romance",
    "Sci-Fi",
    "Slice of Life",
    "Sports",
    "Supernatural",
    "Thriller",
];

/// What the browse grid is filtered by. Genres are TMDB genre ids ("18") or
/// AniList genre names ("Drama"); a title must have all of them.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Default)]
pub struct Filter {
    pub genres: Vec<String>,
    /// A decade option (see `years_of`).
    pub years: Option<String>,
    pub country: Option<String>,
    pub sort: Sort,
}

impl Filter {
    /// Identifies the filter in cache keys: "g=18,80;y=2010;c=FR;s=popular".
    pub fn key(&self) -> String {
        format!(
            "g={};y={};c={};s={}",
            self.genres.join(","),
            self.years.as_deref().unwrap_or(""),
            self.country.as_deref().unwrap_or(""),
            self.sort.as_str()
        )
    }

    pub fn is_default(&self) -> bool {
        *self == Filter::default()
    }

    /// Applies one choice: `group` "genres" toggles `id`; "years" and
    /// "countries" pick `id` (or drop it when it was picked); "sort" sets it.
    /// An empty `id` clears the group. Whether the filter changed.
    pub fn choose(&mut self, group: &str, id: &str) -> bool {
        let before = self.clone();
        let pick = |slot: &mut Option<String>| {
            *slot = if id.is_empty() || slot.as_deref() == Some(id) { None } else { Some(id.to_owned()) };
        };
        match group {
            "genres" if id.is_empty() => self.genres.clear(),
            "genres" => match self.genres.iter().position(|g| g == id) {
                Some(i) => {
                    self.genres.remove(i);
                }
                None => self.genres.push(id.to_owned()),
            },
            "years" if id.is_empty() || years_of(id).is_some() => pick(&mut self.years),
            "countries" => pick(&mut self.country),
            "sort" => self.sort = Sort::parse(id).unwrap_or_default(),
            _ => {}
        }
        *self != before
    }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use serde_json::{Value, json};

    use super::*;
    use crate::metadata::{anilist::Anilist, provider::*, tmdb::Tmdb};

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

    #[test]
    fn choices() {
        let mut f = Filter::default();
        assert!(f.choose("genres", "18"));
        assert!(f.choose("genres", "80"));
        assert!(f.choose("genres", "18"), "toggles off");
        assert_eq!(f.genres, ["80"]);
        assert!(f.choose("years", "2010"));
        assert!(!f.choose("years", "1850"), "not a decade offered");
        assert!(f.choose("years", "2010"), "picking it again drops it");
        assert_eq!(f.years, None);
        assert!(f.choose("countries", "FR"));
        assert!(f.choose("countries", "JP"));
        assert_eq!(f.country.as_deref(), Some("JP"));
        assert!(f.choose("sort", "newest"));
        assert!(!f.choose("sort", "newest"));
        assert_eq!(f.key(), "g=80;y=;c=JP;s=newest");
        assert!(f.choose("genres", ""));
        assert!(f.choose("countries", ""));
        assert!(f.choose("sort", "popular"));
        assert!(f.is_default());
        assert_eq!(years_of("1960"), Some((Some(1960), Some(1969))));
        assert_eq!(years_of(OLDER), Some((None, Some(1959))));
    }
}
