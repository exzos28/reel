//! The demo catalog: public-domain films and serials plus two open films with
//! official torrents. Text (titles, about, genres, notes) is the UI's, in
//! `locales/` under `films.<id>.*`, `shows.<id>.*` and the keys this file
//! names; here only data and the decisions on it (which release plays, how
//! fast each starts, what is left to watch, what plays next). The metadata
//! layer (docs/research-metadata.md) will replace the data.

use std::collections::{HashMap, HashSet};
use std::sync::{LazyLock, Mutex};

use nsh_core::prelude::*;
use serde_json::{Value, json};

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    Movie,
    Short,
    Show,
}

impl Kind {
    fn key(self) -> &'static str {
        match self {
            Kind::Movie => "movie",
            Kind::Short => "short",
            Kind::Show => "show",
        }
    }
}

/// A release of a film (or a season pack of a show), as a tracker lists it.
pub struct Release {
    /// "1080p", "4K".
    pub quality: &'static str,
    /// The release's own name for its source ("BluRay restoration"): the
    /// torrent's words, not the UI's.
    pub source: &'static str,
    /// Who made it, as the release names itself (may be empty).
    pub group: &'static str,
    pub mb: u32,
    /// Keys under `tracks.*`.
    pub tracks: &'static [&'static str],
    pub peers: u32,
    /// The bitrate it needs to play without waiting, Mbit/s.
    pub mbit: u32,
}

pub struct Film {
    pub id: &'static str,
    pub kind: Kind,
    pub year: u16,
    /// Last year of a show's run.
    pub year_end: Option<u16>,
    pub minutes: u16,
    /// Rating ×10 and votes (demo).
    pub rating: u8,
    pub votes: u32,
    /// Keys under `badge.*` and `genre.*`.
    pub badges: &'static [&'static str],
    pub genres: &'static [&'static str],
    /// Backdrop still, a 16:9 card still (when it differs) and a 2:3 poster.
    pub still: Option<ImageAsset>,
    pub card: Option<ImageAsset>,
    pub poster: Option<ImageAsset>,
    /// The two colours of its typographic fallback (no still, no poster).
    pub ink: &'static str,
    pub paper: &'static str,
    /// Where the viewer stopped, seconds (demo data).
    pub stopped_at: Option<u32>,
    /// A magnet the engine can play; demo films without one have no source.
    pub magnet: Option<&'static str>,
    pub releases: Vec<Release>,
    /// Shows: episodes per season.
    pub seasons: &'static [u8],
    /// Shows: where the viewer is, (season, episode, minutes into it).
    pub resume: Option<(u8, u8, u16)>,
    /// Shows: the next episode airing, (season, episode, month, day).
    pub airs: Option<(u8, u8, u8, u8)>,
    /// Key under `tag.*`: "new_season", "new_episode".
    pub tag: Option<&'static str>,
}

/// Sintel and Big Buck Bunny (Blender Foundation, CC BY): official torrents.
const SINTEL: &str = "magnet:?xt=urn:btih:08ada5a7a6183aae1e09d831df6748d566095a10&dn=Sintel&tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337&tr=udp%3A%2F%2Fexplodie.org%3A6969&xs=https%3A%2F%2Fwebtorrent.io%2Ftorrents%2Fsintel.torrent";
const BUNNY: &str = "magnet:?xt=urn:btih:dd8255ecdc7ca55fb0bbf81323d87062db1f6d1c&dn=Big+Buck+Bunny&tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337&tr=udp%3A%2F%2Fexplodie.org%3A6969&xs=https%3A%2F%2Fwebtorrent.io%2Ftorrents%2Fbig-buck-bunny.torrent";

fn base(id: &'static str, kind: Kind, year: u16, minutes: u16, rating: u8, votes: u32) -> Film {
    Film {
        id,
        kind,
        year,
        year_end: None,
        minutes,
        rating,
        votes,
        badges: &[],
        genres: &[],
        still: None,
        card: None,
        poster: None,
        ink: "#F5F5F5",
        paper: "#1A1A1A",
        stopped_at: None,
        magnet: None,
        releases: Vec::new(),
        seasons: &[],
        resume: None,
        airs: None,
        tag: None,
    }
}

fn show(id: &'static str, year: u16, rating: u8, votes: u32, seasons: &'static [u8]) -> Film {
    Film { seasons, ..base(id, Kind::Show, year, 0, rating, votes) }
}

