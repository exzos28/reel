//! The normalized model the UI renders (research report §4.5), serialized as
//! camelCase JSON. Text fields come from the providers in the language the UI
//! asked for; nothing here is UI wording. Enum values are stable identifiers
//! the UI maps to its own words ("movie", "series", "airing", ...).

use serde::Serialize;

use super::provider::ProviderId;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum TitleKind {
    Movie,
    Series,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum TitleStatus {
    Announced,
    InProduction,
    Airing,
    Ended,
    Canceled,
    Released,
}

/// Anime format as AniList and the ID lists name it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum AnimeFormat {
    Tv,
    TvShort,
    Movie,
    Ova,
    Ona,
    Special,
    Music,
}

impl AnimeFormat {
    pub fn parse(s: &str) -> Option<Self> {
        Some(match s {
            "TV" => Self::Tv,
            "TV_SHORT" => Self::TvShort,
            "MOVIE" => Self::Movie,
            "OVA" => Self::Ova,
            "ONA" => Self::Ona,
            "SPECIAL" => Self::Special,
            "MUSIC" => Self::Music,
            _ => return None,
        })
    }
}

/// TMDB IDs are unique only within a type, so the type travels with the ID.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TmdbRef {
    pub kind: TmdbKind,
    pub id: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum TmdbKind {
    Movie,
    Tv,
    Season,
    Episode,
}

