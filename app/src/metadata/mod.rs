//! The metadata layer: titles, seasons, episodes, images, ratings and IDs
//! from TMDB (catalog), AniList (anime) and Jikan (MAL score), tied together
//! by the Fribb anime ID lists, behind a SQLite cache. The UI gets
//! normalized, UI-ready JSON (`model`) and only renders it.
//!
//! IMDb is not a source: its IDs (`tt…`) are kept for cross-referencing, no
//! IMDb data is shown (research report §1).
//!
//! **How calls run.** The data calls (`trending`, `title`, `season`,
//! `search`) are `async`: JS gets a Promise and the UI thread never waits.
//! The work runs on this layer's own tokio runtime. A call answers from the
//! cache at once when it has the response, fresh or stale; a stale answer
//! (`"stale": true`) also starts a refresh in the background, and when a
//! refresh stores something new `revision()` goes up, so the UI can poll
//! `revision()` and ask again. Only a cache miss waits for the network,
//! bounded by the timeouts and rate limits in `http`.
//!
//! Every data call resolves to
//! `{"data": …|null, "stale": bool, "fetchedAt": unix seconds|null,
//!   "error": null|{"kind","provider","message"}, "warnings": [{"kind","provider","message"}],
//!   "revision": n}`.
//! `error` is set when there is no data; `warnings` lists the parts that
//! failed while the rest came through (an AniList score, say). The MAL score
//! (Jikan) never holds a call: when it is not cached yet the warning is
//! `{"kind":"pending","provider":"jikan"}`, it is fetched in the background
//! and `revision()` goes up when it lands.

pub mod anilist;
pub mod animemap;
pub mod cache;
pub mod http;
pub mod id;
pub mod jikan;
pub mod model;
pub mod provider;
pub mod tmdb;

#[cfg(test)]
mod tests;

use std::{
    collections::HashSet,
    future::Future,
    path::Path,
    sync::{
        Mutex, OnceLock,
        atomic::{AtomicBool, AtomicI64, AtomicU64, Ordering},
    },
    time::Duration,
};

use serde_json::{Value, json};
use tokio::runtime::Runtime;

use anilist::Anilist;
use animemap::AnimeIds;
use cache::{Cache, Freshness, freshness, now};
use http::Limiter;
use id::MetaId;
use jikan::Jikan;
use model::*;
use provider::*;
use tmdb::{ImageConfig, Tmdb};

struct Service {
    rt: Runtime,
    http: reqwest::Client,
    cache: Mutex<Cache>,
    persistent: AtomicBool,
    /// The user's own TMDB key (in memory; settings will persist it).
    tmdb_user_key: Mutex<Option<String>>,
    tmdb_limit: Limiter,
    anilist_limit: Limiter,
    jikan_limit: Limiter,
    revision: AtomicU64,
    refreshing: Mutex<HashSet<String>>,
    lists_updating: AtomicBool,
    /// When the last download of the anime lists failed (to wait before the next try).
    lists_failed_at: AtomicI64,
}

static SERVICE: OnceLock<Service> = OnceLock::new();

fn service() -> &'static Service {
    SERVICE.get_or_init(|| Service {
        rt: tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .thread_name("reel-meta")
            .enable_all()
            .build()
            .expect("metadata runtime"),
        http: http::client(),
        cache: Mutex::new(Cache::memory()),
        persistent: AtomicBool::new(false),
        tmdb_user_key: Mutex::new(None),
        // TMDB allows about 40 a second per IP; stay well below.
        tmdb_limit: Limiter::new(20.0, 20.0),
        // AniList: 30 a minute while it is "degraded".
        anilist_limit: Limiter::new(0.5, 2.0),
        // Jikan: 60 a minute, 3 a second.
        jikan_limit: Limiter::new(1.0, 3.0),
        revision: AtomicU64::new(0),
        refreshing: Mutex::new(HashSet::new()),
        lists_updating: AtomicBool::new(false),
        lists_failed_at: AtomicI64::new(0),
    })
}

/// Where the TMDB key in use comes from.
#[derive(Clone, Copy, PartialEq, Eq)]
enum KeySource {
    User,
    Build,
}