const fn rel(quality: &'static str, source: &'static str, group: &'static str, mb: u32, tracks: &'static [&'static str], peers: u32, mbit: u32) -> Release {
    Release { quality, source, group, mb, tracks, peers, mbit }
}

/// Releases of a film the demo data lists none for: a BluRay, a WEB rip
/// and a DVD print, sized by its runtime, shared by about as many as rate it.
fn default_releases(f: &Film) -> Vec<Release> {
    let m = f.minutes as u32;
    let score: &'static [&'static str] = if f.badges.contains(&"silent") { &["score_piano", "subs_en"] } else { &["audio_en_mono", "subs_en"] };
    vec![
        rel("1080p", "BluRay", "", m * 45, score, f.votes / 400, 8),
        rel("720p", "WEB", "", m * 15, score, f.votes / 250, 4),
        rel("480p", "DVD", "public-domain print", m * 8, &["no_score"], f.votes / 9000, 2),
    ]
}

pub static FILMS: LazyLock<Vec<Film>> = LazyLock::new(|| {
    let mut films = films();
    for f in films.iter_mut().filter(|f| f.kind != Kind::Show && f.releases.is_empty()) {
        f.releases = default_releases(f);
    }
    films
});

fn films() -> Vec<Film> {
    vec![
        Film {
            badges: &["cc"],
            genres: &["animation", "fantasy"],
            ink: "#F4E9D8",
            paper: "#5A2A1F",
            magnet: Some(SINTEL),
            releases: vec![rel("720p", "WEB", "Blender Foundation", 129, &["audio_en", "subs_many"], 64, 3)],
            ..base("sintel", Kind::Short, 2010, 15, 74, 51_000)
        },
        Film {
            genres: &["animation", "comedy"],
            ink: "#2B3A12",
            paper: "#B8D46A",
            magnet: Some(BUNNY),
            releases: vec![rel("480p", "WEB", "Blender Foundation", 263, &["audio_none"], 52, 2)],
            ..base("bunny", Kind::Short, 2008, 10, 64, 46_000)
        },
        Film {
            badges: &["hd", "cc"],
            genres: &["thriller", "comedy", "romance"],
            still: Some(asset!("still-charade.jpg")),
            card: Some(asset!("still-charade-2.jpg")),
            poster: Some(asset!("poster-charade.jpg")),
            stopped_at: Some(2472),
            releases: vec![
                rel("1080p", "BluRay", "Criterion, 2014", 2150, &["audio_en_mono", "subs_en"], 412, 8),
                rel("720p", "WEB", "", 920, &["audio_en_mono"], 655, 4),
                rel("4K", "UHD remaster", "2023", 22_500, &["audio_en_fr", "subs_en"], 38, 25),
            ],
            ..base("charade", Kind::Movie, 1963, 113, 79, 82_000)
        },
        Film {
            badges: &["uhd", "silent"],
            genres: &["scifi", "drama"],
            still: Some(asset!("still-metropolis.jpg")),
            poster: Some(asset!("poster-metropolis.jpg")),
            stopped_at: Some(4360),
            ..base("metropolis", Kind::Movie, 1927, 153, 83, 190_000)
        },
        Film {
            badges: &["uhd", "silent"],
            genres: &["horror", "fantasy"],
            still: Some(asset!("still-nosferatu.jpg")),
            poster: Some(asset!("poster-nosferatu.jpg")),
            stopped_at: Some(1520),
            releases: vec![
                rel("720p", "WEB", "Kino Lorber", 1950, &["score_piano", "subs_en"], 940, 4),
                rel("1080p", "BluRay restoration", "Murnau Foundation, 2013", 6550, &["score_orchestral", "subs_en"], 286, 10),
                rel("4K", "UHD remaster HDR", "2024", 39_100, &["score_orchestral", "subs_en_de"], 41, 25),
                rel("1080p", "BluRay", "alternate score", 7270, &["score_electronic"], 12, 10),
                rel("480p", "DVD", "public-domain print", 1130, &["no_score"], 3, 2),
            ],
            ..base("nosferatu", Kind::Movie, 1922, 94, 78, 112_000)
        },
        Film {
            badges: &["hd", "silent"],
            genres: &["comedy", "action", "war"],
            still: Some(asset!("still-general.jpg")),
            poster: Some(asset!("poster-general.jpg")),
            stopped_at: Some(610),
            ..base("general", Kind::Movie, 1926, 78, 81, 98_000)
        },
        Film {
            badges: &["hd", "silent"],
            genres: &["comedy", "fantasy"],
            still: Some(asset!("still-sherlock.jpg")),
            poster: Some(asset!("poster-sherlock.jpg")),
            ..base("sherlock", Kind::Movie, 1924, 45, 82, 57_000)
        },
        Film {
            badges: &["hd"],
            genres: &["noir", "crime"],
            still: Some(asset!("still-detour.jpg")),
            poster: Some(asset!("poster-detour.jpg")),
            ..base("detour", Kind::Movie, 1945, 68, 72, 22_000)
        },
        Film {
            badges: &["hd", "cc"],
            genres: &["comedy", "romance"],
            still: Some(asset!("still-friday.jpg")),
            poster: Some(asset!("poster-friday.jpg")),
            ..base("friday", Kind::Movie, 1940, 92, 78, 67_000)
        },
        Film {
            badges: &["hd", "cc"],
            genres: &["horror", "thriller"],
            still: Some(asset!("still-night.jpg")),
            poster: Some(asset!("poster-night.jpg")),
            ..base("night", Kind::Movie, 1968, 96, 78, 140_000)
        },
        Film {
            badges: &["hd", "silent"],
            genres: &["horror", "mystery"],
            still: Some(asset!("still-caligari.jpg")),
            ..base("caligari", Kind::Movie, 1920, 76, 80, 70_000)
        },
        Film {
            badges: &["hd", "silent"],
            genres: &["scifi", "fantasy"],
            still: Some(asset!("still-moon.jpg")),
            ..base("moon", Kind::Short, 1902, 13, 81, 61_000)
        },
        // Shows.
        Film {
            year_end: Some(1940),
            badges: &["hd", "tv_pg"],
            genres: &["scifi", "adventure", "serial"],
            still: Some(asset!("still-flash-2.jpg")),
            card: Some(asset!("still-flash-hawkmen.jpg")),
            poster: Some(asset!("poster-flash.jpg")),
            releases: vec![rel("1080p", "restoration", "season pack", 4900, &["audio_en_mono"], 128, 6)],
            resume: Some((3, 4, 12)),
            airs: Some((3, 5, 11, 20)),
            tag: Some("new_season"),
            ..show("flash", 1936, 71, 6_400, &[13, 15, 12])
        },
        Film {
            badges: &["hd", "silent"],
            genres: &["crime", "serial"],
            still: Some(asset!("still-vampires-2.jpg")),
            card: Some(asset!("still-vampires.jpg")),
            poster: Some(asset!("poster-vampires.jpg")),
            releases: vec![rel("1080p", "restoration", "season pack", 9800, &["score_piano", "subs_en"], 74, 6)],
            resume: Some((1, 2, 6)),
            airs: Some((1, 7, 11, 18)),
            tag: Some("new_episode"),
            ..show("vampires", 1915, 73, 5_100, &[10])
        },
        Film {
            badges: &["hd", "silent"],
            genres: &["crime", "serial"],
            poster: Some(asset!("poster-fantomas.jpg")),
            airs: Some((1, 4, 11, 21)),
            ..show("fantomas", 1913, 70, 3_200, &[5])
        },
        Film {
            badges: &["hd", "silent"],
            genres: &["adventure", "serial"],
            poster: Some(asset!("poster-judex.jpg")),
            airs: Some((1, 9, 11, 22)),
            ..show("judex", 1916, 69, 2_100, &[12])
        },
        Film {
            badges: &["sd", "silent"],
            genres: &["adventure", "serial"],
            still: Some(asset!("still-pauline.jpg")),
            poster: Some(asset!("poster-pauline.jpg")),
            airs: Some((1, 12, 11, 25)),
            ..show("pauline", 1914, 66, 1_900, &[20])
        },
        Film {
            badges: &["sd"],
            genres: &["scifi", "serial"],
            poster: Some(asset!("poster-undersea.jpg")),
            airs: Some((1, 6, 11, 27)),
            ..show("undersea", 1936, 62, 1_100, &[12])
        },
        Film {
            badges: &["sd"],
            genres: &["western", "serial"],
            poster: Some(asset!("poster-zorro.jpg")),
            airs: Some((1, 3, 11, 29)),
            ..show("zorro", 1939, 70, 1_600, &[12])
        },
        Film {
            badges: &["sd"],
            genres: &["western", "serial"],
            poster: Some(asset!("poster-lone-ranger.jpg")),
            airs: Some((1, 10, 12, 2)),
            ..show("lone_ranger", 1938, 71, 1_300, &[15])
        },
        Film {
            year_end: Some(1973),
            badges: &["hd", "cc"],
            genres: &["western", "drama"],
            still: Some(asset!("still-bonanza.jpg")),
            tag: Some("new_season"),
            ..show("bonanza", 1959, 74, 31_000, &[34, 34, 34, 34, 34, 34, 34, 34, 34, 34, 34, 34, 34, 16])
        },
        Film {
            badges: &["sd"],
            genres: &["scifi", "horror", "serial"],
            still: Some(asset!("still-phantom-creeps.jpg")),
            ..show("phantom_creeps", 1939, 60, 1_000, &[12])
        },
    ]
}

