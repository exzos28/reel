//! Finding releases of a film or an episode on the user's own source: a
//! Torznab endpoint (Jackett, Prowlarr, JacRed, BitMagnet…), entered in
//! Settings. reel ships no source and no address.
//!
//! A search runs in the background: `start_search` gives an id, `result`
//! says `pending`, `done` (ranked releases) or `failed`.

pub mod compat;
pub mod episode;
pub mod release;
pub mod torznab;

use std::{
    collections::{HashMap, HashSet},
    sync::{
        Mutex, OnceLock,
        atomic::{AtomicU32, Ordering},
    },
    time::Duration,
};

use serde::Deserialize;
use serde_json::{Value, json};
use tokio::runtime::Runtime;

use torznab::{Caps, Item, Query};

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
}

impl Request {
    fn query(&self) -> Query {
        self.query_for(&self.title, self.imdb.clone())
    }

    fn query_for(&self, title: &str, imdb: Option<String>) -> Query {
        match (self.season, self.episode) {
            (Some(season), Some(episode)) => Query::Episode { imdb, title: title.to_owned(), season, episode },
            (Some(season), None) => Query::Season { imdb, title: title.to_owned(), season },
            _ => Query::Movie { imdb, title: title.to_owned(), year: self.year },
        }
    }

    /// Every name of the title: its title and the other ones.
    fn names(&self) -> Vec<String> {
        std::iter::once(self.title.clone()).chain(self.alt_titles.iter().cloned()).collect()
    }

    /// The text queries after the first: each other title once (the IMDb id is
    /// only tried with the first, it doesn't depend on the name).
    fn alt_queries(&self) -> Vec<Query> {
        let mut seen = vec![self.title.to_lowercase()];
        let mut out = Vec::new();
        for t in &self.alt_titles {
            let key = t.trim().to_lowercase();
            if key.is_empty() || seen.contains(&key) {
                continue;
            }
            seen.push(key);
            out.push(self.query_for(t.trim(), None));
        }
        out
    }
}

enum State {
    Pending,
    Done(Value),
    Failed(String),
}

static NEXT: AtomicU32 = AtomicU32::new(1);
static JOBS: Mutex<Option<HashMap<u32, State>>> = Mutex::new(None);
/// Caps per endpoint, asked once per run of the app.
static CAPS: Mutex<Option<HashMap<String, Caps>>> = Mutex::new(None);

fn runtime() -> &'static Runtime {
    static RT: OnceLock<Runtime> = OnceLock::new();
    RT.get_or_init(|| {
        tokio::runtime::Builder::new_multi_thread()
            .worker_threads(1)
            .enable_all()
            .thread_name("reel-sources")
            .build()
            .expect("the sources runtime starts")
    })
}

fn client() -> &'static reqwest::Client {
    static C: OnceLock<reqwest::Client> = OnceLock::new();
    C.get_or_init(|| {
        reqwest::Client::builder()
            .timeout(Duration::from_secs(20))
            .user_agent(concat!("reel/", env!("CARGO_PKG_VERSION")))
            .build()
            .expect("an HTTP client")
    })
}

fn set(job: u32, state: State) {
    JOBS.lock().unwrap().get_or_insert_with(HashMap::new).insert(job, state);
}

async fn get(url: &str) -> anyhow::Result<String> {
    let resp = client().get(url).send().await?;
    let status = resp.status();
    let body = resp.text().await?;
    if !status.is_success() {
        // Torznab errors come as XML with a 200 or a 4xx; say what the source said.
        if let Err(e) = torznab::parse(&body) {
            anyhow::bail!("{e}");
        }
        anyhow::bail!("the source answered HTTP {status}");
    }
    Ok(body)
}

async fn caps(source: &Source) -> anyhow::Result<Caps> {
    if let Some(c) = CAPS.lock().unwrap().as_ref().and_then(|m| m.get(&source.url)).cloned() {
        return Ok(c);
    }
    let c = torznab::parse_caps(&get(&torznab::caps_url(&source.url, source.key.as_deref())?).await?)?;
    CAPS.lock().unwrap().get_or_insert_with(HashMap::new).insert(source.url.clone(), c.clone());
    Ok(c)
}