impl Service {
    /// The user's key when they gave one, else the project key compiled in.
    fn tmdb_key(&self) -> Option<(String, KeySource)> {
        if let Some(k) = self.tmdb_user_key.lock().unwrap().clone() {
            return Some((k, KeySource::User));
        }
        tmdb::build_key().map(|k| (k.to_owned(), KeySource::Build))
    }

    fn tmdb(&self) -> Tmdb {
        Tmdb::new(self.tmdb_key().map(|(k, _)| k))
    }

    fn limiter(&self, provider: ProviderId) -> &Limiter {
        match provider {
            ProviderId::Tmdb => &self.tmdb_limit,
            ProviderId::Anilist => &self.anilist_limit,
            ProviderId::Jikan | ProviderId::AnimeLists => &self.jikan_limit,
        }
    }

    fn revision(&self) -> u64 {
        self.revision.load(Ordering::Relaxed)
    }
}

/// A response with when it was fetched.
struct Got {
    body: Value,
    fetched_at: i64,
    stale: bool,
}

/// Freshness of what a call put together from several responses.
#[derive(Default)]
struct Age {
    fetched_at: Option<i64>,
    stale: bool,
    warnings: Vec<Value>,
}

impl Age {
    fn add(&mut self, got: &Got) {
        self.stale |= got.stale;
        self.fetched_at = Some(self.fetched_at.map_or(got.fetched_at, |t| t.min(got.fetched_at)));
    }

    fn warn(&mut self, provider: ProviderId, e: &ProviderError) {
        if *e != ProviderError::Pending {
            eprintln!("reel meta: {}: {e:?}", provider.as_str());
        }
        self.warnings.push(e.to_json(Some(provider)));
    }
}

async fn fetch_store(req: &Request) -> Result<Got, ProviderError> {
    let svc = service();
    let body = http::fetch(&svc.http, svc.limiter(req.provider), &req.call).await?;
    let now = now();
    let kind = req.kind.refine(&body, now);
    svc.cache.lock().unwrap().put(&req.key, req.provider, kind, &body, now);
    Ok(Got { body, fetched_at: now, stale: false })
}

/// Stale-while-revalidate: the cached response when there is one (a stale
/// one starts a refresh), the network otherwise.
async fn cached(req: Request) -> Result<Got, ProviderError> {
    let svc = service();
    let now = now();
    let entry = svc.cache.lock().unwrap().get(&req.key, now);
    if let Some(e) = entry {
        let stale = freshness(e.kind, e.fetched_at, now) != Freshness::Fresh;
        if stale {
            refresh_in_background(req);
        }
        return Ok(Got { body: e.body, fetched_at: e.fetched_at, stale });
    }
    fetch_store(&req).await
}

/// For data a title can show without (the MAL score): the cached response,
/// or `Pending` while it is fetched in the background; `revision()` goes up
/// when it lands. Keeps a slow source from holding the whole call.
fn cached_or_later(req: Request) -> Result<Got, ProviderError> {
    let now = now();
    let entry = service().cache.lock().unwrap().get(&req.key, now);
    match entry {
        Some(e) => {
            let stale = freshness(e.kind, e.fetched_at, now) != Freshness::Fresh;
            if stale {
                refresh_in_background(req);
            }
            Ok(Got { body: e.body, fetched_at: e.fetched_at, stale })
        }
        None => {
            refresh_in_background(req);
            Err(ProviderError::Pending)
        }
    }
}

fn refresh_in_background(req: Request) {
    let svc = service();
    if !svc.refreshing.lock().unwrap().insert(req.key.clone()) {
        return;
    }
    svc.rt.spawn(async move {
        match fetch_store(&req).await {
            Ok(_) => {
                svc.revision.fetch_add(1, Ordering::Relaxed);
            }
            Err(e) => eprintln!("reel meta: refreshing {}: {e:?}", req.key),
        }
        svc.refreshing.lock().unwrap().remove(&req.key);
    });
}

/// Runs `work` on the metadata runtime; the JS side awaits it.
async fn run<F>(work: F) -> String
where
    F: Future<Output = Result<(Value, Age), (ProviderError, Option<ProviderId>)>> + Send + 'static,
{
    let svc = service();
    ensure_anime_lists();
    let result = match svc.rt.spawn(work).await {
        Ok(result) => result,
        Err(e) => Err((ProviderError::Network(format!("task failed: {e}")), None)),
    };
    envelope(result, svc.revision()).to_string()
}