/// Flash Gordon's chapters: (minutes, rating ×10, thumbnail) per season;
/// titles and descriptions in `shows.flash.s<season>.e<n>`.
type Chapter = (u16, u8, Option<ImageAsset>);

static FLASH: LazyLock<[Vec<Chapter>; 3]> = LazyLock::new(|| {
    let plain = |m: &[(u16, u8)]| m.iter().map(|&(min, r)| (min, r, None)).collect::<Vec<Chapter>>();
    let mut s1 = plain(&[(20, 74), (19, 71), (20, 70), (20, 72), (20, 70), (20, 69), (20, 71), (20, 73), (20, 72), (20, 70), (20, 71), (20, 70), (18, 74)]);
    s1[0].2 = Some(asset!("still-flash-hawkmen.jpg"));
    let mut s2 = plain(&[(29, 70), (20, 69), (20, 70), (20, 68), (20, 67), (20, 70), (20, 68), (20, 71), (20, 67), (20, 66), (20, 68), (20, 69), (20, 67), (20, 68), (20, 71)]);
    s2[7].2 = Some(asset!("still-flash-mars.jpg"));
    let mut s3 = plain(&[(20, 71), (19, 70), (19, 70), (19, 72), (20, 69), (19, 68), (19, 70), (19, 69), (19, 68), (19, 69), (19, 70), (19, 72)]);
    s3[0].2 = Some(asset!("still-flash-2.jpg"));
    s3[2].2 = Some(asset!("still-flash-lobby.jpg"));
    s3[3].2 = Some(asset!("still-flash-1.jpg"));
    s3[4].2 = Some(asset!("still-flash-shannon.jpg"));
    [s1, s2, s3]
});

