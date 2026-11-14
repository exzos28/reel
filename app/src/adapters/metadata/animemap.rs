//! The anime ID lists of Fribb/anime-lists (`anime-list-full.json`): one row
//! per anime entry linking AniList, MAL, AniDB and Kitsu to TMDB, TVDB and
//! IMDb, with the TMDB season and episode offset. reel downloads the file at
//! run time (daily, with its ETag) into the cache database; it is never in
//! the repo. With it an anime is one title: the TMDB series or movie its
//! entries point to.
//!
//! A row that points to several TMDB movies or several IMDb IDs (a
//! compilation, a recut) has no single target: it stays its own AniList
//! title, and the IDs are left out rather than one picked.

use rusqlite::{Connection, OptionalExtension, params};
use serde::Deserialize;

use super::{id::MetaId, model::*};

pub const URL: &str = "https://raw.githubusercontent.com/Fribb/anime-lists/master/anime-list-full.json";
pub const REFRESH: i64 = super::cache::DAY;

#[derive(Debug, Clone, PartialEq, Default)]
pub struct AnimeIds {
    pub format: Option<String>,
    pub anilist: Option<u64>,
    pub mal: Option<u64>,
    pub anidb: Option<u64>,
    pub kitsu: Option<u64>,
    pub tvdb: Option<u64>,
    pub tmdb_tv: Option<u64>,
    pub tmdb_movies: Vec<u64>,
    pub tmdb_season: Option<u32>,
    pub tmdb_offset: Option<u32>,
    pub imdb: Vec<String>,
}

impl AnimeIds {
    /// The one TMDB title this entry is part of, if there is exactly one.
    pub fn canonical(&self) -> Option<MetaId> {
        match (self.tmdb_tv, self.tmdb_movies.as_slice()) {
            (Some(tv), []) => Some(MetaId::TmdbTv(tv)),
            (None, [movie]) => Some(MetaId::TmdbMovie(*movie)),
            _ => None,
        }
    }

    pub fn imdb_single(&self) -> Option<String> {
        match self.imdb.as_slice() {
            [one] => Some(one.clone()),
            _ => None,
        }
    }

    pub fn entry(&self) -> AnimeEntry {
        AnimeEntry {
            anilist: self.anilist,
            mal: self.mal,
            anidb: self.anidb,
            kitsu: self.kitsu,
            format: self.format.as_deref().and_then(AnimeFormat::parse),
            tmdb_season: self.tmdb_season,
            episode_offset: self.tmdb_offset,
            episodes: None,
            ratings: Vec::new(),
        }
    }
}

#[derive(Deserialize)]
struct RawTmdb {
    tv: Option<u64>,
    movie: Option<Vec<u64>>,
}

#[derive(Deserialize)]
struct RawSeason {
    tmdb: Option<u32>,
}

#[derive(Deserialize)]
struct Raw {
    #[serde(rename = "type")]
    format: Option<String>,
    anidb_id: Option<u64>,
    anilist_id: Option<u64>,
    mal_id: Option<u64>,
    kitsu_id: Option<u64>,
    tvdb_id: Option<u64>,
    imdb_id: Option<Vec<String>>,
    themoviedb_id: Option<RawTmdb>,
    season: Option<RawSeason>,
    episode_offset: Option<RawSeason>,
}

/// The rows of `anime-list-full.json` that have an AniList or MAL ID.
pub fn parse(json: &[u8]) -> Result<Vec<AnimeIds>, serde_json::Error> {
    let raw: Vec<Raw> = serde_json::from_slice(json)?;
    Ok(raw
        .into_iter()
        .filter(|r| r.anilist_id.is_some() || r.mal_id.is_some())
        .map(|r| AnimeIds {
            format: r.format,
            anilist: r.anilist_id,
            mal: r.mal_id,
            anidb: r.anidb_id,
            kitsu: r.kitsu_id,
            tvdb: r.tvdb_id,
            tmdb_tv: r.themoviedb_id.as_ref().and_then(|t| t.tv),
            tmdb_movies: r.themoviedb_id.and_then(|t| t.movie).unwrap_or_default(),
            tmdb_season: r.season.and_then(|s| s.tmdb),
            tmdb_offset: r.episode_offset.and_then(|s| s.tmdb),
            imdb: r.imdb_id.unwrap_or_default(),
        })
        .collect())
}

pub fn create_schema(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS anime_ids (
             anilist INTEGER, mal INTEGER, anidb INTEGER, kitsu INTEGER, tvdb INTEGER,
             format TEXT, tmdb_tv INTEGER, tmdb_movie INTEGER, tmdb_movies TEXT NOT NULL,
             tmdb_season INTEGER, tmdb_offset INTEGER, imdb TEXT NOT NULL
         );
         CREATE INDEX IF NOT EXISTS anime_ids_anilist ON anime_ids (anilist);
         CREATE INDEX IF NOT EXISTS anime_ids_mal ON anime_ids (mal);
         CREATE INDEX IF NOT EXISTS anime_ids_tmdb_tv ON anime_ids (tmdb_tv);
         CREATE INDEX IF NOT EXISTS anime_ids_tmdb_movie ON anime_ids (tmdb_movie);",
    )
}

/// SQLite integers are signed.
fn i(v: Option<u64>) -> Option<i64> {
    v.map(|v| v as i64)
}

fn n(v: Option<i64>) -> Option<u64> {
    v.and_then(|v| u64::try_from(v).ok())
}

