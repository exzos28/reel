//! TMDB (API v3): the main catalog. Movies, series, seasons and episodes,
//! posters, backdrops, title logos, stills, credits, translations,
//! external IDs (IMDb, TVDB, Wikidata), trending, discover, search.
//!
//! The key is a v4 read access token (sent as a bearer) or a v3 `api_key`
//! (32 hex digits, sent as a query parameter): the user's own, or the project
//! key compiled in from `REEL_TMDB_TOKEN`. Neither is ever in the repo.

use serde_json::Value;

use super::{
    cache::CacheKind,
    discover::{self, DiscoverKind, Filter, Sort},
    id::MetaId,
    model::*,
    provider::*,
};

pub const API: &str = "https://api.themoviedb.org/3";
pub const SITE: &str = "https://www.themoviedb.org";
pub const NOTICE: &str =
    "This application uses TMDB and the TMDB APIs but is not endorsed, certified, or otherwise approved by TMDB.";

/// The project key, set when the app is built (`REEL_TMDB_TOKEN=… nsh build`).
pub fn build_key() -> Option<&'static str> {
    option_env!("REEL_TMDB_TOKEN").map(str::trim).filter(|k| !k.is_empty())
}

/// How a key is sent: a v3 key is 32 hex digits, anything else is a v4 token.
pub fn auth_for(key: &str) -> Auth {
    let key = key.trim();
    if key.len() == 32 && key.bytes().all(|b| b.is_ascii_hexdigit()) {
        Auth::ApiKey(key.to_owned())
    } else {
        Auth::Bearer(key.to_owned())
    }
}

/// Where images live and in which sizes (`/configuration`).
#[derive(Debug, Clone, PartialEq)]
pub struct ImageConfig {
    pub base: String,
    pub poster: Vec<String>,
    pub backdrop: Vec<String>,
    pub logo: Vec<String>,
    pub still: Vec<String>,
    pub profile: Vec<String>,
}

impl Default for ImageConfig {
    /// What `/configuration` has answered for years; used until it is fetched.
    fn default() -> Self {
        let v = |s: &[&str]| s.iter().map(|x| x.to_string()).collect();
        ImageConfig {
            base: "https://image.tmdb.org/t/p/".into(),
            poster: v(&["w92", "w154", "w185", "w342", "w500", "w780", "original"]),
            backdrop: v(&["w300", "w500", "w780", "w1280", "original"]),
            logo: v(&["w45", "w92", "w154", "w185", "w300", "w500", "original"]),
            still: v(&["w92", "w185", "w300", "original"]),
            profile: v(&["w45", "w185", "h632", "original"]),
        }
    }
}

/// TMDB lists w300 and w780 for backdrops, but its CDN serves w500 too: the size a TV's
/// card (352 px) needs, at less than half w780's bytes.
fn with_w500(mut sizes: Vec<String>) -> Vec<String> {
    if !sizes.iter().any(|s| s == "w500") {
        let at = sizes.iter().position(|s| s.strip_prefix('w').and_then(|n| n.parse::<u32>().ok()).is_none_or(|w| w > 500));
        sizes.insert(at.unwrap_or(sizes.len()), "w500".into());
    }
    sizes
}

impl ImageConfig {
    pub fn from_configuration(body: &Value) -> Result<ImageConfig, ProviderError> {
        let images = body.get("images").ok_or_else(|| parse_err("configuration without images"))?;
        let list = |key: &str| -> Result<Vec<String>, ProviderError> {
            let sizes: Vec<String> = arr(images, key).iter().filter_map(Value::as_str).map(str::to_owned).collect();
            if sizes.is_empty() { Err(parse_err(key)) } else { Ok(sizes) }
        };
        Ok(ImageConfig {
            base: s(images, "secure_base_url").ok_or_else(|| parse_err("secure_base_url"))?,
            poster: list("poster_sizes")?,
            backdrop: with_w500(list("backdrop_sizes")?),
            logo: list("logo_sizes")?,
            still: list("still_sizes")?,
            profile: list("profile_sizes")?,
        })
    }

    fn sizes(&self, kind: ImageKind) -> &[String] {
        match kind {
            ImageKind::Poster => &self.poster,
            ImageKind::Backdrop | ImageKind::Banner => &self.backdrop,
            ImageKind::Logo => &self.logo,
            ImageKind::Still => &self.still,
            ImageKind::Profile => &self.profile,
        }
    }

    /// An image at `path` ("/abc.jpg") in every size the CDN has for its kind.
    pub fn image(&self, kind: ImageKind, path: &str) -> Image {
        let variants = self
            .sizes(kind)
            .iter()
            .map(|size| ImageVariant {
                size: size.clone(),
                width: size.strip_prefix('w').and_then(|w| w.parse().ok()),
                url: format!("{}{size}{path}", self.base),
            })
            .collect();
        Image {
            kind,
            source: ProviderId::Tmdb,
            width: None,
            height: None,
            aspect: None,
            lang: None,
            vote: None,
            color: None,
            variants,
        }
    }

