//! TMDB (API v3): the main catalog. Movies, series, seasons and episodes,
//! posters, backdrops, title logos, stills, credits, translations,
//! external IDs (IMDb, TVDB, Wikidata), trending, discover, search.
//!
//! The key is a v4 read access token (sent as a bearer) or a v3 `api_key`
//! (32 hex digits, sent as a query parameter): the user's own, or the project
//! key compiled in from `REEL_TMDB_TOKEN`. Neither is ever in the repo.

use serde_json::Value;

use super::{cache::CacheKind, id::MetaId, model::*, provider::*};

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
            backdrop: v(&["w300", "w780", "w1280", "original"]),
            logo: v(&["w45", "w92", "w154", "w185", "w300", "w500", "original"]),
            still: v(&["w92", "w185", "w300", "original"]),
            profile: v(&["w45", "w185", "h632", "original"]),
        }
    }
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
            backdrop: list("backdrop_sizes")?,
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

    pub fn configuration_request(&self) -> Result<Request, ProviderError> {
        self.get("/configuration", vec![], CacheKind::Config)
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
            Shelf::PopularSeries => popular("/discover/tv"),
            Shelf::TrendingAnime | Shelf::PopularAnime => Err(ProviderError::Unsupported),
        }
    }

    fn search_request(&self, query: &str, lang: &str) -> Result<Request, ProviderError> {
        self.get(
            "/search/multi",
            vec![("query", query.trim().to_owned()), ("language", lang.to_owned()), ("include_adult", "false".into())],
            CacheKind::Search,
        )
    }

    fn title_request(&self, id: MetaId, lang: &str) -> Result<Request, ProviderError> {
        let path = match id {
            MetaId::TmdbMovie(n) => format!("/movie/{n}"),
            MetaId::TmdbTv(n) => format!("/tv/{n}"),
            MetaId::Anilist(_) => return Err(ProviderError::BadId),
        };
        let primary = lang.split(['-', '_']).next().unwrap_or("en");
        self.get(
            &path,
            vec![
                ("language", lang.to_owned()),
                ("append_to_response", "external_ids,images,credits,translations".into()),
                ("include_image_language", format!("{primary},en,null")),
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
                    person_id: format!("tmdb:person:{}", u(c, "id")?),
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
                person_id: format!("tmdb:person:{id}"),
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
        })
    }
}

/// Regular episodes before season `n` (TMDB order), when every earlier
/// season is listed.
pub fn absolute_base(seasons: &[SeasonSummary], n: u32) -> Option<u32> {
    if n == 0 {
        return None;
    }
    (1..n).map(|k| seasons.iter().find(|s| s.number == k).map(|s| s.episode_count)).sum::<Option<u32>>()
}
