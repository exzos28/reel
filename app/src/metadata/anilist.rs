//! AniList (GraphQL, no key): the anime layer. Trending and seasonal charts,
//! romaji/native titles and synonyms, tags, studios, the next airing episode,
//! the AniList score, the MAL ID. Not localized: titles and descriptions are
//! the same whatever language the UI asks for.
//!
//! Terms: non-commercial use, no bulk harvesting, keep under the current
//! limit of 30 requests a minute (the service's limiter for it is 0.5/s).

use serde_json::{Value, json};

use super::{cache::CacheKind, id::MetaId, model::*, provider::*};

pub const API: &str = "https://graphql.anilist.co";
pub const SITE: &str = "https://anilist.co";

const LIST_QUERY: &str = "query ($sort: [MediaSort], $season: MediaSeason, $seasonYear: Int, $search: String) {
  Page(page: 1, perPage: 30) {
    media(type: ANIME, isAdult: false, sort: $sort, season: $season, seasonYear: $seasonYear, search: $search) {
      id idMal format status episodes duration season seasonYear averageScore
      title { romaji english native } synonyms description(asHtml: false)
      coverImage { extraLarge large medium color } bannerImage
      startDate { year month day } endDate { year month day } genres isAdult
    }
  }
}";

const MEDIA_QUERY: &str = "query ($id: Int) {
  Media(id: $id, type: ANIME) {
    id idMal format status episodes duration season seasonYear averageScore
    title { romaji english native } synonyms description(asHtml: false)
    coverImage { extraLarge large medium color } bannerImage
    startDate { year month day } endDate { year month day } genres isAdult
    countryOfOrigin siteUrl trailer { id site }
    tags { name rank isMediaSpoiler }
    studios(isMain: true) { nodes { name } }
    nextAiringEpisode { episode airingAt }
    characters(sort: [ROLE, RELEVANCE], perPage: 12) {
      edges { role node { id name { full } } voiceActors(language: JAPANESE) { id name { full } image { large medium } } }
    }
    staff(sort: [RELEVANCE], perPage: 8) { edges { role node { id name { full } image { large medium } } } }
  }
}";

/// Scores of several entries in one request (up to 50 IDs).
const ENTRIES_QUERY: &str = "query ($ids: [Int]) {
  Page(page: 1, perPage: 50) { media(id_in: $ids, type: ANIME) { id idMal format episodes averageScore } }
}";

pub struct Anilist;

/// One entry of `Anilist::entries_request`'s answer.
#[derive(Debug, Clone, PartialEq)]
pub struct EntryInfo {
    pub anilist: u64,
    pub mal: Option<u64>,
    pub format: Option<AnimeFormat>,
    pub episodes: Option<u32>,
    pub score: Option<Rating>,
}

fn request(key: String, kind: CacheKind, query: &'static str, variables: Value) -> Request {
    Request { provider: ProviderId::Anilist, key, kind, call: Call::Graphql { url: API, query, variables } }
}

/// The anime season of unix time `now`: ("FALL", 2026).
pub fn current_season(now: i64) -> (&'static str, u16) {
    let date = super::cache::date_of(now);
    let year: u16 = date[..4].parse().unwrap_or(2000);
    let month: u8 = date[5..7].parse().unwrap_or(1);
    let season = match month {
        1..=3 => "WINTER",
        4..=6 => "SPRING",
        7..=9 => "SUMMER",
        _ => "FALL",
    };
    (season, year)
}

impl Anilist {
    pub fn entries_request(&self, ids: &[u64]) -> Request {
        let mut ids = ids.to_vec();
        ids.sort_unstable();
        ids.dedup();
        ids.truncate(50);
        let key = format!("anilist:entries:{}", ids.iter().map(u64::to_string).collect::<Vec<_>>().join(","));
        request(key, CacheKind::Rating, ENTRIES_QUERY, json!({ "ids": ids }))
    }

    /// What the batch request tells about each entry.
    pub fn map_entries(&self, body: &Value) -> Result<Vec<EntryInfo>, ProviderError> {
        let media = body.pointer("/data/Page/media").and_then(Value::as_array).ok_or_else(|| parse_err("no media"))?;
        Ok(media
            .iter()
            .filter_map(|m| {
                Some(EntryInfo {
                    anilist: u(m, "id")?,
                    mal: u(m, "idMal"),
                    format: m.get("format").and_then(Value::as_str).and_then(AnimeFormat::parse),
                    episodes: u(m, "episodes").map(|e| e as u32),
                    score: score(m),
                })
            })
            .collect())
    }
}