fn envelope(result: Result<(Value, Age), (ProviderError, Option<ProviderId>)>, revision: u64) -> Value {
    match result {
        Ok((data, age)) => json!({
            "data": data,
            "stale": age.stale,
            "fetchedAt": age.fetched_at,
            "error": null,
            "warnings": age.warnings,
            "revision": revision,
        }),
        Err((e, provider)) => json!({
            "data": null,
            "stale": false,
            "fetchedAt": null,
            "error": e.to_json(provider),
            "warnings": [],
            "revision": revision,
        }),
    }
}

async fn image_config(age: &mut Age) -> ImageConfig {
    let Ok(req) = service().tmdb().configuration_request() else { return ImageConfig::default() };
    match cached(req).await.and_then(|got| ImageConfig::from_configuration(&got.body)) {
        Ok(config) => config,
        Err(e) => {
            // The sizes TMDB has served for years work until it answers.
            age.warn(ProviderId::Tmdb, &e);
            ImageConfig::default()
        }
    }
}

async fn map_cx(lang: &str, age: &mut Age, with_tmdb: bool) -> MapCx {
    let images =
        if with_tmdb && service().tmdb().configured() { image_config(age).await } else { ImageConfig::default() };
    MapCx { lang: lang.to_owned(), images }
}

// ---- Anime ID lists ----------------------------------------------------

fn lists_lookup<R>(f: impl FnOnce(&rusqlite::Connection) -> R) -> R {
    let mut cache = service().cache.lock().unwrap();
    f(cache.conn())
}

/// Starts a download of the anime lists when they are a day old (or missing).
fn ensure_anime_lists() {
    let svc = service();
    let now = now();
    let fetched_at: i64 =
        svc.cache.lock().unwrap().meta("animeLists.fetchedAt").and_then(|t| t.parse().ok()).unwrap_or(0);
    let failed_at = svc.lists_failed_at.load(Ordering::Relaxed);
    if now - fetched_at < animemap::REFRESH || now - failed_at < cache::HOUR {
        return;
    }
    if svc.lists_updating.swap(true, Ordering::AcqRel) {
        return;
    }
    svc.rt.spawn(async move {
        match download_anime_lists().await {
            Ok(changed) => {
                if changed {
                    svc.revision.fetch_add(1, Ordering::Relaxed);
                }
            }
            Err(e) => {
                eprintln!("reel meta: anime lists: {e}");
                svc.lists_failed_at.store(cache::now(), Ordering::Relaxed);
            }
        }
        svc.lists_updating.store(false, Ordering::Release);
    });
}

/// Downloads `anime-list-full.json` unless it did not change (ETag); whether
/// the rows changed.
async fn download_anime_lists() -> Result<bool, String> {
    let svc = service();
    let (etag, rows) = {
        let mut cache = svc.cache.lock().unwrap();
        let etag = cache.meta("animeLists.etag");
        (etag, animemap::count(cache.conn()))
    };
    let mut request = svc.http.get(animemap::URL).timeout(Duration::from_secs(120));
    if let (Some(etag), true) = (&etag, rows > 0) {
        request = request.header("If-None-Match", etag.as_str());
    }
    let response = request.send().await.map_err(|e| e.without_url().to_string())?;
    let status = response.status();
    let new_etag = response.headers().get("etag").and_then(|v| v.to_str().ok()).map(str::to_owned);
    if status.as_u16() == 304 {
        svc.cache.lock().unwrap().set_meta("animeLists.fetchedAt", &now().to_string());
        return Ok(false);
    }
    if !status.is_success() {
        return Err(format!("HTTP {status}"));
    }
    let bytes = response.bytes().await.map_err(|e| e.without_url().to_string())?;
    let rows = tokio::task::spawn_blocking(move || animemap::parse(&bytes))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| format!("parse: {e}"))?;
    if rows.is_empty() {
        return Err("empty list".into());
    }
    let mut cache = svc.cache.lock().unwrap();
    animemap::replace(cache.conn(), &rows).map_err(|e| e.to_string())?;
    cache.set_meta("animeLists.fetchedAt", &now().to_string());
    if let Some(etag) = new_etag {
        cache.set_meta("animeLists.etag", &etag);
    }
    eprintln!("reel meta: anime lists: {} entries", rows.len());
    Ok(true)
}