    fn image_at(&self, kind: ImageKind, v: &Value, key: &str) -> Option<Image> {
        s(v, key).map(|p| self.image(kind, &p))
    }

    /// An entry of `images.posters|backdrops|logos`.
    fn listed(&self, kind: ImageKind, v: &Value) -> Option<Image> {
        let mut image = self.image(kind, &s(v, "file_path")?);
        image.width = u(v, "width").map(|w| w as u32);
        image.height = u(v, "height").map(|h| h as u32);
        image.aspect = f(v, "aspect_ratio").map(|a| a as f32);
        image.lang = s(v, "iso_639_1");
        image.vote = f(v, "vote_average").map(|a| a as f32);
        Some(image)
    }
}

pub struct Tmdb {
    key: Option<String>,
}

impl Tmdb {
    pub fn new(key: Option<String>) -> Tmdb {
        Tmdb { key: key.filter(|k| !k.trim().is_empty()) }
    }

    fn get(&self, path: &str, mut query: Vec<(&str, String)>, kind: CacheKind) -> Result<Request, ProviderError> {
        let key = self.key.as_deref().ok_or(ProviderError::NotConfigured)?;
        query.sort();
        let cache_key =
            format!("tmdb:{path}?{}", query.iter().map(|(k, v)| format!("{k}={v}")).collect::<Vec<_>>().join("&"));
        Ok(Request {
            provider: ProviderId::Tmdb,
            key: cache_key,
            kind,
            call: Call::Get {
                url: format!("{API}{path}"),
                query: query.into_iter().map(|(k, v)| (k.to_owned(), v)).collect(),
                auth: auth_for(key),
            },
        })
    }

    /// Search, films and series apart (`/search/movie`, `/search/tv`: the
    /// first page of each, by relevance), so neither crowds the other out:
    /// (films, series).
    pub fn search_requests(&self, query: &str, lang: &str) -> Result<(Request, Request), ProviderError> {
        let ask = |path| {
            self.get(
                path,
                vec![("query", query.trim().to_owned()), ("language", lang.to_owned()), ("include_adult", "false".into())],
                CacheKind::Search,
            )
        };
        Ok((ask("/search/movie")?, ask("/search/tv")?))
    }

    /// A person and every title they are credited in (`combined_credits`: films and series).
    pub fn person_request(&self, n: u64, lang: &str) -> Result<Request, ProviderError> {
        self.get(
            &format!("/person/{n}"),
            vec![("language", lang.to_owned()), ("append_to_response", "combined_credits".into())],
            CacheKind::Person,
        )
    }

    /// A person's answer: who they are and their titles. An actor's are the parts they played; a
    /// director's or a writer's the titles they worked on. Talk shows, news and reality TV (where
    /// people appear as themselves) are left out.
    pub fn map_person(&self, body: &Value, cx: &MapCx) -> Result<Person, ProviderError> {
        let n = u(body, "id").ok_or_else(|| parse_err("id"))?;
        let credits = body.get("combined_credits").unwrap_or(&Value::Null);
        let acting = s(body, "known_for_department").is_none_or(|d| d == "Acting");
        let list = if acting { "cast" } else { "crew" };
        let mut seen = std::collections::HashSet::new();
        let cards = arr(credits, list)
            .iter()
            .filter(|c| !c["genre_ids"].as_array().is_some_and(|g| g.iter().any(|id| id.as_u64().is_some_and(|id| NOT_FILMOGRAPHY.contains(&id)))))
            .filter_map(|c| {
                let kind = match c.get("media_type").and_then(Value::as_str) {
                    Some("movie") => TitleKind::Movie,
                    Some("tv") => TitleKind::Series,
                    _ => return None,
                };
                card(c, kind, cx)
            })
            .filter(|c| seen.insert(c.id.clone()))
            .collect();
        Ok(Person {
            id: person_id(n),
            name: s(body, "name").ok_or_else(|| parse_err("name"))?,
            profile: cx.images.image_at(ImageKind::Profile, body, "profile_path"),
            credits: cards,
        })
    }

    pub fn configuration_request(&self) -> Result<Request, ProviderError> {
        self.get("/configuration", vec![], CacheKind::Config)
    }