/// The first chapter's release date of each Flash Gordon serial; chapters
/// came out weekly.
const FLASH_PREMIERES: [(i32, u32, u32); 3] = [(1936, 4, 6), (1938, 3, 21), (1940, 4, 3)];

/// The catalog the engine plays from: a film by id.
pub fn film(id: &str) -> Option<&'static Film> {
    FILMS.iter().find(|f| f.id == id)
}

/// The user's list and release choices, while the app runs (demo: not saved).
static LIST: LazyLock<Mutex<HashSet<String>>> = LazyLock::new(|| Mutex::new(HashSet::from(["nosferatu".to_string()])));
static CHOSEN: LazyLock<Mutex<HashMap<String, usize>>> = LazyLock::new(|| Mutex::new(HashMap::new()));

fn in_list(id: &str) -> bool {
    LIST.lock().unwrap().contains(id)
}

// ---- Formatting of numbers the UI shows as they are.

/// 7.9
fn rating(r: u8) -> String {
    format!("{}.{}", r / 10, r % 10)
}

/// 950, 6.4K, 82K, 1.2M
fn votes(n: u32) -> String {
    match n {
        0..1_000 => n.to_string(),
        1_000..10_000 => format!("{:.1}K", n as f64 / 1_000.0),
        10_000..1_000_000 => format!("{}K", (n as f64 / 1_000.0).round()),
        _ => format!("{:.1}M", n as f64 / 1_000_000.0),
    }
}

fn size(mb: u32) -> String {
    crate::Fmt::size(mb as f64 * 1024.0 * 1024.0)
}

fn url(a: Option<ImageAsset>) -> Value {
    a.map_or(Value::Null, |a| json!(a.url))
}

