//! Our stable title IDs: "tmdb:movie:603", "tmdb:tv:1399", "anilist:21".

use std::fmt;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum MetaId {
    TmdbMovie(u64),
    TmdbTv(u64),
    Anilist(u64),
}

impl MetaId {
    pub fn parse(s: &str) -> Option<MetaId> {
        let mut parts = s.split(':');
        let id = match (parts.next()?, parts.next()?, parts.next()) {
            ("tmdb", "movie", Some(n)) => MetaId::TmdbMovie(number(n)?),
            ("tmdb", "tv", Some(n)) => MetaId::TmdbTv(number(n)?),
            ("anilist", n, None) => MetaId::Anilist(number(n)?),
            _ => return None,
        };
        parts.next().is_none().then_some(id)
    }
}

fn number(s: &str) -> Option<u64> {
    if s.is_empty() || !s.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    s.parse().ok().filter(|n| *n > 0)
}

impl fmt::Display for MetaId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            MetaId::TmdbMovie(n) => write!(f, "tmdb:movie:{n}"),
            MetaId::TmdbTv(n) => write!(f, "tmdb:tv:{n}"),
            MetaId::Anilist(n) => write!(f, "anilist:{n}"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::MetaId;

    #[test]
    fn parses_and_prints() {
        for (text, id) in [
            ("tmdb:movie:603", MetaId::TmdbMovie(603)),
            ("tmdb:tv:1399", MetaId::TmdbTv(1399)),
            ("anilist:21", MetaId::Anilist(21)),
        ] {
            assert_eq!(MetaId::parse(text), Some(id));
            assert_eq!(id.to_string(), text);
        }
    }

    #[test]
    fn refuses_malformed() {
        for bad in [
            "",
            "tmdb",
            "tmdb:movie",
            "tmdb:movie:",
            "tmdb:movie:abc",
            "tmdb:movie:-1",
            "tmdb:movie:0",
            "tmdb:person:1",
            "tmdb:tv:1:2",
            "anilist:",
            "anilist:1:2",
            "imdb:tt0133093",
            "tmdb:movie:+5",
        ] {
            assert_eq!(MetaId::parse(bad), None, "{bad}");
        }
    }
}