    /// The films (`Movie`) or series (`Tv`) `filter` lets through, page
    /// `page` (from 1; the first one's query is the popular shelf's).
    /// `today` ("YYYY-MM-DD") keeps "newest" to what is out.
    pub fn discover_request(
        &self,
        kind: DiscoverKind,
        filter: &Filter,
        lang: &str,
        today: &str,
        page: u32,
    ) -> Result<Request, ProviderError> {
        let (path, date, min_votes) = match kind {
            DiscoverKind::Movie => ("/discover/movie", "primary_release_date", 300),
            DiscoverKind::Tv | DiscoverKind::Cartoons => ("/discover/tv", "first_air_date", 200),
            DiscoverKind::Anime => return Err(ProviderError::Unsupported),
        };
        let mut query = vec![("language", lang.to_owned()), ("include_adult", "false".into())];
        let joined = |ids: &[u32], sep: &str| ids.iter().map(u32::to_string).collect::<Vec<_>>().join(sep);
        match kind {
            // Pipe: none of them.
            DiscoverKind::Tv => query.push(("without_genres", joined(&discover::NOT_SERIES, "|"))),
            DiscoverKind::Cartoons => query.push(("without_keywords", discover::ANIME_KEYWORD.to_string())),
            _ => {}
        }
        let sort = match filter.sort {
            Sort::Popular => "popularity.desc".to_owned(),
            Sort::TopRated => {
                query.push(("vote_count.gte", min_votes.to_string()));
                "vote_average.desc".to_owned()
            }
            Sort::Newest => {
                // Some votes, so the first page is not placeholders of last week.
                query.push(("vote_count.gte", "10".into()));
                format!("{date}.desc")
            }
        };
        query.push(("sort_by", sort));
        let mut genres: Vec<&str> =
            filter.genres.iter().map(String::as_str).filter(|g| g.bytes().all(|b| b.is_ascii_digit())).collect();
        let animation = discover::ANIMATION.to_string();
        if kind == DiscoverKind::Cartoons && !genres.contains(&animation.as_str()) {
            genres.insert(0, &animation);
        }
        if !genres.is_empty() {
            // Comma: a title has every genre.
            query.push(("with_genres", genres.join(",")));
        }
        let (from, to) = filter.years.as_deref().and_then(discover::years_of).unwrap_or((None, None));
        let mut until = to.map(|y| format!("{y}-12-31"));
        if filter.sort == Sort::Newest && until.as_deref().is_none_or(|u| u > today) {
            until = Some(today.to_owned());
        }
        let (gte, lte) = match kind {
            DiscoverKind::Movie => ("primary_release_date.gte", "primary_release_date.lte"),
            _ => ("first_air_date.gte", "first_air_date.lte"),
        };
        if let Some(y) = from {
            query.push((gte, format!("{y}-01-01")));
        }
        if let Some(u) = until {
            query.push((lte, u));
        }
        if let Some(c) = &filter.country {
            query.push(("with_origin_country", c.clone()));
        }
        if page > 1 {
            query.push(("page", page.to_string()));
        }
        self.get(path, query, CacheKind::Shelf)
    }

    /// Whether a discover answer for `page` has a page after it: TMDB counts
    /// `total_pages` but serves none past `DISCOVER_LAST_PAGE`. An answer
    /// without the count has more when its page is full.
    pub fn discover_more(&self, body: &Value, page: u32) -> bool {
        let last = match body.get("total_pages").and_then(Value::as_u64) {
            Some(total) => total.min(DISCOVER_LAST_PAGE as u64) as u32,
            None => {
                let full = body.get("results").and_then(Value::as_array).is_some_and(|r| r.len() >= DISCOVER_PAGE_SIZE);
                return full && page < DISCOVER_LAST_PAGE;
            }
        };
        page < last
    }

    /// TMDB's genres of films or series, in `lang`.
    pub fn genres_request(&self, kind: DiscoverKind, lang: &str) -> Result<Request, ProviderError> {
        let path = match kind {
            DiscoverKind::Movie => "/genre/movie/list",
            DiscoverKind::Tv | DiscoverKind::Cartoons => "/genre/tv/list",
            DiscoverKind::Anime => return Err(ProviderError::Unsupported),
        };
        self.get(path, vec![("language", lang.to_owned())], CacheKind::Config)
    }

    /// `[(id, name)]` of a genre list.
    pub fn map_genres(&self, body: &Value) -> Result<Vec<(String, String)>, ProviderError> {
        let genres = body.get("genres").and_then(Value::as_array).ok_or_else(|| parse_err("no genres"))?;
        Ok(genres.iter().filter_map(|g| Some((u(g, "id")?.to_string(), s(g, "name")?))).collect())
    }

    /// Every country with its name in `lang`.
    pub fn countries_request(&self, lang: &str) -> Result<Request, ProviderError> {
        self.get("/configuration/countries", vec![("language", lang.to_owned())], CacheKind::Config)
    }

    /// `{code: name}` of the country list (the name in the language asked
    /// for, which TMDB calls `native_name`).
    pub fn map_countries(&self, body: &Value) -> Result<Vec<(String, String)>, ProviderError> {
        let list = body.as_array().ok_or_else(|| parse_err("no countries"))?;
        Ok(list
            .iter()
            .filter_map(|c| Some((s(c, "iso_3166_1")?, s(c, "native_name").or_else(|| s(c, "english_name"))?)))
            .collect())
    }

