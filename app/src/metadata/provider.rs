//! What every metadata source shares: its identity and attribution, the
//! errors it reports, and the requests it builds. Providers do no I/O: they
//! build `Request`s and map response bodies to the model, and the service
//! fetches through the cache. That keeps the mapping testable on fixtures.

use serde::Serialize;
use serde_json::{Value, json};

use super::{cache::CacheKind, id::MetaId, model::*, tmdb::ImageConfig};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ProviderId {
    Tmdb,
    Anilist,
    Jikan,
    /// Fribb/anime-lists: the ID mapping between anime databases and TMDB.
    AnimeLists,
}

impl ProviderId {
    pub fn as_str(self) -> &'static str {
        match self {
            ProviderId::Tmdb => "tmdb",
            ProviderId::Anilist => "anilist",
            ProviderId::Jikan => "jikan",
            ProviderId::AnimeLists => "animeLists",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Capability {
    Search,
    Details,
    Seasons,
    Episodes,
    Credits,
    Images,
    Logos,
    Ratings,
    Trending,
    Airing,
    Translations,
    IdLookup,
}

/// What the UI must show for a source (About/Credits screen, badges). The
/// `notice` is the wording the source's terms require, not UI text.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Attribution {
    pub provider: ProviderId,
    pub name: &'static str,
    pub url: &'static str,
    pub notice: Option<&'static str>,
    /// The terms require the source's logo next to the notice (the UI bundles
    /// the official asset).
    pub logo_required: bool,
    pub license: Option<&'static str>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum ProviderError {
    /// No key for a source that needs one.
    NotConfigured,
    /// The key was refused (revoked or wrong): the UI asks for the user's own.
    Unauthorized,
    NotFound,
    /// Too many requests; seconds to wait when the source said.
    RateLimited(Option<u64>),
    Timeout,
    Network(String),
    Http(u16),
    /// The response is not what the mapping expects.
    Parse(String),
    /// The source cannot answer this (a season of an AniList entry).
    Unsupported,
    BadId,
    /// Being fetched in the background; ask again when `revision()` changes.
    Pending,
}

impl ProviderError {
    pub fn kind(&self) -> &'static str {
        match self {
            ProviderError::NotConfigured => "notConfigured",
            ProviderError::Unauthorized => "unauthorized",
            ProviderError::NotFound => "notFound",
            ProviderError::RateLimited(_) => "rateLimited",
            ProviderError::Timeout => "timeout",
            ProviderError::Network(_) => "network",
            ProviderError::Http(_) => "http",
            ProviderError::Parse(_) => "parse",
            ProviderError::Unsupported => "unsupported",
            ProviderError::BadId => "badId",
            ProviderError::Pending => "pending",
        }
    }

    pub fn to_json(&self, provider: Option<ProviderId>) -> Value {
        let message = match self {
            ProviderError::Network(m) | ProviderError::Parse(m) => m.clone(),
            ProviderError::Http(code) => format!("HTTP {code}"),
            ProviderError::RateLimited(Some(s)) => format!("retry in {s} s"),
            _ => String::new(),
        };
        json!({ "kind": self.kind(), "provider": provider.map(ProviderId::as_str), "message": message })
    }
}

pub fn parse_err(what: &str) -> ProviderError {
    ProviderError::Parse(format!("unexpected response: {what}"))
}

pub enum Auth {
    None,
    /// TMDB v4 read access token.
    Bearer(String),
    /// TMDB v3 `api_key` query parameter.
    ApiKey(String),
}

pub enum Call {
    Get { url: String, query: Vec<(String, String)>, auth: Auth },
    Graphql { url: &'static str, query: &'static str, variables: Value },
}

/// One request through the cache. `key` identifies the response in the cache
/// and never contains a credential.
pub struct Request {
    pub provider: ProviderId,
    pub key: String,
    pub kind: CacheKind,
    pub call: Call,
}

/// What mapping needs besides the body.
#[derive(Debug, Clone)]
pub struct MapCx {
    /// The language the UI asked for (BCP 47: "en", "pl-PL").
    pub lang: String,
    pub images: ImageConfig,
}

impl MapCx {
    /// "pl" of "pl-PL".
    pub fn lang_primary(&self) -> &str {
        self.lang.split(['-', '_']).next().unwrap_or("en")
    }
}

/// A shelf the home screen shows.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Shelf {
    TrendingMovies,
    TrendingSeries,
    PopularMovies,
    PopularSeries,
    TrendingAnime,
    PopularAnime,
}

impl Shelf {
    /// The `kind` argument of `Meta.trending`.
    pub fn parse(kind: &str) -> Option<Shelf> {
        Some(match kind {
            "movie" => Shelf::TrendingMovies,
            "tv" => Shelf::TrendingSeries,
            "movie-popular" => Shelf::PopularMovies,
            "tv-popular" => Shelf::PopularSeries,
            "anime" => Shelf::TrendingAnime,
            "anime-popular" => Shelf::PopularAnime,
            _ => return None,
        })
    }
}

pub trait Provider {
    fn id(&self) -> ProviderId;
    fn capabilities(&self) -> &'static [Capability];
    fn requires_key(&self) -> bool;
    /// Whether it can be asked now (has a key when it needs one).
    fn configured(&self) -> bool;
    fn attribution(&self) -> Attribution;
}

/// A source of titles (TMDB, AniList).
pub trait TitleSource: Provider {
    fn shelf_request(&self, shelf: Shelf, lang: &str) -> Result<Request, ProviderError>;
    fn search_request(&self, query: &str, lang: &str) -> Result<Request, ProviderError>;
    fn title_request(&self, id: MetaId, lang: &str) -> Result<Request, ProviderError>;
    fn map_cards(&self, body: &Value, cx: &MapCx) -> Result<Vec<TitleCard>, ProviderError>;
    fn map_title(&self, body: &Value, cx: &MapCx) -> Result<Title, ProviderError>;
    fn season_request(&self, _id: MetaId, _season: u32, _lang: &str) -> Result<Request, ProviderError> {
        Err(ProviderError::Unsupported)
    }
}

// Small JSON helpers shared by the mappings.

pub fn s(v: &Value, key: &str) -> Option<String> {
    v.get(key).and_then(Value::as_str).map(str::trim).filter(|t| !t.is_empty()).map(str::to_owned)
}

pub fn u(v: &Value, key: &str) -> Option<u64> {
    v.get(key).and_then(Value::as_u64)
}

pub fn f(v: &Value, key: &str) -> Option<f64> {
    v.get(key).and_then(Value::as_f64)
}

pub fn arr<'a>(v: &'a Value, key: &str) -> &'a [Value] {
    v.get(key).and_then(Value::as_array).map(Vec::as_slice).unwrap_or(&[])
}
