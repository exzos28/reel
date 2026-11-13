//! A Torznab client: the search API that Jackett, Prowlarr (per indexer),
//! JacRed, BitMagnet and similar aggregators speak. The user enters the
//! endpoint (…/api) and its key, if it has one; reel ships none.
//!
//! Spec: https://torznab.github.io/spec-1.3-draft/

use quick_xml::{Reader, events::Event};
use reqwest::Url;

/// One search the UI asks for.
#[derive(Debug, Clone, PartialEq)]
pub enum Query {
    Movie { imdb: Option<String>, title: String, year: Option<u16> },
    Episode { imdb: Option<String>, title: String, season: u16, episode: u16 },
}

/// One result as the indexer lists it.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Item {
    pub title: String,
    pub size: Option<u64>,
    /// A .torrent URL (the engine can add it as it is).
    pub link: Option<String>,
    pub magnet: Option<String>,
    /// Lowercase hex.
    pub infohash: Option<String>,
    pub seeders: Option<u32>,
    pub peers: Option<u32>,
    pub indexer: Option<String>,
}

/// What the endpoint can search by (from `t=caps`).
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Caps {
    pub movie_imdb: bool,
    pub tv_imdb: bool,
    pub tv_season_ep: bool,
}

/// `tt0041959` → `0041959` (the spec's form; Jackett and Prowlarr take both).
fn imdb_digits(id: &str) -> String {
    id.trim().trim_start_matches("tt").to_owned()
}

fn with_params(endpoint: &str, key: Option<&str>, params: &[(&str, String)]) -> anyhow::Result<String> {
    let mut url = Url::parse(endpoint)?;
    {
        let mut q = url.query_pairs_mut();
        if let Some(key) = key.filter(|k| !k.is_empty()) {
            q.append_pair("apikey", key);
        }
        for (k, v) in params {
            q.append_pair(k, v);
        }
    }
    Ok(url.into())
}

pub fn caps_url(endpoint: &str, key: Option<&str>) -> anyhow::Result<String> {
    with_params(endpoint, key, &[("t", "caps".into())])
}

/// The URLs to try, best first: by IMDb id when the endpoint can, then by text.
pub fn search_urls(endpoint: &str, key: Option<&str>, query: &Query, caps: &Caps) -> anyhow::Result<Vec<String>> {
    let mut urls = Vec::new();
    match query {
        Query::Movie { imdb, title, year } => {
            if let (Some(id), true) = (imdb, caps.movie_imdb) {
                urls.push(with_params(endpoint, key, &[("t", "movie".into()), ("imdbid", imdb_digits(id))])?);
            }
            let q = match year {
                Some(y) => format!("{title} {y}"),
                None => title.clone(),
            };
            urls.push(with_params(endpoint, key, &[("t", "search".into()), ("q", q)])?);
        }
        Query::Episode { imdb, title, season, episode } => {
            if let (Some(id), true) = (imdb, caps.tv_imdb) {
                urls.push(with_params(
                    endpoint,
                    key,
                    &[("t", "tvsearch".into()), ("imdbid", imdb_digits(id)), ("season", season.to_string()), ("ep", episode.to_string())],
                )?);
            }
            if caps.tv_season_ep {
                urls.push(with_params(
                    endpoint,
                    key,
                    &[("t", "tvsearch".into()), ("q", title.clone()), ("season", season.to_string()), ("ep", episode.to_string())],
                )?);
            }
            urls.push(with_params(endpoint, key, &[("t", "search".into()), ("q", format!("{title} S{season:02}E{episode:02}"))])?);
            // Whole-season packs hold the episode too.
            urls.push(with_params(endpoint, key, &[("t", "search".into()), ("q", format!("{title} S{season:02}"))])?);
        }
    }
    Ok(urls)
}

/// The text of an element, entities resolved.
fn push_text(buf: &mut String, ev: &Event) {
    match ev {
        Event::Text(t) => buf.push_str(&t.decode().unwrap_or_default()),
        Event::CData(t) => buf.push_str(&String::from_utf8_lossy(t)),
        Event::GeneralRef(r) => {
            if let Ok(Some(c)) = r.resolve_char_ref() {
                buf.push(c);
            } else {
                buf.push_str(match &**r {
                    b"amp" => "&",
                    b"lt" => "<",
                    b"gt" => ">",
                    b"quot" => "\"",
                    b"apos" => "'",
                    _ => "",
                });
            }
        }
        _ => {}
    }
}