/// Days since 1970-01-01 of a civil date, and back (Howard Hinnant's algorithms).
fn days(y: i32, m: u32, d: u32) -> i64 {
    let y = if m <= 2 { y - 1 } else { y } as i64;
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let mp = (m as i64 + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d as i64 - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

fn civil(z: i64) -> (i32, u32, u32) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    let y = (yoe + era * 400 + if m <= 2 { 1 } else { 0 }) as i32;
    (y, m, d)
}

// ---- Releases: which plays, how fast each starts.

const QUALITY: [&str; 5] = ["SD", "480p", "720p", "1080p", "4K"];

fn quality_rank(q: &str) -> usize {
    QUALITY.iter().position(|x| *x == q).unwrap_or(0)
}

/// Starts without waiting: enough people sharing for its bitrate.
fn plays_now(r: &Release) -> bool {
    r.peers >= 50 && r.mbit <= 15
}

/// The release Play uses: the user's choice, else the best quality that
/// plays now, else the one most people share. An index into `f.releases`.
fn chosen(f: &Film) -> Option<usize> {
    if f.releases.is_empty() {
        return None;
    }
    if let Some(&i) = CHOSEN.lock().unwrap().get(f.id) {
        return Some(i);
    }
    let rs = f.releases.iter().enumerate();
    rs.clone()
        .filter(|(_, r)| plays_now(r))
        .max_by_key(|(_, r)| (quality_rank(r.quality), r.peers))
        .or_else(|| rs.max_by_key(|(_, r)| r.peers))
        .map(|(i, _)| i)
}

/// Four signal bars for the people sharing.
fn bars(peers: u32) -> u8 {
    match peers {
        200.. => 4,
        30..200 => 3,
        10..30 => 2,
        _ => 1,
    }
}

/// The releases fastest to start first, each with a plain note
/// (`note` a key under `release.note.*`, `mbit` for "needs").
fn releases(f: &Film) -> Vec<Value> {
    let pick = chosen(f);
    let mut order: Vec<usize> = (0..f.releases.len()).collect();
    order.sort_by_key(|&i| std::cmp::Reverse(f.releases[i].peers));
    order
        .iter()
        .enumerate()
        .map(|(rank, &i)| {
            let r = &f.releases[i];
            let note = if Some(i) == pick {
                "plays_now"
            } else if r.mbit > 15 {
                "needs"
            } else if r.peers < 10 {
                "few_sharing"
            } else if rank == 0 {
                "starts_fastest"
            } else if r.peers < 30 {
                "slow_start"
            } else {
                "plays_now"
            };
            json!({
                "index": i,
                "quality": r.quality,
                "source": r.source,
                "group": r.group,
                "size": size(r.mb),
                "tracks": r.tracks,
                "peers": r.peers,
                "bars": bars(r.peers),
                "note": note,
                "mbit": r.mbit,
                "selected": Some(i) == pick,
            })
        })
        .collect()
}

/// The release line: the one Play uses, `fast` when it starts in seconds.
fn release_line(f: &Film) -> Value {
    let Some(r) = chosen(f).map(|i| &f.releases[i]) else { return Value::Null };
    json!({
        "quality": r.quality,
        "source": r.source,
        "pack": f.kind == Kind::Show,
        "size": size(r.mb),
        "peers": r.peers,
        "fast": r.peers >= 100 && r.mbit <= 15,
    })
}

// ---- Episodes (Flash Gordon has them; the other shows list none yet).

fn episode_id(show: &str, season: u8, n: u8) -> String {
    format!("{show}-{season}-{n}")
}

/// `flash-3-4` → ("flash", 3, 4).
fn parse_episode(id: &str) -> Option<(&str, u8, u8)> {
    let mut it = id.rsplitn(3, '-');
    let n = it.next()?.parse().ok()?;
    let s = it.next()?.parse().ok()?;
    Some((it.next()?, s, n))
}

fn chapters(show: &str, season: u8) -> Option<&'static Vec<Chapter>> {
    (show == "flash").then(|| FLASH.get(season as usize - 1)).flatten()
}

/// How far the viewer is into an episode: (minutes watched, watched to the end).
fn episode_progress(f: &Film, season: u8, n: u8) -> (u16, bool) {
    match f.resume {
        Some((s, e, m)) if (s, e) == (season, n) => (m, false),
        Some((s, e, _)) => (0, (season, n) < (s, e)),
        None => (0, false),
    }
}