    /// The TMDB season `n` of series `id`, mapped. `absolute_base` is how many
    /// regular episodes the earlier seasons have (None when unknown);
    /// `entries` the anime entries of the series, to place each episode.
    pub fn map_season(
        &self,
        body: &Value,
        cx: &MapCx,
        title_id: &str,
        absolute_base: Option<u32>,
        entries: &[AnimeEntry],
    ) -> Result<Season, ProviderError> {
        let number = u(body, "season_number").ok_or_else(|| parse_err("season_number"))? as u32;
        let episodes = arr(body, "episodes")
            .iter()
            .filter_map(|e| {
                let n = u(e, "episode_number")? as u32;
                let season = u(e, "season_number").map(|s| s as u32).unwrap_or(number);
                Some(Episode {
                    season,
                    number: n,
                    absolute: absolute_base.filter(|_| season > 0).map(|b| b + n),
                    anime: anime_episode(entries, season, n),
                    kind: if season == 0 { EpisodeKind::Special } else { EpisodeKind::Regular },
                    name: s(e, "name"),
                    overview: s(e, "overview"),
                    air_date: s(e, "air_date"),
                    runtime_minutes: u(e, "runtime").map(|r| r as u32),
                    still: cx.images.image_at(ImageKind::Still, e, "still_path"),
                    ratings: tmdb_rating(e).into_iter().collect(),
                    ids: ExternalIds {
                        tmdb: u(e, "id").map(|id| TmdbRef { kind: TmdbKind::Episode, id }),
                        ..Default::default()
                    },
                })
            })
            .collect();
        Ok(Season {
            title_id: title_id.to_owned(),
            number,
            name: s(body, "name"),
            overview: s(body, "overview"),
            air_date: s(body, "air_date"),
            poster: cx.images.image_at(ImageKind::Poster, body, "poster_path"),
            episodes,
            ids: ExternalIds {
                tmdb: u(body, "id").map(|id| TmdbRef { kind: TmdbKind::Season, id }),
                ..Default::default()
            },
        })
    }
}

/// Which anime entry TMDB episode `season`x`n` belongs to: among the entries
/// of that season, the one with the largest offset below `n`. Left out when
/// the entries of the season do not tell them apart (same offset twice).
pub fn anime_episode(entries: &[AnimeEntry], season: u32, n: u32) -> Option<AnimeEpisodeRef> {
    let mut of_season: Vec<&AnimeEntry> = entries.iter().filter(|e| e.tmdb_season == Some(season)).collect();
    if of_season.is_empty() {
        return None;
    }
    of_season.sort_by_key(|e| e.episode_offset.unwrap_or(0));
    if of_season.windows(2).any(|w| w[0].episode_offset.unwrap_or(0) == w[1].episode_offset.unwrap_or(0)) {
        return None;
    }
    let entry = of_season.iter().rev().find(|e| e.episode_offset.unwrap_or(0) < n)?;
    let number = n - entry.episode_offset.unwrap_or(0);
    if entry.episodes.is_some_and(|total| number > total) {
        return None;
    }
    Some(AnimeEpisodeRef { anilist: entry.anilist, anidb: entry.anidb, number })
}

fn tmdb_rating(v: &Value) -> Option<Rating> {
    let votes = u(v, "vote_count").filter(|n| *n > 0)?;
    Some(Rating { source: RatingSource::Tmdb, value: f(v, "vote_average")? as f32, scale: 10.0, votes: Some(votes) })
}

fn status(s: &str) -> Option<TitleStatus> {
    Some(match s {
        "Released" => TitleStatus::Released,
        "Returning Series" => TitleStatus::Airing,
        "Ended" => TitleStatus::Ended,
        "Canceled" => TitleStatus::Canceled,
        "In Production" | "Post Production" | "Pilot" => TitleStatus::InProduction,
        "Planned" | "Rumored" => TitleStatus::Announced,
        _ => return None,
    })
}

/// A field of the title in the UI's language: what the localized request
/// returned; when TMDB had no translation for that region, the translation
/// in the same language for another region; then English. (The per-field
/// chain of research report §4.2: pl-PL → pl → en.)
fn localized(body: &Value, field: &str, alt_field: &str, cx: &MapCx) -> Option<String> {
    if let Some(text) = s(body, field) {
        return Some(text);
    }
    let translations = body.pointer("/translations/translations").and_then(Value::as_array)?;
    let pick = |lang: &str| {
        translations
            .iter()
            .filter(|t| t.get("iso_639_1").and_then(Value::as_str) == Some(lang))
            .find_map(|t| t.get("data").and_then(|d| s(d, field).or_else(|| s(d, alt_field))))
    };
    pick(cx.lang_primary()).or_else(|| pick("en"))
}

