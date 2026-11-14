//! Jikan (unofficial MyAnimeList API, no key): the MAL score of an anime
//! entry. Limits: about 3 requests a second and 60 a minute, 429 beyond
//! (the service's limiter for it is 1/s with a burst of 3).

use serde_json::Value;

use super::{cache::CacheKind, model::*, provider::*};

pub const API: &str = "https://api.jikan.moe/v4";

pub struct Jikan;

impl Jikan {
    pub fn anime_request(&self, mal: u64) -> Request {
        Request {
            provider: ProviderId::Jikan,
            key: format!("jikan:anime:{mal}"),
            kind: CacheKind::Rating,
            call: Call::Get { url: format!("{API}/anime/{mal}"), query: vec![], auth: Auth::None },
        }
    }

    /// The MAL score; None when MAL has none yet (not aired, too few votes).
    pub fn map_score(&self, body: &Value) -> Result<Option<Rating>, ProviderError> {
        let data = body.get("data").filter(|d| d.is_object()).ok_or_else(|| parse_err("no data"))?;
        Ok(f(data, "score").map(|score| Rating {
            source: RatingSource::Mal,
            value: score as f32,
            scale: 10.0,
            votes: u(data, "scored_by"),
        }))
    }
}

impl Provider for Jikan {
    fn id(&self) -> ProviderId {
        ProviderId::Jikan
    }

    fn capabilities(&self) -> &'static [Capability] {
        &[Capability::Ratings]
    }

    fn requires_key(&self) -> bool {
        false
    }

    fn configured(&self) -> bool {
        true
    }

    fn attribution(&self) -> Attribution {
        Attribution {
            provider: ProviderId::Jikan,
            name: "Jikan (MyAnimeList)",
            url: "https://jikan.moe",
            notice: None,
            logo_required: false,
            license: None,
        }
    }
}