fn episode_json(f: &Film, season: u8, n: u8, ch: &Chapter) -> Value {
    let (min, r, thumb) = *ch;
    let (watched_min, watched) = episode_progress(f, season, n);
    let (py, pm, pd) = FLASH_PREMIERES[season as usize - 1];
    let (y, m, d) = civil(days(py, pm, pd) + 7 * (n as i64 - 1));
    let quality = chosen(f).map(|i| f.releases[i].quality);
    json!({
        "id": episode_id(f.id, season, n),
        "show": f.id,
        "season": season,
        "number": n,
        "minutes": min,
        "date": [y, m, d],
        "rating": rating(r),
        "thumb": url(thumb),
        "progress": if watched { 1.0 } else { watched_min as f64 / min as f64 },
        "left": if watched_min > 0 { Some(min - watched_min) } else { None },
        "watched": watched,
        "quality": quality,
        "playable": false,
    })
}

// ---- Cards and title screens.

/// What a card, a shelf and a hero show of a title.
fn summary(f: &Film) -> Value {
    let (progress, left, resume) = match (f.kind, f.stopped_at, f.resume) {
        (Kind::Show, _, Some((s, e, m))) => {
            let total = chapters(f.id, s).and_then(|c| c.get(e as usize - 1)).map_or(30, |c| c.0).max(m + 1);
            (m as f64 / total as f64, Some(total - m), json!({ "season": s, "episode": e }))
        }
        (_, Some(at), _) => {
            let watched = (at / 60) as u16;
            (at as f64 / (f.minutes as f64 * 60.0), Some(f.minutes.saturating_sub(watched)), Value::Null)
        }
        _ => (0.0, None, Value::Null),
    };
    json!({
        "id": f.id,
        "kind": f.kind.key(),
        "year": f.year,
        "yearEnd": f.year_end,
        "minutes": f.minutes,
        "rating": rating(f.rating),
        "votes": votes(f.votes),
        "badges": f.badges,
        "genres": f.genres,
        "still": url(f.still),
        "card": url(f.card.or(f.still)),
        "poster": url(f.poster),
        "ink": f.ink,
        "paper": f.paper,
        "stoppedAt": f.stopped_at,
        "progress": progress,
        "left": left,
        "resume": resume,
        "seasons": f.seasons.len(),
        "airs": f.airs.map(|(s, e, m, d)| json!({ "season": s, "episode": e, "month": m, "day": d })),
        "tag": f.tag,
        "playable": f.magnet.is_some(),
        "inList": in_list(f.id),
        "release": release_line(f),
        "play": play_target(f),
    })
}

fn by_ids(ids: &[&str]) -> Vec<Value> {
    ids.iter().filter_map(|id| film(id)).map(summary).collect()
}

/// The home shelves: `[{"id", "items": [summary…]}]`; the hero shows the focused one.
pub fn home() -> Value {
    json!([
        { "id": "continue", "items": by_ids(&["charade", "flash", "metropolis", "vampires", "general"]) },
        { "id": "open", "items": by_ids(&["sintel", "bunny"]) },
        { "id": "noir", "items": by_ids(&["detour", "friday", "night", "charade"]) },
        { "id": "silent", "items": by_ids(&["metropolis", "nosferatu", "general", "sherlock", "caligari", "moon"]) },
    ])
}

/// A browse page: `{"trending": [summary…], "all": [summary…]}` for
/// `"movies"` or `"shows"`.
pub fn browse(page: &str) -> Value {
    if page == "shows" {
        json!({
            "trending": by_ids(&["flash", "vampires", "fantomas", "judex", "pauline", "undersea", "zorro", "lone_ranger"]),
            "all": by_ids(&["bonanza", "vampires", "pauline", "phantom_creeps", "flash", "fantomas", "judex", "undersea", "zorro", "lone_ranger"]),
        })
    } else {
        json!({
            "trending": by_ids(&["metropolis", "nosferatu", "charade", "general", "sherlock", "friday", "detour", "night"]),
            "all": by_ids(&["detour", "friday", "caligari", "moon", "sherlock", "sintel", "bunny", "metropolis", "nosferatu", "general", "charade", "night"]),
        })
    }
}