fn tmdb_ref(id: MetaId) -> Option<TmdbRef> {
    match id {
        MetaId::TmdbMovie(n) => Some(TmdbRef { kind: TmdbKind::Movie, id: n }),
        MetaId::TmdbTv(n) => Some(TmdbRef { kind: TmdbKind::Tv, id: n }),
        MetaId::Anilist(_) => None,
    }
}

fn kind_of(id: MetaId) -> TitleKind {
    match id {
        MetaId::TmdbMovie(_) => TitleKind::Movie,
        _ => TitleKind::Series,
    }
}

/// AniList cards become the TMDB title their entry belongs to (when TMDB is
/// configured and the lists name exactly one), so an anime shows up once.
fn canonicalize(cards: Vec<TitleCard>, tmdb_on: bool) -> Vec<TitleCard> {
    let mut seen = HashSet::new();
    cards
        .into_iter()
        .map(|mut card| {
            if tmdb_on
                && let Some(MetaId::Anilist(n)) = MetaId::parse(&card.id)
                && let Some(target) = lists_lookup(|c| animemap::by_anilist(c, n)).and_then(|r| r.canonical())
            {
                card.id = target.to_string();
                card.kind = kind_of(target);
            }
            card
        })
        .filter(|card| seen.insert(card.id.clone()))
        .collect()
}

/// Marks TMDB cards whose title is in the anime lists.
fn mark_anime(cards: &mut [TitleCard]) {
    for card in cards.iter_mut() {
        if let Some(id @ (MetaId::TmdbMovie(_) | MetaId::TmdbTv(_))) = MetaId::parse(&card.id) {
            card.anime = !lists_lookup(|c| animemap::by_tmdb(c, id)).is_empty();
        }
    }
}

// ---- The calls ---------------------------------------------------------

type CallResult = Result<(Value, Age), (ProviderError, Option<ProviderId>)>;

async fn trending_work(kind: String, lang: String) -> CallResult {
    let shelf = Shelf::parse(&kind).ok_or((ProviderError::Unsupported, None))?;
    let svc = service();
    let mut age = Age::default();
    let anime = matches!(shelf, Shelf::TrendingAnime | Shelf::PopularAnime);
    let cx = map_cx(&lang, &mut age, !anime).await;
    let items = if anime {
        let src = Anilist;
        let req = src.shelf_request(shelf, &lang).map_err(|e| (e, Some(ProviderId::Anilist)))?;
        let got = cached(req).await.map_err(|e| (e, Some(ProviderId::Anilist)))?;
        age.add(&got);
        let cards = src.map_cards(&got.body, &cx).map_err(|e| (e, Some(ProviderId::Anilist)))?;
        canonicalize(cards, svc.tmdb().configured())
    } else {
        let src = svc.tmdb();
        let req = src.shelf_request(shelf, &lang).map_err(|e| (e, Some(ProviderId::Tmdb)))?;
        let got = cached(req).await.map_err(|e| (e, Some(ProviderId::Tmdb)))?;
        age.add(&got);
        let mut cards = src.map_cards(&got.body, &cx).map_err(|e| (e, Some(ProviderId::Tmdb)))?;
        mark_anime(&mut cards);
        cards
    };
    Ok((json!({ "items": items }), age))
}

/// The AniList scores of `entries` (one batched request) and the MAL score
/// of the primary one (Jikan), written into the entries.
async fn entry_ratings(entries: &mut [AnimeEntry], primary: usize, age: &mut Age) {
    let ids: Vec<u64> = entries.iter().filter_map(|e| e.anilist).collect();
    if !ids.is_empty() {
        let src = Anilist;
        match cached(src.entries_request(&ids)).await.and_then(|got| {
            age.add(&got);
            src.map_entries(&got.body)
        }) {
            Ok(found) => {
                for info in found {
                    if let Some(e) = entries.iter_mut().find(|e| e.anilist == Some(info.anilist)) {
                        // The same entry's IDs from two sources: the lists' when they have one.
                        e.mal = e.mal.or(info.mal);
                        e.format = e.format.or(info.format);
                        e.episodes = info.episodes;
                        e.ratings.extend(info.score);
                    }
                }
            }
            Err(e) => age.warn(ProviderId::Anilist, &e),
        }
    }
    if let Some(mal) = entries.get(primary).and_then(|e| e.mal) {
        let src = Jikan;
        match cached_or_later(src.anime_request(mal)).and_then(|got| {
            age.add(&got);
            src.map_score(&got.body)
        }) {
            Ok(score) => entries[primary].ratings.extend(score),
            Err(e) => age.warn(ProviderId::Jikan, &e),
        }
    }
}