fn score(m: &Value) -> Option<Rating> {
    Some(Rating { source: RatingSource::Anilist, value: u(m, "averageScore")? as f32, scale: 100.0, votes: None })
}

fn kind_of(m: &Value) -> TitleKind {
    match m.get("format").and_then(Value::as_str) {
        Some("MOVIE") => TitleKind::Movie,
        _ => TitleKind::Series,
    }
}

/// The display title: the official English one when AniList has it,
/// otherwise the romaji one; the native title is `originalTitle`, and every
/// other name goes to `anime.aliases`.
fn display_title(m: &Value) -> Option<String> {
    let t = m.get("title")?;
    s(t, "english").or_else(|| s(t, "romaji")).or_else(|| s(t, "native"))
}

fn date(v: Option<&Value>) -> Option<String> {
    let v = v?;
    let y = u(v, "year")?;
    match (u(v, "month"), u(v, "day")) {
        (Some(m), Some(d)) => Some(format!("{y:04}-{m:02}-{d:02}")),
        _ => None,
    }
}

fn year(m: &Value) -> Option<u16> {
    m.pointer("/startDate/year")
        .and_then(Value::as_u64)
        .map(|y| y as u16)
        .or_else(|| u(m, "seasonYear").map(|y| y as u16))
}

/// AniList descriptions carry `<br>`, `<i>` and entities.
pub fn plain_text(html: &str) -> String {
    let mut out = String::with_capacity(html.len());
    let mut rest = html;
    // Line breaks in the source are whitespace; `<br>` breaks lines.
    let text = |t: &str| t.replace(['\r', '\n'], " ");
    while let Some(start) = rest.find('<') {
        out.push_str(&text(&rest[..start]));
        let Some(end) = rest[start..].find('>') else {
            rest = &rest[start..];
            break;
        };
        let tag = rest[start + 1..start + end].trim().to_ascii_lowercase();
        if tag.starts_with("br") || tag == "/p" {
            out.push('\n');
        }
        rest = &rest[start + end + 1..];
    }
    out.push_str(&text(rest));
    let out = out
        .replace("&amp;", "&")
        .replace("&quot;", "\"")
        .replace("&#039;", "'")
        .replace("&apos;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&mdash;", "—")
        .replace("&ndash;", "–")
        .replace("&nbsp;", " ");
    // At most one empty line between paragraphs.
    let mut text = String::new();
    let mut empty = 0;
    for line in out.lines() {
        if line.trim().is_empty() {
            empty += 1;
            continue;
        }
        if !text.is_empty() {
            text.push_str(if empty > 0 { "\n\n" } else { "\n" });
        }
        empty = 0;
        text.push_str(line.trim());
    }
    text.trim().to_owned()
}

fn cover(m: &Value) -> Option<Image> {
    let c = m.get("coverImage")?;
    let variants: Vec<ImageVariant> = [("medium", 100), ("large", 230), ("extraLarge", 460)]
        .iter()
        .filter_map(|(size, w)| Some(ImageVariant { size: size.to_string(), width: Some(*w), url: s(c, size)? }))
        .collect();
    (!variants.is_empty()).then(|| Image {
        kind: ImageKind::Poster,
        source: ProviderId::Anilist,
        width: None,
        height: None,
        aspect: Some(0.7),
        lang: None,
        vote: None,
        color: s(c, "color"),
        variants,
    })
}

fn banner(m: &Value) -> Option<Image> {
    let url = s(m, "bannerImage")?;
    Some(Image {
        kind: ImageKind::Banner,
        source: ProviderId::Anilist,
        width: Some(1900),
        height: Some(400),
        aspect: Some(4.75),
        lang: None,
        vote: None,
        color: None,
        variants: vec![ImageVariant { size: "original".into(), width: Some(1900), url }],
    })
}

fn aliases(m: &Value, display: &str) -> Vec<String> {
    let t = m.get("title").unwrap_or(&Value::Null);
    let mut out: Vec<String> = Vec::new();
    for name in ["english", "romaji", "native"]
        .iter()
        .filter_map(|k| s(t, k))
        .chain(arr(m, "synonyms").iter().filter_map(|v| v.as_str().map(str::to_owned)))
    {
        if name != display && !out.contains(&name) {
            out.push(name);
        }
    }
    out
}