/// The title in English: the title itself when the UI is in English; else TMDB's English
/// translation (the US one first, as it is already in the cached response: no extra request);
/// else the original title when the film's language is English. None when none of them is.
fn english(body: &Value, field: &str, original_field: &str, cx: &MapCx, title: &str) -> Option<String> {
    if cx.lang_primary() == "en" {
        return Some(title.to_owned());
    }
    let translations = body.pointer("/translations/translations").and_then(Value::as_array);
    let en: Vec<&Value> = translations.into_iter().flatten().filter(|t| t.get("iso_639_1").and_then(Value::as_str) == Some("en")).collect();
    let name = |t: &&Value| t.get("data").and_then(|d| s(d, field));
    en.iter()
        .filter(|t| t.get("iso_3166_1").and_then(Value::as_str) == Some("US"))
        .find_map(name)
        .or_else(|| en.iter().find_map(name))
        .or_else(|| (s(body, "original_language").as_deref() == Some("en")).then(|| s(body, original_field)).flatten())
}

/// Best first by vote; logos in the UI's language first, then English, then
/// the rest (a logo in a language the UI does not show is still the title).
fn ranked(images: &[Value], kind: ImageKind, cx: &MapCx) -> Vec<Image> {
    let mut list: Vec<Image> = images.iter().filter_map(|v| cx.images.listed(kind, v)).collect();
    let lang = cx.lang_primary().to_owned();
    let rank = |i: &Image| match (kind, i.lang.as_deref()) {
        (ImageKind::Logo, Some(l)) if l == lang => 0,
        (ImageKind::Logo, Some("en")) => 1,
        (ImageKind::Logo, _) => 2,
        // Backdrops without text first.
        (ImageKind::Backdrop, None) => 0,
        (ImageKind::Backdrop, _) => 1,
        _ => 0,
    };
    list.sort_by(|a, b| rank(a).cmp(&rank(b)).then(b.vote.unwrap_or(0.0).total_cmp(&a.vote.unwrap_or(0.0))));
    list
}

/// The image the response names (`poster_path`), with its size from the list.
fn named(body: &Value, key: &str, list: &[Image], kind: ImageKind, cx: &MapCx) -> Option<Image> {
    let path = s(body, key)?;
    let mut image = cx.images.image(kind, &path);
    if let Some(found) = list.iter().find(|i| i.variants.first().is_some_and(|v| v.url.ends_with(&path))) {
        image.width = found.width;
        image.height = found.height;
        image.aspect = found.aspect;
        image.lang = found.lang.clone();
        image.vote = found.vote;
    }
    Some(image)
}

/// A TMDB person's id as credits name it: "tmdb:person:6384".
pub fn person_id(n: u64) -> String {
    format!("tmdb:person:{n}")
}

/// The TMDB number of a person's id ("tmdb:person:6384").
pub fn person_number(id: &str) -> Option<u64> {
    id.strip_prefix("tmdb:person:")?.parse().ok().filter(|n| *n > 0)
}

/// TMDB's TV genres a person's titles leave out: News, Reality, Talk.
const NOT_FILMOGRAPHY: [u64; 3] = [10763, 10764, 10767];

fn card(v: &Value, kind: TitleKind, cx: &MapCx) -> Option<TitleCard> {
    let id = u(v, "id")?;
    let (title, original, date) = match kind {
        TitleKind::Movie => (s(v, "title")?, s(v, "original_title"), s(v, "release_date")),
        TitleKind::Series => (s(v, "name")?, s(v, "original_name"), s(v, "first_air_date")),
    };
    Some(TitleCard {
        id: match kind {
            TitleKind::Movie => MetaId::TmdbMovie(id),
            TitleKind::Series => MetaId::TmdbTv(id),
        }
        .to_string(),
        kind,
        anime: false,
        source: ProviderId::Tmdb,
        original_title: original.filter(|o| *o != title),
        title,
        overview: s(v, "overview"),
        year: date.as_deref().and_then(year_of),
        poster: cx.images.image_at(ImageKind::Poster, v, "poster_path"),
        backdrop: cx.images.image_at(ImageKind::Backdrop, v, "backdrop_path"),
        ratings: tmdb_rating(v).into_iter().collect(),
    })
}

impl Provider for Tmdb {
    fn id(&self) -> ProviderId {
        ProviderId::Tmdb
    }

    fn capabilities(&self) -> &'static [Capability] {
        use Capability::*;
        &[Search, Details, Seasons, Episodes, Credits, Images, Logos, Ratings, Trending, Translations, IdLookup]
    }

    fn requires_key(&self) -> bool {
        true
    }

    fn configured(&self) -> bool {
        self.key.is_some()
    }

    fn attribution(&self) -> Attribution {
        Attribution {
            provider: ProviderId::Tmdb,
            name: "TMDB",
            url: SITE,
            notice: Some(NOTICE),
            logo_required: true,
            license: None,
        }
    }
}