/// Checks the source in the background: a job whose result is
/// `{"state":"done","caps":{"movieImdb","tvImdb","tvSeasonEp"}}` or failed.
pub fn start_check(source: Source) -> u32 {
    let job = NEXT.fetch_add(1, Ordering::Relaxed);
    set(job, State::Pending);
    runtime().spawn(async move {
        CAPS.lock().unwrap().get_or_insert_with(HashMap::new).remove(&source.url);
        let state = match caps(&source).await {
            Ok(c) => State::Done(json!({ "caps": { "movieImdb": c.movie_imdb, "tvImdb": c.tv_imdb, "tvSeasonEp": c.tv_season_ep } })),
            Err(e) => State::Failed(crate::engine::redact(&format!("{e:#}"))),
        };
        set(job, state);
    });
    job
}

/// Starts a search on `source`; poll `result(job)`.
pub fn start_search(source: Source, request: Request) -> u32 {
    let job = NEXT.fetch_add(1, Ordering::Relaxed);
    set(job, State::Pending);
    runtime().spawn(async move {
        let state = match search(&source, &request).await {
            Ok((releases, hidden)) => State::Done(json!({ "releases": releases, "hidden": hidden })),
            Err(e) => State::Failed(crate::engine::redact(&format!("{e:#}"))),
        };
        set(job, state);
    });
    job
}

/// `{"state":"pending"}`, `{"state":"done", …}` or `{"state":"failed","message"}`.
pub fn result(job: u32) -> Value {
    match JOBS.lock().unwrap().as_ref().and_then(|m| m.get(&job)) {
        None => json!({ "state": "failed", "message": format!("no search {job}") }),
        Some(State::Pending) => json!({ "state": "pending" }),
        Some(State::Done(v)) => {
            let mut v = v.clone();
            v["state"] = "done".into();
            v
        }
        Some(State::Failed(m)) => json!({ "state": "failed", "message": m }),
    }
}

/// Runs the queries best first and stops once one finds something to play.
/// The releases that fit, best first, and those hidden because this device
/// cannot play them (`{"title","reason"}`).
async fn search(source: &Source, request: &Request) -> anyhow::Result<(Vec<Value>, Vec<Value>)> {
    let caps = caps(source).await.unwrap_or_default();
    let query = request.query();
    let mut found = Vec::new();
    let mut last_err = None;
    let mut urls = torznab::search_urls(&source.url, source.key.as_deref(), &query, &caps)?;
    for q in request.alt_queries() {
        urls.extend(torznab::search_urls(&source.url, source.key.as_deref(), &q, &caps)?);
    }
    urls.dedup();
    let names = request.names();
    // A season asks every query anyway (packs and single episodes come from different
    // ones): all at once, not one after the other (each can take seconds on a source
    // that opens tracker pages).
    let answers: Vec<anyhow::Result<String>> = if matches!(query, Query::Season { .. }) {
        let mut set = tokio::task::JoinSet::new();
        for (i, url) in urls.iter().cloned().enumerate() {
            set.spawn(async move { (i, get(&url).await) });
        }
        let mut got: Vec<(usize, anyhow::Result<String>)> = Vec::new();
        while let Some(r) = set.join_next().await {
            got.push(r.unwrap_or_else(|e| (usize::MAX, Err(anyhow::anyhow!("search task: {e}")))));
        }
        got.sort_by_key(|(i, _)| *i);
        got.into_iter().map(|(_, r)| r).collect()
    } else {
        Vec::new()
    };
    let mut answers = answers.into_iter();
    for url in urls {
        let answer = match answers.next() {
            Some(a) => a,
            None => get(&url).await,
        };
        match answer.and_then(|xml| torznab::parse(&xml)) {
            Ok(items) => {
                // A source that cannot search the way asked may answer with its
                // latest releases instead: only those about this title count.
                found.extend(items.into_iter().filter(|it| is_about(&it.title, &names, request.year, request.season.is_none())));
                // A season asks every query: packs and single episodes come from different ones.
                if !matches!(query, Query::Season { .. }) && rank(&found, &query).0.iter().any(|r| r["seeders"].as_u64().unwrap_or(0) > 0) {
                    break;
                }
            }
            Err(e) => last_err = Some(e),
        }
    }
    let (ranked, hidden) = rank(&found, &query);
    match (ranked.is_empty() && hidden.is_empty(), last_err) {
        (true, Some(e)) => Err(e),
        _ => Ok((ranked, hidden)),
    }
}

