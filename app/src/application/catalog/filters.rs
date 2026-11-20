//! The filters of the browse pages (Movies, Series, Cartoons, Anime): what each one
//! is set to, and what the UI lists in their panels.
//!
//! The state is kept per catalog (films, series, anime), in memory: Shows
//! without a TMDB key browses anime, and shares the Anime page's filters.

use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};

use serde_json::{Value, json};

use super::details::country;
use reel_domain::discover::{ANIMATION, ANIME_FORMATS, COUNTRIES, DECADES, DiscoverKind, Filter, NOT_SERIES, OLDER, Sort};

static FILTERS: LazyLock<Mutex<HashMap<DiscoverKind, Filter>>> = LazyLock::new(Default::default);

/// The catalog a page browses: None for Movies without TMDB.
pub fn page_kind(page: &str, tmdb: bool) -> Option<DiscoverKind> {
    match (page, tmdb) {
        ("anime", _) | ("shows", false) => Some(DiscoverKind::Anime),
        ("movies", true) => Some(DiscoverKind::Movie),
        ("shows", true) => Some(DiscoverKind::Tv),
        ("cartoons", true) => Some(DiscoverKind::Cartoons),
        _ => None,
    }
}

/// What `kind` is filtered by now.
pub fn of(kind: DiscoverKind) -> Filter {
    FILTERS.lock().unwrap().get(&kind).cloned().unwrap_or_default()
}

/// Applies one choice of the UI to `kind` (see `Filter::choose`): whether it changed.
pub fn choose(kind: DiscoverKind, group: &str, id: &str) -> bool {
    FILTERS.lock().unwrap().entry(kind).or_default().choose(group, id)
}

#[cfg(test)]
pub fn clear() {
    FILTERS.lock().unwrap().clear();
}

/// One row of a panel. `name` when a source names it (a genre, a country),
/// else `key` (under `browse.option.*`) with the number `n` it takes.
fn option(id: &str, name: Option<&str>, key: Option<&str>, n: Option<u16>, selected: bool) -> Value {
    json!({ "id": id, "name": name, "key": key, "n": n, "selected": selected })
}

/// The panels of `kind` as the UI lists them: `[{"id":"genres"|"years"|
/// "countries"|"format"|"sort","multi","clear","options":[{"id","name","key","n",
/// "selected"}]}]`. Anime is filtered by its format (series, films, specials) instead of
/// the country: nearly all of it is Japanese. `named` is the filter options' answer (`{"genres":[[id,
/// name]…],"countries":[[code,name]…]}`), None while it is not known: the
/// genres panel is empty then, country names are English.
pub fn groups(kind: DiscoverKind, filter: &Filter, named: Option<&Value>) -> Value {
    let pairs = |field: &str| -> Vec<(String, String)> {
        named
            .and_then(|n| n[field].as_array())
            .map(|list| {
                list.iter()
                    .filter_map(|p| Some((p[0].as_str()?.to_owned(), p[1].as_str()?.to_owned())))
                    .collect()
            })
            .unwrap_or_default()
    };
    // Series offer none of the genres they leave out; Cartoons are Animation already.
    let left_out = |id: &str| match kind {
        DiscoverKind::Tv => id.parse::<u32>().is_ok_and(|g| NOT_SERIES.contains(&g)),
        DiscoverKind::Cartoons => id == ANIMATION.to_string(),
        _ => false,
    };
    let genres: Vec<Value> = pairs("genres")
        .iter()
        .filter(|(id, _)| !left_out(id))
        .map(|(id, name)| option(id, Some(name), None, None, filter.genres.contains(id)))
        .collect();

    let picked_years = filter.years.as_deref();
    let mut years: Vec<Value> = DECADES
        .iter()
        .map(|d| {
            let id = d.to_string();
            option(&id, None, Some("decade"), Some(*d), picked_years == Some(id.as_str()))
        })
        .collect();
    let oldest = DECADES[DECADES.len() - 1];
    years.push(option(OLDER, None, Some("older"), Some(oldest), picked_years == Some(OLDER)));

    let names: HashMap<String, String> = pairs("countries").into_iter().collect();
    let countries: Vec<Value> = COUNTRIES
        .iter()
        .map(|c| {
            let name = names.get(*c).cloned().unwrap_or_else(|| country(c));
            option(c, Some(&name), None, None, filter.country.as_deref() == Some(*c))
        })
        .collect();
    let formats: Vec<Value> = ANIME_FORMATS
        .iter()
        .map(|(id, _)| option(id, None, Some(&format!("format_{id}")), None, filter.format.as_deref() == Some(id)))
        .collect();
    let third = if kind == DiscoverKind::Anime {
        json!({ "id": "format", "multi": false, "clear": true, "options": formats })
    } else {
        json!({ "id": "countries", "multi": false, "clear": true, "options": countries })
    };

    let sorts: Vec<Value> =
        Sort::ALL.iter().map(|s| option(s.as_str(), None, Some(s.as_str()), None, filter.sort == *s)).collect();

    json!([
        { "id": "genres", "multi": true, "clear": true, "options": genres },
        { "id": "years", "multi": false, "clear": true, "options": years },
        third,
        { "id": "sort", "multi": false, "clear": false, "options": sorts },
    ])
}