fn attr(e: &quick_xml::events::BytesStart, name: &[u8]) -> Option<String> {
    e.attributes()
        .flatten()
        .find(|a| a.key.as_ref() == name)
        .and_then(|a| a.normalized_value(quick_xml::XmlVersion::Implicit1_0).ok().map(|v| v.into_owned()))
}

/// The infohash in a magnet link's `xt=urn:btih:…` (hex, lowercase).
pub fn magnet_hash(magnet: &str) -> Option<String> {
    let start = magnet.to_ascii_lowercase().find("urn:btih:")? + "urn:btih:".len();
    let hash: String = magnet[start..].chars().take_while(|c| c.is_ascii_alphanumeric()).collect();
    (hash.len() == 40).then(|| hash.to_ascii_lowercase())
}

/// Parses a Torznab (RSS) answer. An `<error code=… description=…>` answer is an error.
pub fn parse(xml: &str) -> anyhow::Result<Vec<Item>> {
    let mut reader = Reader::from_str(xml);
    let mut items = Vec::new();
    let mut item: Option<Item> = None;
    let mut field: Option<&'static str> = None;
    let mut text = String::new();
    loop {
        let ev = reader.read_event()?;
        match &ev {
            Event::Eof => break,
            Event::Start(e) | Event::Empty(e) => {
                let empty = matches!(ev, Event::Empty(_));
                match e.name().as_ref() {
                    b"error" => {
                        let desc = attr(e, b"description").unwrap_or_default();
                        anyhow::bail!("the source answered with an error: {desc}");
                    }
                    b"item" => item = Some(Item::default()),
                    b"enclosure" => {
                        if let Some(it) = item.as_mut() {
                            if it.link.is_none() {
                                it.link = attr(e, b"url");
                            }
                        }
                    }
                    b"torznab:attr" | b"newznab:attr" => {
                        if let (Some(it), Some(name), Some(value)) = (item.as_mut(), attr(e, b"name"), attr(e, b"value")) {
                            match name.as_str() {
                                "seeders" => it.seeders = value.parse().ok(),
                                "peers" => it.peers = value.parse().ok(),
                                "size" => it.size = it.size.or(value.parse().ok()),
                                "infohash" => it.infohash = Some(value.to_ascii_lowercase()),
                                "magneturl" => it.magnet = Some(value),
                                _ => {}
                            }
                        }
                    }
                    name if item.is_some() && !empty => {
                        field = match name {
                            b"title" => Some("title"),
                            b"size" => Some("size"),
                            b"link" => Some("link"),
                            b"jackettindexer" => Some("indexer"),
                            _ => None,
                        };
                        text.clear();
                    }
                    _ => {}
                }
            }
            Event::Text(_) | Event::CData(_) | Event::GeneralRef(_) if field.is_some() => push_text(&mut text, &ev),
            Event::End(e) => {
                if e.name().as_ref() == b"item" {
                    if let Some(mut it) = item.take() {
                        if it.infohash.is_none() {
                            it.infohash = it.magnet.as_deref().and_then(magnet_hash);
                        }
                        // A magnet in <link> (some indexers put it there).
                        if it.magnet.is_none() && it.link.as_deref().is_some_and(|l| l.starts_with("magnet:")) {
                            it.magnet = it.link.take();
                            it.infohash = it.infohash.or_else(|| it.magnet.as_deref().and_then(magnet_hash));
                        }
                        items.push(it);
                    }
                } else if let (Some(f), Some(it)) = (field.take(), item.as_mut()) {
                    let value = text.trim().to_owned();
                    match f {
                        "title" => it.title = value,
                        "size" => it.size = value.parse().ok(),
                        "link" if it.link.is_none() => it.link = Some(value),
                        "indexer" => it.indexer = Some(value),
                        _ => {}
                    }
                }
            }
            _ => {}
        }
    }
    Ok(items)
}

