//! The SQLite cache (`metadata.sqlite` in the app's data directory, in memory
//! until `Meta.init`): raw provider responses with the time they were fetched,
//! so a change to the mapping needs no refetch, plus the anime ID lists
//! (`animemap`). How long a response stays fresh depends on its kind, and
//! nothing is served or kept past `MAX_AGE` (TMDB terms: at most 6 months).

use std::path::Path;

use rusqlite::{Connection, OptionalExtension, params};
use serde_json::Value;

use super::provider::ProviderId;

pub const HOUR: i64 = 3600;
pub const DAY: i64 = 24 * HOUR;
/// TMDB allows caching for at most six months; the same cap for every source.
pub const MAX_AGE: i64 = 180 * DAY;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CacheKind {
    /// Trending, popular.
    Shelf,
    Search,
    /// A series still airing or a title not out yet.
    TitleOngoing,
    /// A movie out, a series that ended.
    TitleSettled,
    /// A season with episodes still to air or just aired.
    SeasonAiring,
    SeasonSettled,
    Rating,
    /// TMDB `/configuration`.
    Config,
}

impl CacheKind {
    /// How long a response stays fresh (research report §4.3).
    pub fn ttl(self) -> i64 {
        match self {
            CacheKind::Shelf => 6 * HOUR,
            CacheKind::Search => DAY,
            CacheKind::TitleOngoing | CacheKind::SeasonAiring => DAY,
            CacheKind::TitleSettled | CacheKind::SeasonSettled => 14 * DAY,
            CacheKind::Rating => 3 * DAY,
            CacheKind::Config => 7 * DAY,
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            CacheKind::Shelf => "shelf",
            CacheKind::Search => "search",
            CacheKind::TitleOngoing => "titleOngoing",
            CacheKind::TitleSettled => "titleSettled",
            CacheKind::SeasonAiring => "seasonAiring",
            CacheKind::SeasonSettled => "seasonSettled",
            CacheKind::Rating => "rating",
            CacheKind::Config => "config",
        }
    }

    fn parse(s: &str) -> Option<Self> {
        [
            CacheKind::Shelf,
            CacheKind::Search,
            CacheKind::TitleOngoing,
            CacheKind::TitleSettled,
            CacheKind::SeasonAiring,
            CacheKind::SeasonSettled,
            CacheKind::Rating,
            CacheKind::Config,
        ]
        .into_iter()
        .find(|k| k.as_str() == s)
    }

    /// The kind of a fetched body: a title or season request starts as
    /// settled and becomes ongoing/airing by what the body says.
    pub fn refine(self, body: &Value, now: i64) -> CacheKind {
        match self {
            CacheKind::TitleOngoing | CacheKind::TitleSettled => {
                // TMDB `status`, AniList `data.Media.status`.
                let status = body
                    .get("status")
                    .or_else(|| body.pointer("/data/Media/status"))
                    .and_then(Value::as_str)
                    .unwrap_or("");
                let ongoing = matches!(
                    status,
                    "Returning Series"
                        | "In Production"
                        | "Planned"
                        | "Post Production"
                        | "Rumored"
                        | "RELEASING"
                        | "NOT_YET_RELEASED"
                        | "HIATUS"
                );
                if ongoing { CacheKind::TitleOngoing } else { CacheKind::TitleSettled }
            }
            CacheKind::SeasonAiring | CacheKind::SeasonSettled => {
                let recent = date_of(now - 14 * DAY);
                let airing = body.get("episodes").and_then(Value::as_array).is_some_and(|eps| {
                    eps.is_empty()
                        || eps.iter().any(|e| match e.get("air_date").and_then(Value::as_str) {
                            Some(d) if !d.is_empty() => d >= recent.as_str(),
                            _ => true,
                        })
                });
                if airing { CacheKind::SeasonAiring } else { CacheKind::SeasonSettled }
            }
            other => other,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Freshness {
    Fresh,
    /// Usable, but refresh it.
    Stale,
    /// Past `MAX_AGE`: not to be served.
    Expired,
}

pub fn freshness(kind: CacheKind, fetched_at: i64, now: i64) -> Freshness {
    let age = now - fetched_at;
    if age >= MAX_AGE {
        Freshness::Expired
    } else if age < kind.ttl() && age >= -HOUR {
        Freshness::Fresh
    } else {
        // A clock that jumped back (fetched "in the future") also refreshes.
        Freshness::Stale
    }
}

pub struct Entry {
    pub body: Value,
    pub kind: CacheKind,
    pub fetched_at: i64,
}

pub struct Cache {
    conn: Connection,
}

impl Cache {
    pub fn open(path: &Path) -> rusqlite::Result<Cache> {
        if let Some(dir) = path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        Cache::setup(Connection::open(path)?)
    }

    pub fn memory() -> Cache {
        Cache::setup(Connection::open_in_memory().expect("in-memory SQLite")).expect("schema")
    }

    fn setup(conn: Connection) -> rusqlite::Result<Cache> {
        conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             CREATE TABLE IF NOT EXISTS http_cache (
                 key TEXT PRIMARY KEY,
                 provider TEXT NOT NULL,
                 kind TEXT NOT NULL,
                 fetched_at INTEGER NOT NULL,
                 body TEXT NOT NULL
             );
             CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);",
        )?;
        super::animemap::create_schema(&conn)?;
        Ok(Cache { conn })
    }

    pub fn conn(&mut self) -> &mut Connection {
        &mut self.conn
    }

    /// The cached response, unless it is past `MAX_AGE`.
    pub fn get(&self, key: &str, now: i64) -> Option<Entry> {
        let row: Option<(String, i64, String)> = self
            .conn
            .query_row("SELECT kind, fetched_at, body FROM http_cache WHERE key = ?1", [key], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?))
            })
            .optional()
            .unwrap_or_else(|e| {
                eprintln!("reel meta: cache read: {e}");
                None
            });
        let (kind, fetched_at, body) = row?;
        let entry = Entry { kind: CacheKind::parse(&kind)?, fetched_at, body: serde_json::from_str(&body).ok()? };
        (freshness(entry.kind, fetched_at, now) != Freshness::Expired).then_some(entry)
    }

    pub fn put(&self, key: &str, provider: ProviderId, kind: CacheKind, body: &Value, now: i64) {
        let result = self.conn.execute(
            "INSERT OR REPLACE INTO http_cache (key, provider, kind, fetched_at, body) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![key, provider.as_str(), kind.as_str(), now, body.to_string()],
        );
        if let Err(e) = result {
            eprintln!("reel meta: cache write: {e}");
        }
    }

    /// Deletes what is past `MAX_AGE`.
    pub fn purge(&self, now: i64) -> usize {
        self.conn.execute("DELETE FROM http_cache WHERE fetched_at <= ?1", [now - MAX_AGE]).unwrap_or(0)
    }

    pub fn meta(&self, key: &str) -> Option<String> {
        self.conn.query_row("SELECT value FROM meta WHERE key = ?1", [key], |r| r.get(0)).optional().ok().flatten()
    }

    pub fn set_meta(&self, key: &str, value: &str) {
        let _ = self.conn.execute("INSERT OR REPLACE INTO meta (key, value) VALUES (?1, ?2)", [key, value]);
    }
}