/// The words of a name, lowercased, without punctuation ("ё" as "е").
fn words(text: &str) -> Vec<String> {
    text.to_lowercase()
        .replace('ё', "е")
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| !w.is_empty())
        .map(str::to_owned)
        .collect()
}

/// The years a release's name gives (1900–2099).
fn years_in(text: &str) -> Vec<u16> {
    words(text).iter().filter_map(|w| w.parse::<u16>().ok()).filter(|y| (1900..2100).contains(y)).collect()
}

/// Whether a release's name is about the title: the words of one of its
/// `names` are in it, in a row, and for a film a year it gives is the film's (±1).
fn is_about(release: &str, names: &[String], year: Option<u16>, film: bool) -> bool {
    let have = words(release);
    let named = names
        .iter()
        .map(|n| words(n))
        .filter(|w| !w.is_empty())
        .any(|name| have.windows(name.len()).any(|run| run == name.as_slice()));
    if !named {
        return false;
    }
    match (film, year) {
        (true, Some(y)) => {
            let ys = years_in(release);
            ys.is_empty() || ys.iter().any(|r| r.abs_diff(y) <= 1)
        }
        _ => true,
    }
}

/// How well a release fits the query: 2 the exact episode (or a film),
/// 1 a season pack that holds it, 0 not this.
fn fit(info: &release::ReleaseInfo, query: &Query) -> u8 {
    match query {
        Query::Movie { .. } => 2,
        Query::Episode { season, episode, .. } => match info.season {
            Some(s) if s != *season => 0,
            _ if info.episodes.contains(episode) => 2,
            Some(_) if info.episodes.is_empty() => 1,
            _ => 0,
        },
        // A season: its packs first (no episodes named, or several), then single
        // episodes; a name without a season may hold it too (a show's only one).
        Query::Season { season, .. } => match info.season {
            Some(s) if s != *season => 0,
            Some(_) if info.episodes.len() != 1 => 2,
            Some(_) => 1,
            None if info.episodes.is_empty() => 1,
            None => 0,
        },
    }
}