/// The entry whose scores the title shows: the first regular one in TMDB
/// order (season ≥ 1, lowest offset), else the first.
pub fn primary_entry(entries: &[AnimeEntry]) -> usize {
    entries.iter().position(|e| e.tmdb_season.is_some_and(|s| s >= 1)).unwrap_or(0)
}

/// Adds the anime layer to a TMDB title: entries with their scores, and
/// from the primary entry's AniList record the aliases, tags, studios and
/// airing season. TMDB keeps the text in the UI's language, the images, the
/// seasons and the episode numbering; ratings stay one per source.
pub fn merge_anime(mut title: Title, mut entries: Vec<AnimeEntry>, primary: usize, anilist: Option<Title>) -> Title {
    if let Some(p) = entries.get(primary) {
        title.ratings.extend(p.ratings.iter().cloned());
        title.ids.anilist = p.anilist;
        title.ids.mal = p.mal;
        title.ids.anidb = p.anidb;
        title.ids.kitsu = p.kitsu;
    }
    let (format, season, season_year, mut aliases, tags, studios) = match anilist.and_then(|t| {
        let display = t.title.clone();
        t.anime.map(|a| (display, a))
    }) {
        Some((display, a)) => (
            a.format,
            a.season,
            a.season_year,
            {
                let mut v = vec![display];
                v.extend(a.aliases);
                v
            },
            a.tags,
            a.studios,
        ),
        None => (entries.get(primary).and_then(|e| e.format), None, None, Vec::new(), Vec::new(), Vec::new()),
    };
    aliases.retain(|a| *a != title.title);
    aliases.dedup();
    for e in entries.iter_mut() {
        e.ratings.dedup();
    }
    title.anime = Some(AnimeInfo { format, season, season_year, entries, aliases, tags, studios });
    title
}

async fn tmdb_title(
    id: MetaId,
    lang: &str,
    age: &mut Age,
) -> Result<(Title, MapCx), (ProviderError, Option<ProviderId>)> {
    let src = service().tmdb();
    let cx = map_cx(lang, age, true).await;
    let req = src.title_request(id, lang).map_err(|e| (e, Some(ProviderId::Tmdb)))?;
    let got = cached(req).await.map_err(|e| (e, Some(ProviderId::Tmdb)))?;
    age.add(&got);
    let title = src.map_title(&got.body, &cx).map_err(|e| (e, Some(ProviderId::Tmdb)))?;
    Ok((title, cx))
}