fn join<T: ToString>(items: &[T]) -> String {
    items.iter().map(T::to_string).collect::<Vec<_>>().join(",")
}

/// Replaces every row in one transaction.
pub fn replace(conn: &mut Connection, rows: &[AnimeIds]) -> rusqlite::Result<()> {
    let tx = conn.transaction()?;
    tx.execute("DELETE FROM anime_ids", [])?;
    {
        let mut insert = tx.prepare(
            "INSERT INTO anime_ids (anilist, mal, anidb, kitsu, tvdb, format, tmdb_tv, tmdb_movie, tmdb_movies,
                                    tmdb_season, tmdb_offset, imdb)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
        )?;
        for r in rows {
            let single_movie = match r.tmdb_movies.as_slice() {
                [m] => Some(*m),
                _ => None,
            };
            insert.execute(params![
                i(r.anilist),
                i(r.mal),
                i(r.anidb),
                i(r.kitsu),
                i(r.tvdb),
                r.format,
                i(r.tmdb_tv),
                i(single_movie),
                join(&r.tmdb_movies),
                r.tmdb_season,
                r.tmdb_offset,
                join(&r.imdb),
            ])?;
        }
    }
    tx.commit()
}

const COLUMNS: &str = "anilist, mal, anidb, kitsu, tvdb, format, tmdb_tv, tmdb_movies, tmdb_season, tmdb_offset, imdb";

fn row(r: &rusqlite::Row) -> rusqlite::Result<AnimeIds> {
    let movies: String = r.get(7)?;
    let imdb: String = r.get(10)?;
    Ok(AnimeIds {
        anilist: n(r.get(0)?),
        mal: n(r.get(1)?),
        anidb: n(r.get(2)?),
        kitsu: n(r.get(3)?),
        tvdb: n(r.get(4)?),
        format: r.get(5)?,
        tmdb_tv: n(r.get(6)?),
        tmdb_movies: movies.split(',').filter_map(|m| m.parse().ok()).collect(),
        tmdb_season: r.get(8)?,
        tmdb_offset: r.get(9)?,
        imdb: imdb.split(',').filter(|i| !i.is_empty()).map(str::to_owned).collect(),
    })
}

pub fn count(conn: &Connection) -> u64 {
    conn.query_row("SELECT COUNT(*) FROM anime_ids", [], |r| r.get::<_, i64>(0)).unwrap_or(0) as u64
}

pub fn by_anilist(conn: &Connection, id: u64) -> Option<AnimeIds> {
    conn.query_row(&format!("SELECT {COLUMNS} FROM anime_ids WHERE anilist = ?1 LIMIT 1"), [id as i64], row)
        .optional()
        .ok()
        .flatten()
}

/// Every entry of a TMDB title, in TMDB order (season, then offset).
pub fn by_tmdb(conn: &Connection, id: MetaId) -> Vec<AnimeIds> {
    let (column, n) = match id {
        MetaId::TmdbTv(n) => ("tmdb_tv", n),
        MetaId::TmdbMovie(n) => ("tmdb_movie", n),
        MetaId::Anilist(_) => return Vec::new(),
    };
    let sql = format!(
        "SELECT {COLUMNS} FROM anime_ids WHERE {column} = ?1
         ORDER BY tmdb_season IS NULL, tmdb_season, COALESCE(tmdb_offset, 0), anilist"
    );
    let Ok(mut stmt) = conn.prepare(&sql) else { return Vec::new() };
    stmt.query_map([n as i64], row).map(|rows| rows.filter_map(Result::ok).collect()).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    const FIXTURE: &[u8] = include_bytes!("fixtures/anime-list-full.json");

    #[test]
    fn parses_and_looks_up() {
        let rows = parse(FIXTURE).unwrap();
        assert_eq!(rows.len(), 6, "the row without AniList or MAL is left out");
        let mut conn = Connection::open_in_memory().unwrap();
        create_schema(&conn).unwrap();
        replace(&mut conn, &rows).unwrap();
        assert_eq!(count(&conn), 6);

        let aot = by_anilist(&conn, 16498).unwrap();
        assert_eq!(aot.canonical(), Some(MetaId::TmdbTv(1429)));
        assert_eq!(aot.imdb_single().as_deref(), Some("tt2560140"));
        assert_eq!(aot.tmdb_season, Some(1));

        let mononoke = by_anilist(&conn, 164).unwrap();
        assert_eq!(mononoke.canonical(), Some(MetaId::TmdbMovie(128)));

        // Several TMDB movies: no single target.
        let split = by_anilist(&conn, 9999).unwrap();
        assert_eq!(split.tmdb_movies, vec![1001, 1002]);
        assert_eq!(split.canonical(), None);
        assert_eq!(split.imdb_single(), None);

        // All entries of the series, in TMDB order.
        let entries = by_tmdb(&conn, MetaId::TmdbTv(1429));
        let seasons: Vec<_> = entries.iter().map(|e| (e.anilist, e.tmdb_season, e.tmdb_offset)).collect();
        assert_eq!(
            seasons,
            vec![
                (Some(16498), Some(1), None),
                (Some(20958), Some(2), None),
                (Some(99147), Some(3), None),
                (Some(104578), Some(3), Some(12)),
            ]
        );
        assert_eq!(by_tmdb(&conn, MetaId::TmdbMovie(128)).len(), 1);
        assert!(by_tmdb(&conn, MetaId::TmdbMovie(1001)).is_empty(), "ambiguous rows are not indexed by movie");
    }
}