/// The last page TMDB's discover serves, and how many titles a page has.
pub const DISCOVER_LAST_PAGE: u32 = 500;
const DISCOVER_PAGE_SIZE: usize = 20;

impl TitleSource for Tmdb {
    fn shelf_request(&self, shelf: Shelf, lang: &str) -> Result<Request, ProviderError> {
        let lang = ("language", lang.to_owned());
        let popular = |path| {
            self.get(
                path,
                vec![lang.clone(), ("sort_by", "popularity.desc".into()), ("include_adult", "false".into())],
                CacheKind::Shelf,
            )
        };
        match shelf {
            Shelf::TrendingMovies => self.get("/trending/movie/week", vec![lang.clone()], CacheKind::Shelf),
            Shelf::TrendingSeries => self.get("/trending/tv/week", vec![lang.clone()], CacheKind::Shelf),
            Shelf::PopularMovies => popular("/discover/movie"),
            Shelf::PopularSeries => self.get(
                "/discover/tv",
                vec![
                    lang.clone(),
                    ("sort_by", "popularity.desc".into()),
                    ("include_adult", "false".into()),
                    ("without_genres", discover::NOT_SERIES.iter().map(u32::to_string).collect::<Vec<_>>().join("|")),
                ],
                CacheKind::Shelf,
            ),
            Shelf::PopularCartoons => self.get(
                "/discover/tv",
                vec![
                    lang.clone(),
                    // Not the grid's order (popular): the best rated, among those rated enough.
                    ("sort_by", "vote_average.desc".into()),
                    ("vote_count.gte", "300".into()),
                    ("include_adult", "false".into()),
                    ("with_genres", discover::ANIMATION.to_string()),
                    ("without_keywords", discover::ANIME_KEYWORD.to_string()),
                ],
                CacheKind::Shelf,
            ),
            Shelf::TrendingAnime | Shelf::PopularAnime => Err(ProviderError::Unsupported),
        }
    }

    /// Not one list for TMDB: `/search/multi` ranks films and series together
    /// by popularity, so for a common word ("night") its first page is all
    /// talk shows. Search asks `search_requests` instead.
    fn search_request(&self, _query: &str, _lang: &str) -> Result<Request, ProviderError> {
        Err(ProviderError::Unsupported)
    }

    fn title_request(&self, id: MetaId, lang: &str) -> Result<Request, ProviderError> {
        let path = match id {
            MetaId::TmdbMovie(n) => format!("/movie/{n}"),
            MetaId::TmdbTv(n) => format!("/tv/{n}"),
            MetaId::Anilist(_) => return Err(ProviderError::BadId),
        };
        let primary = lang.split(['-', '_']).next().unwrap_or("en");
        let ratings = if matches!(id, MetaId::TmdbMovie(_)) { "release_dates" } else { "content_ratings" };
        self.get(
            &path,
            vec![
                ("language", lang.to_owned()),
                (
                    "append_to_response",
                    format!("external_ids,images,credits,translations,{ratings},recommendations,similar,videos"),
                ),
                ("include_image_language", format!("{primary},en,null")),
                ("include_video_language", format!("{primary},en,null")),
            ],
            CacheKind::TitleSettled,
        )
    }

    fn season_request(&self, id: MetaId, season: u32, lang: &str) -> Result<Request, ProviderError> {
        match id {
            MetaId::TmdbTv(n) => self.get(
                &format!("/tv/{n}/season/{season}"),
                vec![("language", lang.to_owned())],
                CacheKind::SeasonSettled,
            ),
            _ => Err(ProviderError::Unsupported),
        }
    }

    /// Trending, discover and search results (people are left out).
    fn map_cards(&self, body: &Value, cx: &MapCx) -> Result<Vec<TitleCard>, ProviderError> {
        let results = body.get("results").and_then(Value::as_array).ok_or_else(|| parse_err("no results"))?;
        Ok(results
            .iter()
            .filter_map(|v| {
                let kind = match v.get("media_type").and_then(Value::as_str) {
                    Some("movie") => TitleKind::Movie,
                    Some("tv") => TitleKind::Series,
                    Some(_) => return None,
                    // Discover: one type per list.
                    None if v.get("title").is_some() => TitleKind::Movie,
                    None => TitleKind::Series,
                };
                card(v, kind, cx)
            })
            .collect())
    }