pub fn now() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0)
}

/// "YYYY-MM-DD" (UTC) of unix seconds.
pub fn date_of(unix: i64) -> String {
    // Howard Hinnant's civil_from_days.
    let z = unix.div_euclid(DAY) + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + i64::from(m <= 2);
    format!("{y:04}-{m:02}-{d:02}")
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn ttl_decides_freshness() {
        let t = 1_700_000_000;
        assert_eq!(freshness(CacheKind::Shelf, t, t + 5 * HOUR), Freshness::Fresh);
        assert_eq!(freshness(CacheKind::Shelf, t, t + 7 * HOUR), Freshness::Stale);
        assert_eq!(freshness(CacheKind::TitleSettled, t, t + 13 * DAY), Freshness::Fresh);
        assert_eq!(freshness(CacheKind::TitleOngoing, t, t + 2 * DAY), Freshness::Stale);
        assert_eq!(freshness(CacheKind::Config, t, t + 179 * DAY), Freshness::Stale);
        assert_eq!(freshness(CacheKind::Config, t, t + MAX_AGE), Freshness::Expired);
        assert_eq!(freshness(CacheKind::Shelf, t, t - 2 * HOUR), Freshness::Stale, "clock went back");
    }

    #[test]
    fn refines_by_body() {
        let now = 1_763_000_000; // 2025-11-13
        assert_eq!(
            CacheKind::TitleSettled.refine(&json!({"status": "Returning Series"}), now),
            CacheKind::TitleOngoing
        );
        assert_eq!(CacheKind::TitleSettled.refine(&json!({"status": "Ended"}), now), CacheKind::TitleSettled);
        assert_eq!(
            CacheKind::TitleSettled.refine(&json!({"data": {"Media": {"status": "RELEASING"}}}), now),
            CacheKind::TitleOngoing
        );
        let old = json!({"episodes": [{"air_date": "2011-04-17"}, {"air_date": "2011-06-19"}]});
        assert_eq!(CacheKind::SeasonSettled.refine(&old, now), CacheKind::SeasonSettled);
        let airing = json!({"episodes": [{"air_date": "2025-11-01"}, {"air_date": null}]});
        assert_eq!(CacheKind::SeasonSettled.refine(&airing, now), CacheKind::SeasonAiring);
    }

    #[test]
    fn dates() {
        assert_eq!(date_of(0), "1970-01-01");
        assert_eq!(date_of(1_763_000_000), "2025-11-13");
        assert_eq!(date_of(951_782_400), "2000-02-29");
    }

    #[test]
    fn stores_and_expires() {
        let cache = Cache::memory();
        let t = 1_700_000_000;
        cache.put("k", ProviderId::Tmdb, CacheKind::Shelf, &json!({"a": 1}), t);
        let e = cache.get("k", t + HOUR).unwrap();
        assert_eq!(e.body["a"], 1);
        assert_eq!(e.kind, CacheKind::Shelf);
        assert!(cache.get("k", t + MAX_AGE).is_none(), "never served past six months");
        assert_eq!(cache.purge(t + MAX_AGE), 1);
        assert!(cache.get("k", t).is_none());
    }
}