fn status(m: &Value) -> Option<TitleStatus> {
    Some(match m.get("status")?.as_str()? {
        "FINISHED" => {
            if kind_of(m) == TitleKind::Movie {
                TitleStatus::Released
            } else {
                TitleStatus::Ended
            }
        }
        "RELEASING" => TitleStatus::Airing,
        "NOT_YET_RELEASED" => TitleStatus::Announced,
        "CANCELLED" => TitleStatus::Canceled,
        "HIATUS" => TitleStatus::InProduction,
        _ => return None,
    })
}

pub fn card(m: &Value) -> Option<TitleCard> {
    let id = u(m, "id")?;
    let title = display_title(m)?;
    Some(TitleCard {
        id: MetaId::Anilist(id).to_string(),
        kind: kind_of(m),
        anime: true,
        source: ProviderId::Anilist,
        original_title: m.pointer("/title/native").and_then(Value::as_str).map(str::to_owned).filter(|n| *n != title),
        title,
        overview: s(m, "description").map(|d| plain_text(&d)).filter(|d| !d.is_empty()),
        year: year(m),
        poster: cover(m),
        backdrop: banner(m),
        ratings: score(m).into_iter().collect(),
    })
}

impl Provider for Anilist {
    fn id(&self) -> ProviderId {
        ProviderId::Anilist
    }

    fn capabilities(&self) -> &'static [Capability] {
        use Capability::*;
        &[Search, Details, Credits, Images, Ratings, Trending, Airing]
    }

    fn requires_key(&self) -> bool {
        false
    }

    fn configured(&self) -> bool {
        true
    }

    fn attribution(&self) -> Attribution {
        Attribution {
            provider: ProviderId::Anilist,
            name: "AniList",
            url: SITE,
            notice: None,
            logo_required: false,
            license: None,
        }
    }
}

impl TitleSource for Anilist {
    fn shelf_request(&self, shelf: Shelf, _lang: &str) -> Result<Request, ProviderError> {
        match shelf {
            Shelf::TrendingAnime => Ok(request(
                "anilist:trending".into(),
                CacheKind::Shelf,
                LIST_QUERY,
                json!({ "sort": ["TRENDING_DESC"] }),
            )),
            Shelf::PopularAnime => {
                let (season, year) = current_season(super::cache::now());
                Ok(request(
                    format!("anilist:season:{season}:{year}"),
                    CacheKind::Shelf,
                    LIST_QUERY,
                    json!({ "sort": ["POPULARITY_DESC"], "season": season, "seasonYear": year }),
                ))
            }
            _ => Err(ProviderError::Unsupported),
        }
    }

    fn search_request(&self, query: &str, _lang: &str) -> Result<Request, ProviderError> {
        let q = query.trim();
        Ok(request(
            format!("anilist:search:{}", q.to_lowercase()),
            CacheKind::Search,
            LIST_QUERY,
            json!({ "sort": ["SEARCH_MATCH"], "search": q }),
        ))
    }

    fn title_request(&self, id: MetaId, _lang: &str) -> Result<Request, ProviderError> {
        match id {
            MetaId::Anilist(n) => {
                Ok(request(format!("anilist:media:{n}"), CacheKind::TitleSettled, MEDIA_QUERY, json!({ "id": n })))
            }
            _ => Err(ProviderError::BadId),
        }
    }

    fn map_cards(&self, body: &Value, _cx: &MapCx) -> Result<Vec<TitleCard>, ProviderError> {
        let media = body.pointer("/data/Page/media").and_then(Value::as_array).ok_or_else(|| parse_err("no media"))?;
        Ok(media.iter().filter(|m| m.get("isAdult") != Some(&Value::Bool(true))).filter_map(card).collect())
    }