    fn map_title(&self, body: &Value, cx: &MapCx) -> Result<Title, ProviderError> {
        let n = u(body, "id").ok_or_else(|| parse_err("id"))?;
        let movie = body.get("title").is_some() || body.get("release_date").is_some();
        let (kind, meta_id, tmdb_kind) = if movie {
            (TitleKind::Movie, MetaId::TmdbMovie(n), TmdbKind::Movie)
        } else {
            (TitleKind::Series, MetaId::TmdbTv(n), TmdbKind::Tv)
        };
        let (title_field, original_field) = if movie { ("title", "original_title") } else { ("name", "original_name") };
        let title = localized(body, title_field, "name", cx)
            .or_else(|| s(body, original_field))
            .ok_or_else(|| parse_err("title"))?;
        let english_title = english(body, title_field, original_field, cx, &title);
        let ext = body.get("external_ids").unwrap_or(&Value::Null);
        let images = body.get("images").unwrap_or(&Value::Null);
        let posters = ranked(arr(images, "posters"), ImageKind::Poster, cx);
        let backdrops = ranked(arr(images, "backdrops"), ImageKind::Backdrop, cx);
        let logos = ranked(arr(images, "logos"), ImageKind::Logo, cx);
        let credits = body.get("credits").unwrap_or(&Value::Null);

        let mut people: Vec<Credit> = arr(credits, "cast")
            .iter()
            .take(20)
            .enumerate()
            .filter_map(|(i, c)| {
                Some(Credit {
                    person_id: person_id(u(c, "id")?),
                    name: s(c, "name")?,
                    role: CreditRole::Cast,
                    character: s(c, "character"),
                    department: None,
                    job: None,
                    order: u(c, "order").map(|o| o as u32).unwrap_or(i as u32),
                    profile: cx.images.image_at(ImageKind::Profile, c, "profile_path"),
                })
            })
            .collect();
        const JOBS: [&str; 6] = ["Director", "Screenplay", "Writer", "Novel", "Original Music Composer", "Creator"];
        let creators = arr(body, "created_by").iter().map(|c| (c, Some("Writing".to_owned()), "Creator".to_owned()));
        let crew = arr(credits, "crew").iter().filter_map(|c| {
            let job = s(c, "job")?;
            JOBS.contains(&job.as_str()).then(|| (c, s(c, "department"), job))
        });
        for (i, (c, department, job)) in creators.chain(crew).enumerate() {
            let (Some(id), Some(name)) = (u(c, "id"), s(c, "name")) else { continue };
            people.push(Credit {
                person_id: person_id(id),
                name,
                role: CreditRole::Crew,
                character: None,
                department,
                job: Some(job),
                order: i as u32,
                profile: cx.images.image_at(ImageKind::Profile, c, "profile_path"),
            });
        }

        let date_field = if movie { "release_date" } else { "first_air_date" };
        let countries: Vec<String> = if movie {
            arr(body, "production_countries").iter().filter_map(|c| s(c, "iso_3166_1")).collect()
        } else {
            arr(body, "origin_country").iter().filter_map(|c| c.as_str().map(str::to_owned)).collect()
        };
        let studios = arr(body, "networks")
            .iter()
            .chain(arr(body, "production_companies"))
            .filter_map(|c| s(c, "name"))
            .fold(Vec::<String>::new(), |mut acc, n| {
                if !acc.contains(&n) {
                    acc.push(n);
                }
                acc
            });
        let runtime = if movie {
            u(body, "runtime").filter(|r| *r > 0)
        } else {
            arr(body, "episode_run_time")
                .first()
                .and_then(Value::as_u64)
                .or_else(|| body.pointer("/last_episode_to_air/runtime").and_then(Value::as_u64))
        };
        let seasons: Vec<SeasonSummary> = arr(body, "seasons")
            .iter()
            .filter_map(|v| {
                Some(SeasonSummary {
                    number: u(v, "season_number")? as u32,
                    name: s(v, "name"),
                    episode_count: u(v, "episode_count").unwrap_or(0) as u32,
                    air_date: s(v, "air_date"),
                    poster: cx.images.image_at(ImageKind::Poster, v, "poster_path"),
                })
            })
            .collect();
        let path = if movie { "movie" } else { "tv" };

        Ok(Title {
            id: meta_id.to_string(),
            kind,
            anime: None,
            ids: ExternalIds {
                imdb: s(ext, "imdb_id").or_else(|| s(body, "imdb_id")),
                tmdb: Some(TmdbRef { kind: tmdb_kind, id: n }),
                tvdb: u(ext, "tvdb_id"),
                wikidata: s(ext, "wikidata_id"),
                ..Default::default()
            },
            source: ProviderId::Tmdb,
            source_url: format!("{SITE}/{path}/{n}"),
            original_title: s(body, original_field).filter(|o| *o != title),
            english_title,
            title,
            original_language: s(body, "original_language"),
            tagline: localized(body, "tagline", "tagline", cx),
            overview: localized(body, "overview", "overview", cx),
            genres: arr(body, "genres")
                .iter()
                .filter_map(|g| Some(Genre { id: format!("tmdb:{}", u(g, "id")?), name: s(g, "name")? }))
                .collect(),
            release: ReleaseInfo::from_dates(s(body, date_field), if movie { None } else { s(body, "last_air_date") }),
            runtime_minutes: runtime.map(|r| r as u32),
            status: body.get("status").and_then(Value::as_str).and_then(status),
            countries,
            studios,
            poster: named(body, "poster_path", &posters, ImageKind::Poster, cx),
            backdrop: named(body, "backdrop_path", &backdrops, ImageKind::Backdrop, cx),
            logo: logos.first().cloned(),
            backdrops: backdrops.into_iter().take(8).collect(),
            ratings: tmdb_rating(body).into_iter().collect(),
            credits: people,
            season_count: u(body, "number_of_seasons").map(|n| n as u32),
            episode_count: u(body, "number_of_episodes").map(|n| n as u32),
            next_episode: body.get("next_episode_to_air").filter(|v| v.is_object()).and_then(|v| {
                Some(EpisodeRef {
                    season: u(v, "season_number").map(|s| s as u32),
                    number: u(v, "episode_number")? as u32,
                    air_date: s(v, "air_date"),
                    airing_at: None,
                })
            }),
            seasons,
            certifications: certifications(body, movie),
            similar: similar(body, n, kind, cx),
            trailer: trailer(body, cx),
        })
    }
}