/// A title screen: the summary plus `releases` and, for shows, `season`
/// (the one to show first) and `seasonList` (`[{"number","year","episodes"}]`).
pub fn title(id: &str) -> Value {
    let Some(f) = film(id) else { return Value::Null };
    let mut v = summary(f);
    v["releases"] = json!(releases(f));
    if f.kind == Kind::Show {
        let s = f.resume.map_or(1, |(s, _, _)| s);
        v["season"] = json!(s);
        v["seasonList"] = f
            .seasons
            .iter()
            .enumerate()
            .map(|(i, &n)| {
                let year = match f.id {
                    "flash" => FLASH_PREMIERES[i].0 as u16,
                    _ => f.year + i as u16,
                };
                json!({ "number": i + 1, "year": year, "episodes": n })
            })
            .collect();
    }
    v
}

/// What Play starts for a title: `{"id"}` for a film, plus `season` and
/// `episode` for a show (where the viewer is, else the first episode).
fn play_target(f: &Film) -> Value {
    if f.kind == Kind::Show {
        let (s, e) = f.resume.map_or((1, 1), |(s, e, _)| (s, e));
        json!({ "id": episode_id(f.id, s, e), "season": s, "episode": e })
    } else {
        json!({ "id": f.id })
    }
}

/// The episodes of a season: `[{"id","show","season","number","minutes",
/// "date":[y,m,d],"rating","thumb","progress","left","watched","quality","playable"}]`;
/// empty for shows whose episodes are not listed yet.
pub fn episodes(show: &str, season: u8) -> Value {
    let (Some(f), Some(chs)) = (film(show), chapters(show, season)) else { return json!([]) };
    chs.iter().enumerate().map(|(i, ch)| episode_json(f, season, i as u8 + 1, ch)).collect()
}

/// How long before the end of an episode the next one is offered.
const UP_NEXT_S: f64 = 40.0;

/// The episode after `id`, once `position` is within the last 40 s of
/// `duration`; null for a film, the last episode, or earlier.
pub fn up_next(id: &str, position: f64, duration: f64) -> Value {
    if duration <= 0.0 || duration - position > UP_NEXT_S {
        return Value::Null;
    }
    let Some((show, s, n)) = parse_episode(id) else { return Value::Null };
    let Some(f) = film(show) else { return Value::Null };
    let next = if chapters(show, s).is_some_and(|c| (n as usize) < c.len()) { (s, n + 1) } else { (s + 1, 1) };
    match chapters(show, next.0).and_then(|c| c.get(next.1 as usize - 1)) {
        Some(ch) => episode_json(f, next.0, next.1, ch),
        None => Value::Null,
    }
}

/// The demo tracks of what plays: audio and subtitle options (keys under
/// `tracks.*`) with the one in use, and the releases.
pub fn tracks(id: &str) -> Value {
    let f = parse_episode(id).and_then(|(show, _, _)| film(show)).or_else(|| film(id));
    let Some(f) = f else { return json!({ "audio": [], "subtitles": [], "releases": [] }) };
    let has_subs = f.releases.iter().any(|r| r.tracks.iter().any(|t| t.starts_with("subs")));
    json!({
        "audio": [{ "key": "original", "selected": true }],
        "subtitles": if has_subs {
            json!([{ "key": "off", "selected": false }, { "key": "en", "selected": true }])
        } else {
            json!([{ "key": "off", "selected": true }])
        },
        "releases": releases(f),
    })
}

/// Adds the title to the user's list or takes it off; whether it is on it now.
pub fn toggle_list(id: &str) -> bool {
    let mut list = LIST.lock().unwrap();
    if !list.remove(id) {
        list.insert(id.to_string());
        return true;
    }
    false
}

/// Makes release `index` (of `title(id).releases[].index`) the one Play uses.
pub fn choose_release(id: &str, index: usize) -> bool {
    let ok = film(id).is_some_and(|f| index < f.releases.len());
    if ok {
        CHOSEN.lock().unwrap().insert(id.to_string(), index);
    }
    ok
}

/// The catalog the UI shows. Results are JSON strings.
#[module]
pub struct Catalog;

#[module]
impl Catalog {
    /// The home shelves: `[{"id","items":[summary…]}]` (see `catalog::summary`).
    pub fn home() -> String {
        home().to_string()
    }

    /// `"movies"` or `"shows"`: `{"trending":[summary…],"all":[summary…]}`.
    pub fn browse(page: String) -> String {
        browse(&page).to_string()
    }

    /// A film or show screen (null for an unknown id).
    pub fn title(id: String) -> String {
        title(&id).to_string()
    }