    fn map_title(&self, body: &Value, _cx: &MapCx) -> Result<Title, ProviderError> {
        let m = body.pointer("/data/Media").filter(|m| m.is_object()).ok_or(ProviderError::NotFound)?;
        let id = u(m, "id").ok_or_else(|| parse_err("id"))?;
        let title = display_title(m).ok_or_else(|| parse_err("title"))?;
        let format = m.get("format").and_then(Value::as_str).and_then(AnimeFormat::parse);
        let mut credits = Vec::new();
        for (i, edge) in arr(m.get("characters").unwrap_or(&Value::Null), "edges").iter().enumerate() {
            let character = edge.pointer("/node/name/full").and_then(Value::as_str).map(str::to_owned);
            for va in arr(edge, "voiceActors").iter().take(1) {
                let (Some(vid), Some(name)) = (u(va, "id"), va.pointer("/name/full").and_then(Value::as_str)) else {
                    continue;
                };
                credits.push(Credit {
                    person_id: format!("anilist:staff:{vid}"),
                    name: name.to_owned(),
                    role: CreditRole::Cast,
                    character: character.clone(),
                    department: None,
                    job: None,
                    order: i as u32,
                    profile: person_image(va),
                });
            }
        }
        for (i, edge) in arr(m.get("staff").unwrap_or(&Value::Null), "edges").iter().enumerate() {
            let (Some(sid), Some(name)) = (
                edge.pointer("/node/id").and_then(Value::as_u64),
                edge.pointer("/node/name/full").and_then(Value::as_str),
            ) else {
                continue;
            };
            credits.push(Credit {
                person_id: format!("anilist:staff:{sid}"),
                name: name.to_owned(),
                role: CreditRole::Crew,
                character: None,
                department: None,
                job: s(edge, "role"),
                order: i as u32,
                profile: edge.get("node").and_then(person_image),
            });
        }
        let ratings: Vec<Rating> = score(m).into_iter().collect();
        let studios: Vec<String> =
            arr(m.get("studios").unwrap_or(&Value::Null), "nodes").iter().filter_map(|n| s(n, "name")).collect();
        let entry = AnimeEntry {
            anilist: Some(id),
            mal: u(m, "idMal"),
            anidb: None,
            kitsu: None,
            format,
            tmdb_season: None,
            episode_offset: None,
            episodes: u(m, "episodes").map(|e| e as u32),
            ratings: ratings.clone(),
        };
        Ok(Title {
            id: MetaId::Anilist(id).to_string(),
            kind: kind_of(m),
            anime: Some(AnimeInfo {
                format,
                season: s(m, "season").map(|s| s.to_lowercase()),
                season_year: u(m, "seasonYear").map(|y| y as u16),
                entries: vec![entry],
                aliases: aliases(m, &title),
                tags: arr(m, "tags")
                    .iter()
                    .filter(|t| t.get("isMediaSpoiler") != Some(&Value::Bool(true)))
                    .filter_map(|t| s(t, "name"))
                    .collect(),
                studios: studios.clone(),
            }),
            ids: ExternalIds { anilist: Some(id), mal: u(m, "idMal"), ..Default::default() },
            source: ProviderId::Anilist,
            source_url: s(m, "siteUrl").unwrap_or_else(|| format!("{SITE}/anime/{id}")),
            original_title: m
                .pointer("/title/native")
                .and_then(Value::as_str)
                .map(str::to_owned)
                .filter(|n| *n != title),
            title,
            original_language: None,
            tagline: None,
            overview: s(m, "description").map(|d| plain_text(&d)).filter(|d| !d.is_empty()),
            genres: arr(m, "genres")
                .iter()
                .filter_map(Value::as_str)
                .map(|g| Genre { id: format!("anilist:{g}"), name: g.to_owned() })
                .collect(),
            release: ReleaseInfo { date: date(m.get("startDate")), last_date: date(m.get("endDate")), year: year(m) },
            runtime_minutes: u(m, "duration").map(|d| d as u32),
            status: status(m),
            countries: s(m, "countryOfOrigin").into_iter().collect(),
            studios,
            poster: cover(m),
            backdrop: banner(m),
            logo: None,
            backdrops: Vec::new(),
            ratings,
            credits,
            seasons: Vec::new(),
            season_count: None,
            episode_count: u(m, "episodes").map(|e| e as u32),
            next_episode: m.get("nextAiringEpisode").filter(|v| v.is_object()).and_then(|v| {
                let airing_at = v.get("airingAt").and_then(Value::as_i64);
                Some(EpisodeRef {
                    season: None,
                    number: u(v, "episode")? as u32,
                    air_date: airing_at.map(super::cache::date_of),
                    airing_at,
                })
            }),
            certifications: Vec::new(),
            similar: Vec::new(),
            trailer: m
                .get("trailer")
                .filter(|t| t.get("site").and_then(Value::as_str) == Some("youtube"))
                .and_then(|t| youtube(&s(t, "id")?)),
        })
    }
}

fn person_image(v: &Value) -> Option<Image> {
    let img = v.get("image")?;
    let variants: Vec<ImageVariant> = [("medium", 100), ("large", 230)]
        .iter()
        .filter_map(|(size, w)| Some(ImageVariant { size: size.to_string(), width: Some(*w), url: s(img, size)? }))
        .collect();
    (!variants.is_empty()).then_some(Image {
        kind: ImageKind::Profile,
        source: ProviderId::Anilist,
        width: None,
        height: None,
        aspect: None,
        lang: None,
        vote: None,
        color: None,
        variants,
    })
}