/// Parses `t=caps`: whether movie and TV search take an IMDb id, and TV a season/episode.
pub fn parse_caps(xml: &str) -> anyhow::Result<Caps> {
    let mut reader = Reader::from_str(xml);
    let mut caps = Caps::default();
    loop {
        match reader.read_event()? {
            Event::Eof => break,
            Event::Start(e) | Event::Empty(e) => {
                let params = || attr(&e, b"supportedParams").unwrap_or_default();
                let available = attr(&e, b"available").is_none_or(|a| a == "yes");
                match e.name().as_ref() {
                    b"error" => anyhow::bail!("the source answered with an error: {}", attr(&e, b"description").unwrap_or_default()),
                    b"movie-search" if available => caps.movie_imdb = params().split(',').any(|p| p.trim() == "imdbid"),
                    b"tv-search" if available => {
                        let p = params();
                        caps.tv_imdb = p.split(',').any(|p| p.trim() == "imdbid");
                        caps.tv_season_ep = p.split(',').any(|p| p.trim() == "season");
                    }
                    _ => {}
                }
            }
            _ => {}
        }
    }
    Ok(caps)
}

#[cfg(test)]
mod tests {
    use super::*;

    const FEED: &str = include_str!("fixtures/torznab-sintel.xml");

    #[test]
    fn parses_items() {
        let items = parse(FEED).unwrap();
        assert_eq!(items.len(), 4);
        let a = &items[0];
        assert_eq!(a.title, "Sintel 2010 1080p WEB x264 & subs");
        assert_eq!(a.size, Some(129_241_752));
        assert_eq!(a.seeders, Some(64));
        assert_eq!(a.infohash.as_deref(), Some("08ada5a7a6183aae1e09d831df6748d566095a10"));
        assert!(a.magnet.as_deref().unwrap().contains("&dn=Sintel"));
        assert_eq!(a.indexer.as_deref(), Some("Internet Archive"));
        assert_eq!(items[1].link.as_deref(), Some("https://indexer.example/dl/2.torrent"));
        assert_eq!(items[2].infohash.as_deref(), Some("08ada5a7a6183aae1e09d831df6748d566095a10"), "from the magnet");
    }

    #[test]
    fn error_answer() {
        let e = parse(r#"<?xml version="1.0"?><error code="100" description="Invalid API Key"/>"#).unwrap_err();
        assert!(e.to_string().contains("Invalid API Key"));
    }

    #[test]
    fn caps() {
        let xml = r#"<caps><searching>
            <search available="yes" supportedParams="q"/>
            <tv-search available="yes" supportedParams="q,season,ep,imdbid"/>
            <movie-search available="yes" supportedParams="q,imdbid"/>
        </searching></caps>"#;
        assert_eq!(parse_caps(xml).unwrap(), Caps { movie_imdb: true, tv_imdb: true, tv_season_ep: true });
        assert_eq!(parse_caps("<caps><searching/></caps>").unwrap(), Caps::default());
    }

    #[test]
    fn urls() {
        let caps = Caps { movie_imdb: true, tv_imdb: false, tv_season_ep: true };
        let movie = Query::Movie { imdb: Some("tt1727587".into()), title: "Sintel".into(), year: Some(2010) };
        let u = search_urls("http://127.0.0.1:9117/api/v2.0/indexers/all/results/torznab/api", Some("k"), &movie, &caps).unwrap();
        assert_eq!(u[0], "http://127.0.0.1:9117/api/v2.0/indexers/all/results/torznab/api?apikey=k&t=movie&imdbid=1727587");
        assert!(u[1].ends_with("t=search&q=Sintel+2010"));
        let ep = Query::Episode { imdb: Some("tt0027623".into()), title: "Flash Gordon".into(), season: 1, episode: 3 };
        let u = search_urls("http://h/api", None, &ep, &caps).unwrap();
        assert_eq!(u[0], "http://h/api?t=tvsearch&q=Flash+Gordon&season=1&ep=3", "no imdb tv search, no key");
        assert!(u.iter().any(|x| x.ends_with("q=Flash+Gordon+S01E03")));
        assert!(u.iter().any(|x| x.ends_with("q=Flash+Gordon+S01")));
    }

    #[test]
    fn magnet_hashes() {
        assert_eq!(magnet_hash("magnet:?xt=urn:btih:08ADA5A7A6183AAE1E09D831DF6748D566095A10&dn=x").as_deref(), Some("08ada5a7a6183aae1e09d831df6748d566095a10"));
        assert_eq!(magnet_hash("magnet:?dn=x"), None);
    }
}