async fn title_work(id: String, lang: String) -> CallResult {
    let id = MetaId::parse(&id).ok_or((ProviderError::BadId, None))?;
    let tmdb_on = service().tmdb().configured();
    let mut age = Age::default();

    // An AniList entry the lists tie to one TMDB title is that title.
    let (id, row) = match id {
        MetaId::Anilist(n) => {
            let row = lists_lookup(|c| animemap::by_anilist(c, n));
            match row.as_ref().and_then(AnimeIds::canonical) {
                Some(target) if tmdb_on => (target, None),
                _ => (id, row),
            }
        }
        other => (other, None),
    };

    let title = match id {
        MetaId::Anilist(_) => {
            let src = Anilist;
            let cx = map_cx(&lang, &mut age, false).await;
            let got = cached(src.title_request(id, &lang).map_err(|e| (e, Some(ProviderId::Anilist)))?)
                .await
                .map_err(|e| (e, Some(ProviderId::Anilist)))?;
            age.add(&got);
            let mut title = src.map_title(&got.body, &cx).map_err(|e| (e, Some(ProviderId::Anilist)))?;
            if let Some(row) = &row {
                title.ids.anidb = row.anidb;
                title.ids.kitsu = row.kitsu;
                title.ids.tvdb = row.tvdb;
                title.ids.imdb = row.imdb_single();
                title.ids.tmdb = row.canonical().and_then(tmdb_ref);
            }
            if let Some(anime) = title.anime.as_mut() {
                if let Some(row) = &row {
                    let entry = &mut anime.entries[0];
                    entry.anidb = row.anidb;
                    entry.kitsu = row.kitsu;
                    entry.tmdb_season = row.tmdb_season;
                    entry.episode_offset = row.tmdb_offset;
                }
                let mal = anime.entries[0].mal;
                if let Some(mal) = mal {
                    let src = Jikan;
                    match cached_or_later(src.anime_request(mal)).and_then(|got| {
                        age.add(&got);
                        src.map_score(&got.body)
                    }) {
                        Ok(Some(score)) => {
                            anime.entries[0].ratings.push(score.clone());
                            title.ratings.push(score);
                        }
                        Ok(None) => {}
                        Err(e) => age.warn(ProviderId::Jikan, &e),
                    }
                }
            }
            title
        }
        tmdb_id => {
            let (title, cx) = tmdb_title(tmdb_id, &lang, &mut age).await?;
            let rows = lists_lookup(|c| animemap::by_tmdb(c, tmdb_id));
            if rows.is_empty() {
                title
            } else {
                let mut entries: Vec<AnimeEntry> = rows.iter().map(AnimeIds::entry).collect();
                let primary = primary_entry(&entries);
                entry_ratings(&mut entries, primary, &mut age).await;
                let anilist = match entries[primary].anilist {
                    Some(n) => {
                        let src = Anilist;
                        match cached(src.title_request(MetaId::Anilist(n), &lang).expect("an AniList ID"))
                            .await
                            .and_then(|got| {
                                age.add(&got);
                                src.map_title(&got.body, &cx)
                            }) {
                            Ok(t) => Some(t),
                            Err(e) => {
                                age.warn(ProviderId::Anilist, &e);
                                None
                            }
                        }
                    }
                    None => None,
                };
                merge_anime(title, entries, primary, anilist)
            }
        }
    };
    Ok((serde_json::to_value(title).expect("plain data"), age))
}

async fn season_work(id: String, season: u32, lang: String) -> CallResult {
    let parsed = MetaId::parse(&id).ok_or((ProviderError::BadId, None))?;
    let id = match parsed {
        MetaId::Anilist(n) => lists_lookup(|c| animemap::by_anilist(c, n))
            .and_then(|r| r.canonical())
            .filter(|c| matches!(c, MetaId::TmdbTv(_)))
            .ok_or((ProviderError::Unsupported, Some(ProviderId::Anilist)))?,
        MetaId::TmdbMovie(_) => return Err((ProviderError::Unsupported, Some(ProviderId::Tmdb))),
        tv => tv,
    };
    let mut age = Age::default();
    let (title, cx) = tmdb_title(id, &lang, &mut age).await?;
    let src = service().tmdb();
    let req = src.season_request(id, season, &lang).map_err(|e| (e, Some(ProviderId::Tmdb)))?;
    let got = cached(req).await.map_err(|e| (e, Some(ProviderId::Tmdb)))?;
    age.add(&got);
    let entries: Vec<AnimeEntry> = lists_lookup(|c| animemap::by_tmdb(c, id)).iter().map(AnimeIds::entry).collect();
    let base = tmdb::absolute_base(&title.seasons, season);
    let season = src.map_season(&got.body, &cx, &title.id, base, &entries).map_err(|e| (e, Some(ProviderId::Tmdb)))?;
    Ok((serde_json::to_value(season).expect("plain data"), age))
}

