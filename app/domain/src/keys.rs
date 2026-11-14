//! What plays, by key: a title id from the metadata ("tmdb:movie:603", "tmdb:tv:1399",
//! "anilist:21"), an episode `<title>:s<season>e<episode>` ("tmdb:tv:1399:s1e2"), or a
//! show's season `<title>:season<n>` (what its releases are searched and chosen for).

/// What plays: a title, or an episode of one.
pub fn episode_key(show: &str, season: u32, episode: u32) -> String {
    format!("{show}:s{season}e{episode}")
}

/// `tmdb:tv:1399:s1e2` → ("tmdb:tv:1399", Some((1, 2))); a title id → (id, None).
pub fn parse_key(key: &str) -> (&str, Option<(u32, u32)>) {
    if let Some((show, ep)) = key.rsplit_once(':')
        && let Some(rest) = ep.strip_prefix('s')
        && let Some((s, e)) = rest.split_once('e')
        && let (Ok(s), Ok(e)) = (s.parse(), e.parse())
    {
        return (show, Some((s, e)));
    }
    (key, None)
}

/// A show's season, as what its releases are searched and chosen for.
pub fn season_key(show: &str, season: u32) -> String {
    format!("{show}:season{season}")
}

/// `tmdb:tv:1399:season2` → ("tmdb:tv:1399", 2).
pub fn parse_season_key(key: &str) -> Option<(&str, u32)> {
    let (show, tail) = key.rsplit_once(':')?;
    Some((show, tail.strip_prefix("season")?.parse().ok()?))
}
