//! A search for releases on the user's own source (a Torznab endpoint entered in Settings).

use serde::Deserialize;

/// Where to search: the endpoint (…/api) and its key, if it has one.
#[derive(Debug, Clone, PartialEq)]
pub struct Source {
    pub url: String,
    pub key: Option<String>,
}

/// A search as the UI asks for it (JSON).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Request {
    pub imdb: Option<String>,
    pub title: String,
    /// Other names to try by text when `title` finds nothing to play: the
    /// original title, the title in another language (trackers name releases
    /// "Локализованное / Original").
    #[serde(default)]
    pub alt_titles: Vec<String>,
    pub year: Option<u16>,
    /// Set (with `episode`) for an episode of a show.
    pub season: Option<u16>,
    pub episode: Option<u16>,
    /// A show's episodes per regular season (TMDB's), to read packs numbered through the show
    /// ("S1E1-327 of 327", "S7E121-180"); empty for a film or when not known.
    #[serde(default)]
    pub season_sizes: Vec<u16>,
}