/// Deduplicated (by infohash, else link), what does not fit dropped, best first:
/// people sharing, then how well it fits, then the picture size, then more people, and
/// only then the source (a 4K remux with 80 people is not over a 4K WEB-DL with 2000: for
/// streaming the swarm matters more, and a remux is several times the bitrate).
fn rank(items: &[Item], query: &Query) -> (Vec<Value>, Vec<Value>) {
    let profile = compat::profile();
    let mut hidden = Vec::new();
    // Some indexers report 0 seeders for everything (they don't parse it):
    // then 0 means "unknown", not "nobody sharing".
    let seeders_known = items.iter().any(|it| it.seeders.unwrap_or(0) > 0);
    let mut seen = HashSet::new();
    let mut rows: Vec<(u8, u8, u32, u32, u32, Value)> = Vec::new();
    for it in items {
        let key = it.infohash.clone().or_else(|| it.link.clone()).unwrap_or_else(|| it.title.clone());
        if it.magnet.is_none() && it.link.is_none() {
            continue;
        }
        let info = release::parse(&it.title);
        let fit = fit(&info, query);
        if fit == 0 || !seen.insert(key.clone()) {
            continue;
        }
        if let Err(reason) = compat::release_ok(&info, profile) {
            hidden.push(json!({ "title": it.title, "reason": reason }));
            continue;
        }
        let seeders = if seeders_known { it.seeders.unwrap_or(0) } else { 1 };
        rows.push((
            (seeders > 0) as u8,
            fit,
            release::resolution_score(&info),
            seeders,
            release::source_score(&info),
            json!({
                "id": key,
                "title": it.title,
                // What the engine opens: the .torrent first (through the user's source it
                // carries the tracker's announce, with their key for private trackers, so
                // peers come at once), else the magnet (DHT and whatever trackers it names).
                "source": it.link.clone().filter(|l| !l.starts_with("magnet:")).or_else(|| it.magnet.clone()),
                "infohash": it.infohash,
                "size": it.size,
                "seeders": if seeders_known { it.seeders } else { None },
                "peers": it.peers,
                "indexer": it.indexer,
                "info": info,
                "seasonPack": if matches!(query, Query::Season { .. }) { info.episodes.len() != 1 } else { fit == 1 },
            }),
        ));
    }
    rows.sort_by(|a, b| (b.0, b.1, b.2, b.3, b.4).cmp(&(a.0, a.1, a.2, a.3, a.4)));
    (rows.into_iter().map(|r| r.5).collect(), hidden)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_season_lists_its_packs_first_then_its_episodes() {
        let q = Query::Season { imdb: None, title: "Show".into(), season: 1 };
        let item = |t: &str| Item { title: t.into(), link: Some(format!("https://indexer.example/{t}")), seeders: Some(5), ..Default::default() };
        let items = [item("Show S01E03 1080p"), item("Show S01 1080p"), item("Show S02 1080p"), item("Show S01E01-08 of 08 1080p")];
        let r = rank(&items, &q).0;
        let titles: Vec<&str> = r.iter().map(|x| x["title"].as_str().unwrap()).collect();
        assert_eq!(titles.len(), 3, "not season 2");
        assert!(!titles.contains(&"Show S02 1080p"));
        assert_eq!(titles[2], "Show S01E03 1080p", "a single episode after the packs");
        assert!(r[0]["seasonPack"] == true && r[2]["seasonPack"] == false);
    }

    #[test]
    fn only_releases_about_the_title_count() {
        let names = ["Годзилла: Минус ноль".to_owned(), "Godzilla Minus Zero".to_owned()];
        let about = |t: &str| is_about(t, &names, Some(2026), true);
        assert!(about("Годзилла: Минус ноль / Godzilla Minus Zero (2026) WEB-DL 1080p"));
        assert!(about("Godzilla.Minus.Zero.2026.2160p.UHD.BluRay"));
        assert!(!about("Assassin's Creed Black Flag [RUS]"), "a source's latest releases are not this film");
        assert!(!about("4K Video Downloader Plus 26.1"));
        assert!(!about("Годзилла: Минус один / Godzilla Minus One (2023) 1080p"), "another film of the series");
        assert!(about("Годзилла Минус Ноль WEBRip"), "no year: kept");
        assert!(is_about("Ёлки 2010 HDTV", &["Елки".to_owned()], Some(2010), true), "ё is е");
        assert!(is_about("The Office S01E03 1080p", &["The Office".to_owned()], Some(2005), false), "a show's year is not checked");
        let twelves = ["12 12 12".to_owned()];
        assert!(is_about("12 12 12 / S1E1 of 8 (Карен Мейн) [2026, WEB-DL 1080p]", &twelves, None, false));
        assert!(!is_about("Похищение / S1E1-12 of 12 [2026]", &twelves, None, false), "the words in a row, not anywhere");
    }

    #[test]
    fn ranking_dedupes_and_orders() {
        let items = torznab::parse(include_str!("fixtures/torznab-sintel.xml")).unwrap();
        let q = Query::Movie { imdb: None, title: "Sintel".into(), year: Some(2010) };
        let r = rank(&items, &q).0;
        // 4 items: one duplicate by infohash, so 3; nobody sharing goes last.
        assert_eq!(r.len(), 3);
        assert_eq!(r[0]["title"], "Sintel 2010 1080p WEB x264 & subs");
        assert_eq!(r[0]["info"]["resolution"], 1080);
        assert_eq!(r[0]["source"], "https://indexer.example/dl/1.torrent", "the .torrent before the magnet");
        assert_eq!(r[1]["source"], "https://indexer.example/dl/2.torrent");
        assert_eq!(r[2]["seeders"], 0);
    }

    #[test]
    fn in_one_picture_size_more_people_sharing_win_over_the_source() {
        let q = Query::Movie { imdb: None, title: "Film".into(), year: None };
        let item = |t: &str, s: u32| Item { title: t.into(), link: Some(format!("https://indexer.example/{t}")), seeders: Some(s), ..Default::default() };
        let r = rank(&[item("Film 2160p Remux HEVC", 82), item("Film 2160p WEB-DL HEVC", 2231), item("Film 1080p BluRay", 5000)], &q).0;
        let titles: Vec<&str> = r.iter().map(|x| x["title"].as_str().unwrap()).collect();
        assert_eq!(titles, ["Film 2160p WEB-DL HEVC", "Film 2160p Remux HEVC", "Film 1080p BluRay"]);
        let tie = rank(&[item("Film 1080p WEB", 10), item("Film 1080p BluRay", 10)], &q).0;
        assert_eq!(tie[0]["title"], "Film 1080p BluRay", "equal people: the better source");
    }

    #[test]
    fn unsupported_releases_are_hidden_with_a_reason() {
        compat::set_profile(compat::Profile::Tizen);
        let q = Query::Movie { imdb: None, title: "Film".into(), year: None };
        let item = |t: &str| Item { title: t.into(), link: Some(format!("https://indexer.example/{t}")), seeders: Some(5), ..Default::default() };
        let (shown, hidden) = rank(&[item("Film 1080p BluRay DTS-HD MA"), item("Film 1080p WEB AAC")], &q);
        compat::set_profile(compat::Profile::Mpv);
        assert_eq!(shown.len(), 1);
        assert_eq!(hidden[0]["reason"], "audio_dts");
    }

    #[test]
    fn alt_titles_add_text_queries_once() {
        let r = Request {
            imdb: Some("tt0013442".into()),
            title: "Носферату".into(),
            alt_titles: vec!["Nosferatu".into(), "носферату".into(), " ".into()],
            year: Some(1922),
            season: None,
            episode: None,
        };
        let alts = r.alt_queries();
        assert_eq!(alts.len(), 1, "a duplicate and a blank are skipped");
        assert_eq!(alts[0], Query::Movie { imdb: None, title: "Nosferatu".into(), year: Some(1922) });
    }

    #[test]
    fn zero_seeders_everywhere_means_unknown() {
        let q = Query::Movie { imdb: None, title: "Sintel".into(), year: None };
        let items = vec![
            Item { title: "Sintel 720p".into(), link: Some("https://indexer.example/a".into()), seeders: Some(0), ..Default::default() },
            Item { title: "Sintel 1080p".into(), link: Some("https://indexer.example/b".into()), seeders: Some(0), ..Default::default() },
        ];
        let r = rank(&items, &q).0;
        assert_eq!(r[0]["title"], "Sintel 1080p", "ordered by quality, not as dead");
        assert!(r[0]["seeders"].is_null());
    }

    /// Searches the developer's own Torznab source (REEL_TORZNAB_URL, REEL_TORZNAB_KEY in ../.env):
    /// `set -a; . ../.env; set +a; cargo test -- --ignored live_source --nocapture`.
    #[test]
    #[ignore]
    fn live_source() {
        let (Ok(url), key) = (std::env::var("REEL_TORZNAB_URL"), std::env::var("REEL_TORZNAB_KEY").ok()) else {
            panic!("REEL_TORZNAB_URL is not set");
        };
        let source = Source { url, key };
        let request = Request {
            imdb: Some("tt0013442".into()),
            title: "Носферату".into(),
            alt_titles: vec!["Nosferatu".into()],
            year: Some(1922),
            season: None,
            episode: None,
        };
        let (r, _) = runtime().block_on(search(&source, &request)).expect("the source answers");
        println!("{} releases; best: {:?} {:?}", r.len(), r.first().map(|v| &v["info"]), r.first().map(|v| &v["seeders"]));
        assert!(!r.is_empty());
        assert!(r[0]["source"].as_str().is_some_and(|s| s.starts_with("magnet:") || s.starts_with("http")));
    }

    #[test]
    fn episodes_fit_or_not() {
        let q = Query::Episode { imdb: None, title: "Flash Gordon".into(), season: 1, episode: 3 };
        let item = |t: &str, s: u32| Item { title: t.into(), link: Some(format!("https://indexer.example/{t}")), seeders: Some(s), ..Default::default() };
        let items = vec![
            item("Flash.Gordon.S01E02.720p", 50),
            item("Flash.Gordon.S01.1080p", 20),
            item("Flash.Gordon.S01E03.720p", 5),
            item("Flash.Gordon.S02E03.720p", 90),
        ];
        let r = rank(&items, &q).0;
        let titles: Vec<_> = r.iter().map(|v| v["title"].as_str().unwrap()).collect();
        assert_eq!(titles, vec!["Flash.Gordon.S01E03.720p", "Flash.Gordon.S01.1080p"]);
        assert_eq!(r[1]["seasonPack"], true);
    }
}