/// IDs of the same thing in other databases. IMDb is an ID only: reel shows
/// no IMDb data.
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalIds {
    pub imdb: Option<String>,
    pub tmdb: Option<TmdbRef>,
    pub tvdb: Option<u64>,
    pub wikidata: Option<String>,
    pub anilist: Option<u64>,
    pub mal: Option<u64>,
    pub anidb: Option<u64>,
    pub kitsu: Option<u64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ImageKind {
    Poster,
    Backdrop,
    Logo,
    Still,
    Profile,
    Banner,
}

/// One size the CDN serves, as a full URL. `width` is None for the original.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageVariant {
    pub size: String,
    pub width: Option<u32>,
    pub url: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Image {
    pub kind: ImageKind,
    pub source: ProviderId,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub aspect: Option<f32>,
    /// Language of the text drawn on the image; None = no text.
    pub lang: Option<String>,
    pub vote: Option<f32>,
    /// "#rrggbb" to paint the tile before the image arrives (AniList gives it).
    pub color: Option<String>,
    /// Smallest first.
    pub variants: Vec<ImageVariant>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum RatingSource {
    Tmdb,
    Anilist,
    Mal,
}

/// A score in its source's own scale (`scale` is 10 or 100): never merged.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Rating {
    pub source: RatingSource,
    pub value: f32,
    pub scale: f32,
    pub votes: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Genre {
    /// "tmdb:18", "anilist:Action".
    pub id: String,
    /// The provider's name for it, in the requested language when it has one.
    pub name: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum CreditRole {
    Cast,
    Crew,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Credit {
    /// "tmdb:person:6384", "anilist:staff:95061".
    pub person_id: String,
    pub name: String,
    pub role: CreditRole,
    pub character: Option<String>,
    pub department: Option<String>,
    pub job: Option<String>,
    pub order: u32,
    pub profile: Option<Image>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseInfo {
    /// "YYYY-MM-DD": the release date of a movie, the first air date of a series.
    pub date: Option<String>,
    pub last_date: Option<String>,
    pub year: Option<u16>,
}

impl ReleaseInfo {
    pub fn from_dates(date: Option<String>, last_date: Option<String>) -> Self {
        let year = date.as_deref().and_then(year_of);
        ReleaseInfo { date, last_date, year }
    }
}

pub fn year_of(date: &str) -> Option<u16> {
    date.get(..4)?.parse().ok()
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EpisodeRef {
    pub season: Option<u32>,
    pub number: u32,
    pub air_date: Option<String>,
    /// Unix seconds when the provider knows the time (AniList).
    pub airing_at: Option<i64>,
}

/// One entry of an anime database that makes up this title: AniList, MAL and
/// AniDB keep one entry per season or cour, TMDB one series.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnimeEntry {
    pub anilist: Option<u64>,
    pub mal: Option<u64>,
    pub anidb: Option<u64>,
    pub kitsu: Option<u64>,
    pub format: Option<AnimeFormat>,
    /// The TMDB season this entry is (0 = specials), from the ID lists.
    pub tmdb_season: Option<u32>,
    /// TMDB episode = offset + episode number within this entry.
    pub episode_offset: Option<u32>,
    pub episodes: Option<u32>,
    /// AniList and MAL scores of this entry (filled for the entries reel fetched).
    pub ratings: Vec<Rating>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnimeInfo {
    pub format: Option<AnimeFormat>,
    /// "winter" | "spring" | "summer" | "fall".
    pub season: Option<String>,
    pub season_year: Option<u16>,
    pub entries: Vec<AnimeEntry>,
    /// The romaji title, the native one, synonyms: for search and release matching.
    pub aliases: Vec<String>,
    pub tags: Vec<String>,
    pub studios: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SeasonSummary {
    pub number: u32,
    pub name: Option<String>,
    pub episode_count: u32,
    pub air_date: Option<String>,
    pub poster: Option<Image>,
}

/// An age rating as a country's board gives it ("R", "TV-14", "16").
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Certification {
    /// ISO 3166-1 ("US", "DE").
    pub country: String,
    pub rating: String,
}

/// A full title card for the details screen.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Title {
    /// Our stable ID ("tmdb:movie:603", "tmdb:tv:1399", "anilist:21").
    pub id: String,
    pub kind: TitleKind,
    /// Some when the title is anime (it is still a movie or a series).
    pub anime: Option<AnimeInfo>,
    pub ids: ExternalIds,
    pub source: ProviderId,
    /// The provider's page for the title (attribution links).
    pub source_url: String,
    pub title: String,
    pub original_title: Option<String>,
    pub original_language: Option<String>,
    pub tagline: Option<String>,
    pub overview: Option<String>,
    pub genres: Vec<Genre>,
    pub release: ReleaseInfo,
    pub runtime_minutes: Option<u32>,
    pub status: Option<TitleStatus>,
    pub countries: Vec<String>,
    pub studios: Vec<String>,
    pub poster: Option<Image>,
    pub backdrop: Option<Image>,
    /// The title's logo (the name drawn as art), in the UI's language when there is one.
    pub logo: Option<Image>,
    /// More backdrops for a slideshow, best first.
    pub backdrops: Vec<Image>,
    pub ratings: Vec<Rating>,
    pub credits: Vec<Credit>,
    pub seasons: Vec<SeasonSummary>,
    pub season_count: Option<u32>,
    pub episode_count: Option<u32>,
    pub next_episode: Option<EpisodeRef>,
    /// Age ratings per country (the UI's region is picked by the catalog).
    pub certifications: Vec<Certification>,
    /// Titles like this one (TMDB recommendations, else similar), best first.
    pub similar: Vec<TitleCard>,
}

/// A title on a shelf or in search results.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TitleCard {
    pub id: String,
    pub kind: TitleKind,
    pub anime: bool,
    pub source: ProviderId,
    pub title: String,
    pub original_title: Option<String>,
    pub overview: Option<String>,
    pub year: Option<u16>,
    pub poster: Option<Image>,
    pub backdrop: Option<Image>,
    pub ratings: Vec<Rating>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum EpisodeKind {
    Regular,
    Special,
}

/// Which anime entry an episode is, and its number there.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnimeEpisodeRef {
    pub anilist: Option<u64>,
    pub anidb: Option<u64>,
    pub number: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Episode {
    /// Coordinate 1: TMDB season and number.
    pub season: u32,
    pub number: u32,
    /// Coordinate 2: the number counted through the regular seasons in TMDB
    /// order, when all earlier seasons are known.
    pub absolute: Option<u32>,
    /// Coordinate 3: the anime entry and the number within it, from the ID lists.
    pub anime: Option<AnimeEpisodeRef>,
    pub kind: EpisodeKind,
    pub name: Option<String>,
    pub overview: Option<String>,
    pub air_date: Option<String>,
    pub runtime_minutes: Option<u32>,
    pub still: Option<Image>,
    pub ratings: Vec<Rating>,
    pub ids: ExternalIds,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Season {
    pub title_id: String,
    pub number: u32,
    pub name: Option<String>,
    pub overview: Option<String>,
    pub air_date: Option<String>,
    pub poster: Option<Image>,
    pub episodes: Vec<Episode>,
    pub ids: ExternalIds,
}

/// A group of search results from one provider.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchSection {
    pub source: ProviderId,
    pub items: Vec<TitleCard>,
}