async fn search_work(query: String, lang: String) -> CallResult {
    let mut age = Age::default();
    if query.trim().is_empty() {
        return Ok((json!({ "sections": [] }), age));
    }
    let tmdb = service().tmdb();
    let tmdb_on = tmdb.configured();
    let cx = map_cx(&lang, &mut age, true).await;
    let tmdb_req = tmdb.search_request(&query, &lang);
    let anilist_req = Anilist.search_request(&query, &lang);
    let tmdb_fut = async {
        match tmdb_req {
            Ok(req) => Some(cached(req).await),
            Err(_) => None,
        }
    };
    let anilist_fut = async {
        match anilist_req {
            Ok(req) => Some(cached(req).await),
            Err(_) => None,
        }
    };
    let (tmdb_got, anilist_got) = tokio::join!(tmdb_fut, anilist_fut);

    let mut sections = Vec::new();
    let mut failures = Vec::new();
    let mut tmdb_cards = Vec::new();
    match tmdb_got.map(|r| {
        r.and_then(|got| {
            age.add(&got);
            tmdb.map_cards(&got.body, &cx)
        })
    }) {
        Some(Ok(mut cards)) => {
            mark_anime(&mut cards);
            tmdb_cards = cards;
        }
        Some(Err(e)) => failures.push((e, ProviderId::Tmdb)),
        None => {}
    }
    let mut anime_cards = Vec::new();
    match anilist_got.map(|r| {
        r.and_then(|got| {
            age.add(&got);
            Anilist.map_cards(&got.body, &cx)
        })
    }) {
        Some(Ok(cards)) => {
            // An anime TMDB already found is not listed twice.
            let found: HashSet<String> = tmdb_cards.iter().map(|c| c.id.clone()).collect();
            anime_cards = canonicalize(cards, tmdb_on).into_iter().filter(|c| !found.contains(&c.id)).collect();
        }
        Some(Err(e)) => failures.push((e, ProviderId::Anilist)),
        None => {}
    }
    if tmdb_cards.is_empty()
        && anime_cards.is_empty()
        && let Some((e, p)) = failures.first()
    {
        return Err((e.clone(), Some(*p)));
    }
    for (e, p) in &failures {
        age.warn(*p, e);
    }
    if tmdb_on {
        sections.push(SearchSection { source: ProviderId::Tmdb, items: tmdb_cards });
    }
    sections.push(SearchSection { source: ProviderId::Anilist, items: anime_cards });
    Ok((json!({ "sections": sections }), age))
}

// ---- What `lib.rs` exposes --------------------------------------------

/// Opens the cache in `data_dir` (None: in memory until the app closes),
/// drops what is past six months and starts the anime lists download when
/// they are due. The status.
pub fn init(data_dir: Option<&Path>) -> Value {
    let svc = service();
    match data_dir.map(|d| Cache::open(&d.join("metadata.sqlite"))) {
        Some(Ok(cache)) => {
            cache.purge(now());
            *svc.cache.lock().unwrap() = cache;
            svc.persistent.store(true, Ordering::Relaxed);
        }
        Some(Err(e)) => eprintln!("reel meta: opening the cache: {e}; keeping it in memory"),
        None => eprintln!("reel meta: no data directory, the cache lasts until the app closes"),
    }
    ensure_anime_lists();
    status()
}

/// Sets the user's own TMDB key (v4 read access token or v3 key); empty
/// clears it, and the project key, if the build has one, is used again.
pub fn set_tmdb_key(key: &str) -> Value {
    let key = key.trim();
    *service().tmdb_user_key.lock().unwrap() = (!key.is_empty()).then(|| key.to_owned());
    status()
}

pub fn status() -> Value {
    let svc = service();
    let key = svc.tmdb_key().map(|(_, source)| match source {
        KeySource::User => "user",
        KeySource::Build => "build",
    });
    let (entries, fetched_at) = {
        let mut cache = svc.cache.lock().unwrap();
        let fetched: Option<i64> = cache.meta("animeLists.fetchedAt").and_then(|t| t.parse().ok());
        (animemap::count(cache.conn()), fetched)
    };
    let describe = |p: &dyn Provider| json!({ "configured": p.configured(), "requiresKey": p.requires_key(), "capabilities": p.capabilities() });
    let mut tmdb = describe(&svc.tmdb());
    tmdb["key"] = json!(key);
    let mut out = json!({ "tmdb": tmdb });
    for p in [&Anilist as &dyn Provider, &Jikan] {
        out[p.id().as_str()] = describe(p);
    }
    out["animeLists"] = json!({
        "entries": entries,
        "fetchedAt": fetched_at,
        "updating": svc.lists_updating.load(Ordering::Relaxed),
    });
    out["cache"] = json!({ "persistent": svc.persistent.load(Ordering::Relaxed) });
    out["revision"] = json!(svc.revision());
    out
}

