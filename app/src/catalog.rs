//! The demo catalog: public-domain films plus two open films with official
//! torrents. Text (title, director, about) is the UI's, in `locales/` under
//! `films.<id>.*` and `shelf.<id>`; here only data. The metadata layer
//! (docs/research-metadata.md) will replace it.

use serde_json::{Value, json};

pub struct Film {
    pub id: &'static str,
    pub year: u16,
    pub minutes: u16,
    /// The two colours of its typographic poster.
    pub ink: &'static str,
    pub paper: &'static str,
    /// Where the viewer stopped, seconds (demo data).
    pub stopped_at: Option<u32>,
    /// A magnet the engine can play; demo films without one have no source.
    pub magnet: Option<&'static str>,
}

/// Sintel and Big Buck Bunny (Blender Foundation, CC BY): official torrents.
const SINTEL: &str = "magnet:?xt=urn:btih:08ada5a7a6183aae1e09d831df6748d566095a10&dn=Sintel&tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337&tr=udp%3A%2F%2Fexplodie.org%3A6969&xs=https%3A%2F%2Fwebtorrent.io%2Ftorrents%2Fsintel.torrent";
const BUNNY: &str = "magnet:?xt=urn:btih:dd8255ecdc7ca55fb0bbf81323d87062db1f6d1c&dn=Big+Buck+Bunny&tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337&tr=udp%3A%2F%2Fexplodie.org%3A6969&xs=https%3A%2F%2Fwebtorrent.io%2Ftorrents%2Fbig-buck-bunny.torrent";

pub const FILMS: &[Film] = &[
    Film { id: "sintel", year: 2010, minutes: 15, ink: "#F4E9D8", paper: "#5A2A1F", stopped_at: None, magnet: Some(SINTEL) },
    Film { id: "bunny", year: 2008, minutes: 10, ink: "#2B3A12", paper: "#B8D46A", stopped_at: None, magnet: Some(BUNNY) },
    Film { id: "metropolis", year: 1927, minutes: 153, ink: "#1B1B1B", paper: "#D9B44A", stopped_at: Some(4360), magnet: None },
    Film { id: "nosferatu", year: 1922, minutes: 94, ink: "#E8E0CF", paper: "#3B4A3F", stopped_at: Some(1520), magnet: None },
    Film { id: "general", year: 1926, minutes: 78, ink: "#2A1E14", paper: "#C9A27A", stopped_at: Some(610), magnet: None },
    Film { id: "sherlock", year: 1924, minutes: 45, ink: "#F2EDE4", paper: "#7A2E2E", stopped_at: None, magnet: None },
    Film { id: "detour", year: 1945, minutes: 68, ink: "#F0D9A8", paper: "#22313F", stopped_at: None, magnet: None },
    Film { id: "charade", year: 1963, minutes: 113, ink: "#1F1A17", paper: "#E4A0A8", stopped_at: None, magnet: None },
    Film { id: "friday", year: 1940, minutes: 92, ink: "#F3EEE2", paper: "#2F4858", stopped_at: None, magnet: None },
    Film { id: "night", year: 1968, minutes: 96, ink: "#D8D4CC", paper: "#151515", stopped_at: None, magnet: None },
];

pub fn film(id: &str) -> Option<&'static Film> {
    FILMS.iter().find(|f| f.id == id)
}

fn to_json(f: &Film) -> Value {
    json!({
        "id": f.id,
        "year": f.year,
        "minutes": f.minutes,
        "ink": f.ink,
        "paper": f.paper,
        "stoppedAt": f.stopped_at,
        "playable": f.magnet.is_some(),
    })
}

/// The home shelves: `[{"id", "items": [film…]}]`.
pub fn shelves() -> Value {
    let pick = |keep: &dyn Fn(&Film) -> bool| FILMS.iter().filter(|f| keep(f)).map(to_json).collect::<Vec<_>>();
    json!([
        { "id": "open", "items": pick(&|f| f.magnet.is_some()) },
        { "id": "continue", "items": pick(&|f| f.stopped_at.is_some()) },
        { "id": "noir", "items": pick(&|f| ["detour", "friday", "night", "charade"].contains(&f.id)) },
        { "id": "silent", "items": pick(&|f| f.year < 1930) },
    ])
}

#[cfg(test)]
mod tests {
    #[test]
    fn shelves_hold_the_films() {
        let s = super::shelves();
        assert_eq!(s[0]["id"], "open");
        assert_eq!(s[0]["items"].as_array().unwrap().len(), 2);
        assert_eq!(s[0]["items"][0]["playable"], true);
        assert_eq!(s[1]["items"][0]["stoppedAt"], 4360);
        assert!(super::film("sintel").unwrap().magnet.is_some());
        assert!(super::film("nope").is_none());
    }
}
