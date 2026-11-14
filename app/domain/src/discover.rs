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
    /// Series: TMDB's TV without cartoons, kids', reality, talk, news and soaps (`NOT_SERIES`).
    Tv,
    /// Cartoon series: TMDB's TV in Animation, without anime (the Anime page has those).
    Cartoons,
    Anime,
}

/// TMDB's TV genres that are not what the Series page lists: Animation, Kids, News,
/// Reality, Soap, Talk.
pub const NOT_SERIES: [u32; 6] = [16, 10762, 10763, 10764, 10766, 10767];
/// TMDB's TV genre Animation: what the Cartoons page lists.
pub const ANIMATION: u32 = 16;
/// TMDB's keyword "anime": kept out of Cartoons.
pub const ANIME_KEYWORD: u32 = 210024;

impl DiscoverKind {
    pub fn as_str(self) -> &'static str {
        match self {
            DiscoverKind::Movie => "movie",
            DiscoverKind::Tv => "tv",
            DiscoverKind::Cartoons => "cartoons",
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
    use super::*;

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