pub fn revision() -> u64 {
    service().revision()
}

/// What the UI must show for each source (About/Credits).
pub fn attribution() -> Value {
    let lists = Attribution {
        provider: ProviderId::AnimeLists,
        name: "Fribb/anime-lists",
        url: "https://github.com/Fribb/anime-lists",
        notice: None,
        logo_required: false,
        license: None,
    };
    json!([service().tmdb().attribution(), Anilist.attribution(), Jikan.attribution(), lists])
}

pub async fn trending(kind: String, language: String) -> String {
    run(trending_work(kind, language)).await
}

pub async fn title(id: String, language: String) -> String {
    run(title_work(id, language)).await
}

pub async fn season(id: String, season: u32, language: String) -> String {
    run(season_work(id, season, language)).await
}

pub async fn search(query: String, language: String) -> String {
    run(search_work(query, language)).await
}

// ---- The NSH module ----------------------------------------------------

use nsh_core::prelude::*;

/// Movie, series and anime metadata: TMDB, AniList, Jikan (MAL score), tied
/// by the Fribb anime ID lists, cached in SQLite. Results are JSON strings.
///
/// The data calls (`trending`, `title`, `season`, `search`) return Promises
/// that never block the UI: they answer from the cache at once when they
/// can (a stale answer, `"stale": true`, is refreshed in the background, and
/// `revision()` goes up when the refresh lands, so poll it and ask again);
/// only a cache miss waits for the network (15 s timeout, rate limits per
/// source). Each resolves to `{"data","stale","fetchedAt","error","warnings","revision"}`.
/// `language` is a BCP 47 tag ("en", "pl-PL"): text comes from the source in
/// that language when it has it.
#[module]
pub struct Meta;

#[module]
impl Meta {
    /// Opens the cache in `data_dir` (`process.dataDir`; empty: in memory)
    /// and starts the anime lists download when due. The status (see `status`).
    pub fn init(data_dir: String) -> String {
        let dir = (!data_dir.is_empty()).then(|| std::path::PathBuf::from(data_dir));
        init(dir.as_deref()).to_string()
    }

    /// Uses the user's own TMDB key (v4 read access token or v3 key) instead
    /// of the project one; empty clears it. Kept in memory. The status.
    pub fn set_tmdb_key(key: String) -> String {
        set_tmdb_key(&key).to_string()
    }

    /// Which sources work: `{"tmdb":{"configured","requiresKey","capabilities",
    /// "key":"user"|"build"|null},"anilist","jikan":{"configured","requiresKey","capabilities"},
    /// "animeLists":{"entries","fetchedAt","updating"},"cache":{"persistent"},"revision"}`.
    pub fn status() -> String {
        status().to_string()
    }

    /// Goes up whenever a background refresh stored newer data: ask again
    /// for what is on screen when it changes.
    pub fn revision() -> f64 {
        revision() as f64
    }

    /// What the About/Credits screen must show: `[{"provider","name","url",
    /// "notice","logoRequired","license"}]` (TMDB's notice is required, with its logo).
    pub fn attribution() -> String {
        attribution().to_string()
    }

    /// A home shelf: `kind` is "movie" | "tv" (TMDB trending this week),
    /// "movie-popular" | "tv-popular" (TMDB discover), "anime" (AniList
    /// trending) | "anime-popular" (AniList, this season). `data`:
    /// `{"items":[TitleCard]}`.
    pub async fn trending(kind: String, language: String) -> String {
        trending(kind, language).await
    }

    /// A title by our ID ("tmdb:movie:603", "tmdb:tv:1399", "anilist:21"):
    /// `data` is a Title. An AniList ID the anime lists tie to one TMDB title
    /// answers with that title (its `id` is the TMDB one).
    pub async fn title(id: String, language: String) -> String {
        title(id, language).await
    }

    /// TMDB season `season` (0 = specials) of a series: `data` is a Season
    /// with its episodes.
    pub async fn season(id: String, season: u32, language: String) -> String {
        self::season(id, season, language).await
    }

    /// Search: `data` is `{"sections":[{"source":"tmdb"|"anilist","items":[TitleCard]}]}`;
    /// an anime TMDB found is not repeated under AniList.
    pub async fn search(query: String, language: String) -> String {
        search(query, language).await
    }
}