/// The age rating of each country: a film's theatrical one (else any its
/// release dates name), a series' content rating. Empty ones are left out.
fn certifications(body: &Value, movie: bool) -> Vec<Certification> {
    let results = |key| body.get(key).map_or(&[][..], |v| arr(v, "results"));
    if movie {
        results("release_dates")
            .iter()
            .filter_map(|c| {
                let dates = arr(c, "release_dates");
                let rating = dates
                    .iter()
                    .filter(|d| u(d, "type") == Some(3))
                    .chain(dates)
                    .find_map(|d| s(d, "certification"))?;
                Some(Certification { country: s(c, "iso_3166_1")?, rating })
            })
            .collect()
    } else {
        results("content_ratings")
            .iter()
            .filter_map(|c| Some(Certification { country: s(c, "iso_3166_1")?, rating: s(c, "rating")? }))
            .collect()
    }
}

/// The trailer to offer (a YouTube watch URL): a YouTube video of type
/// Trailer, else Teaser; official ones first, then in the content language,
/// then English, then any; the newest first.
fn trailer(body: &Value, cx: &MapCx) -> Option<String> {
    let lang = cx.lang_primary();
    let videos = body.get("videos").map_or(&[][..], |v| arr(v, "results"));
    videos
        .iter()
        .filter(|v| v.get("site").and_then(Value::as_str) == Some("YouTube"))
        .filter_map(|v| {
            let kind = match v.get("type").and_then(Value::as_str)? {
                "Trailer" => 0,
                "Teaser" => 1,
                _ => return None,
            };
            let unofficial = v.get("official") != Some(&Value::Bool(true));
            let language = match v.get("iso_639_1").and_then(Value::as_str) {
                Some(l) if l == lang => 0,
                Some("en") => 1,
                _ => 2,
            };
            let published = s(v, "published_at").unwrap_or_default();
            Some(((kind, unofficial, language), published, youtube(&s(v, "key")?)?))
        })
        .min_by(|a, b| a.0.cmp(&b.0).then_with(|| b.1.cmp(&a.1)))
        .map(|(_, _, url)| url)
}

/// How many titles "More like this" lists at most.
const SIMILAR: usize = 12;

/// TMDB's recommendations, else its similar titles (by genre and keywords);
/// the title itself left out.
fn similar(body: &Value, id: u64, kind: TitleKind, cx: &MapCx) -> Vec<TitleCard> {
    let list = |key| -> Vec<TitleCard> {
        body.get(key)
            .map_or(&[][..], |v| arr(v, "results"))
            .iter()
            .filter(|v| u(v, "id") != Some(id))
            .filter_map(|v| {
                let k = match v.get("media_type").and_then(Value::as_str) {
                    Some("movie") => TitleKind::Movie,
                    Some("tv") => TitleKind::Series,
                    Some(_) => return None,
                    None => kind,
                };
                card(v, k, cx)
            })
            .take(SIMILAR)
            .collect()
    };
    let recommended = list("recommendations");
    if recommended.is_empty() { list("similar") } else { recommended }
}

/// Regular episodes before season `n` (TMDB order), when every earlier
/// season is listed.
pub fn absolute_base(seasons: &[SeasonSummary], n: u32) -> Option<u32> {
    if n == 0 {
        return None;
    }
    (1..n).map(|k| seasons.iter().find(|s| s.number == k).map(|s| s.episode_count)).sum::<Option<u32>>()
}

#[cfg(test)]
mod backdrop_sizes {
    #[test]
    fn w500_goes_between_w300_and_w780_once() {
        let v = |x: &[&str]| x.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        assert_eq!(super::with_w500(v(&["w300", "w780", "w1280", "original"])), v(&["w300", "w500", "w780", "w1280", "original"]));
        assert_eq!(super::with_w500(v(&["w300", "w500", "original"])), v(&["w300", "w500", "original"]));
    }
}