    /// The episodes of `season` of `show` (1-based).
    pub fn episodes(show: String, season: u32) -> String {
        episodes(&show, season.min(255) as u8).to_string()
    }

    /// The episode to offer next at `position` of `duration` seconds of `id`, or null.
    pub fn up_next(id: String, position: f64, duration: f64) -> String {
        up_next(&id, position, duration).to_string()
    }

    /// The audio, subtitle and release options of what plays (demo).
    pub fn tracks(id: String) -> String {
        tracks(&id).to_string()
    }

    /// Adds `id` to the user's list or takes it off: whether it is on it now.
    pub fn toggle_list(id: String) -> bool {
        toggle_list(&id)
    }

    /// Makes release `index` the one Play uses for `id`.
    pub fn choose_release(id: String, index: u32) -> bool {
        choose_release(&id, index as usize)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn home_holds_the_titles() {
        let s = home();
        assert_eq!(s[0]["id"], "continue");
        assert_eq!(s[0]["items"][0]["id"], "charade");
        assert_eq!(s[0]["items"][0]["left"], 72);
        assert_eq!(s[0]["items"][1]["resume"]["season"], 3);
        assert_eq!(s[0]["items"][1]["left"], 7);
        assert_eq!(s[1]["items"][0]["playable"], true);
        assert!(film("sintel").unwrap().magnet.is_some());
        assert!(film("nope").is_none());
    }

    #[test]
    fn numbers() {
        assert_eq!(rating(79), "7.9");
        assert_eq!(votes(82_000), "82K");
        assert_eq!(votes(6_400), "6.4K");
        assert_eq!(votes(950), "950");
        assert_eq!(civil(days(1940, 4, 3) + 14), (1940, 4, 17));
        assert_eq!(civil(days(1936, 12, 28) + 7), (1937, 1, 4));
    }

    #[test]
    fn releases_fastest_first_and_play_uses_the_best_that_plays_now() {
        let t = title("nosferatu");
        let r = t["releases"].as_array().unwrap();
        assert_eq!(r.len(), 5);
        assert_eq!(r[0]["quality"], "720p");
        assert_eq!(r[0]["note"], "starts_fastest");
        assert_eq!(r[1]["selected"], true);
        assert_eq!(r[1]["note"], "plays_now");
        assert_eq!(r[2]["note"], "needs");
        assert_eq!(r[3]["note"], "slow_start");
        assert_eq!(r[4]["note"], "few_sharing");
        assert_eq!(r[4]["bars"], 1);
        assert_eq!(t["release"]["quality"], "1080p");
        assert_eq!(t["play"]["id"], "nosferatu");
    }

    #[test]
    fn choosing_a_release() {
        assert!(choose_release("charade", 1));
        assert_eq!(title("charade")["release"]["quality"], "720p");
        assert!(!choose_release("charade", 9));
        CHOSEN.lock().unwrap().remove("charade");
    }

    #[test]
    fn flash_gordon_has_three_seasons_of_chapters() {
        let t = title("flash");
        assert_eq!(t["seasonList"].as_array().unwrap().len(), 3);
        assert_eq!(t["seasonList"][2]["year"], 1940);
        assert_eq!(t["play"], json!({ "id": "flash-3-4", "season": 3, "episode": 4 }));
        let e = episodes("flash", 3);
        assert_eq!(e.as_array().unwrap().len(), 12);
        assert_eq!(e[2]["watched"], true);
        assert_eq!(e[3]["left"], 7);
        assert_eq!(e[3]["date"], json!([1940, 4, 24]));
        assert_eq!(episodes("flash", 2).as_array().unwrap().len(), 15);
        assert_eq!(episodes("vampires", 1), json!([]));
    }

    #[test]
    fn up_next_near_the_end_of_an_episode() {
        assert!(up_next("flash-3-4", 100.0, 1140.0).is_null());
        assert_eq!(up_next("flash-3-4", 1110.0, 1140.0)["number"], 5);
        assert_eq!(up_next("flash-1-13", 1070.0, 1080.0)["season"], 2);
        assert!(up_next("flash-3-12", 1130.0, 1140.0).is_null());
        assert!(up_next("sintel", 880.0, 888.0).is_null());
    }

    #[test]
    fn list() {
        assert!(in_list("nosferatu"));
        assert!(toggle_list("detour"));
        assert!(!toggle_list("detour"));
    }
}
