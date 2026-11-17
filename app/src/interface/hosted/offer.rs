//! A source offered from a phone (design/partner-source.md): a link opens this device's
//! settings page at `/s?t=<key>&u=<address>` (a partner's Telegram bot builds it from the
//! template reel gave it), the page offers the source here, and nothing is saved until the
//! viewer says yes on the screen. The yes on the screen is what lets it in: the link carries no
//! pairing, and anyone on the network could have sent one.
//!
//! Also here: the template itself and the bot's link (`t.me/<bot>?start=<template>`), with the
//! bot named at build time (`REEL_PARTNER_BOT`).

use std::time::{Duration, Instant};

use serde_json::{Value, json};

/// How long an offer waits for the viewer.
pub const TTL: Duration = Duration::from_secs(10 * 60);
/// The shortest time between two offers (a page that offers in a loop).
pub const SPACING: Duration = Duration::from_secs(2);
/// The longest address or key taken.
const MAX_FIELD: usize = 2048;

#[derive(Debug, Clone, PartialEq)]
pub enum State {
    Pending,
    /// Saved; the check the core started on it.
    Accepted(u32),
    Declined,
}

#[derive(Debug, Clone)]
pub struct Offer {
    pub id: String,
    pub url: String,
    pub key: String,
    pub at: Instant,
    pub state: State,
}

#[derive(Debug, PartialEq)]
pub enum Refused {
    /// Not an http(s) address, or too long.
    Address(String),
    /// Another offer came less than `SPACING` ago.
    TooSoon,
}

/// The one offer there is (a new one replaces it).
#[derive(Default)]
pub struct Offers {
    current: Option<Offer>,
}

impl Offers {
    /// A new offer from the page; its id.
    pub fn offer(&mut self, now: Instant, url: &str, key: &str, random: &mut dyn FnMut(&mut [u8])) -> Result<String, Refused> {
        let (url, key) = (url.trim(), key.trim());
        if url.is_empty() || url.len() > MAX_FIELD || key.len() > MAX_FIELD {
            return Err(Refused::Address("no address".into()));
        }
        crate::application::settings::check_url(url).map_err(Refused::Address)?;
        if self.current.as_ref().is_some_and(|o| now.duration_since(o.at) < SPACING) {
            return Err(Refused::TooSoon);
        }
        let mut bytes = [0u8; 12];
        random(&mut bytes);
        let id = base64url(&bytes);
        self.current = Some(Offer { id: id.clone(), url: url.to_owned(), key: key.to_owned(), at: now, state: State::Pending });
        Ok(id)
    }

    /// The offer waiting for the viewer, if one is.
    pub fn pending(&self, now: Instant) -> Option<&Offer> {
        self.current.as_ref().filter(|o| o.state == State::Pending && now.duration_since(o.at) < TTL)
    }

    /// The viewer's answer to the waiting offer: the offer (to save) on a yes.
    pub fn answer(&mut self, now: Instant, accept: bool) -> Option<Offer> {
        self.pending(now)?;
        let o = self.current.as_mut()?;
        if !accept {
            o.state = State::Declined;
            return None;
        }
        Some(o.clone())
    }

    /// The offer was saved and `check` started on it.
    pub fn accepted(&mut self, check: u32) {
        if let Some(o) = self.current.as_mut() {
            o.state = State::Accepted(check);
        }
    }

    /// Where the offer `id` stands: "pending", "accepted" (with the check), "declined" or "expired".
    pub fn status(&self, now: Instant, id: &str) -> (&'static str, Option<u32>) {
        match self.current.as_ref().filter(|o| o.id == id) {
            None => ("expired", None),
            Some(o) => match o.state {
                State::Accepted(c) => ("accepted", Some(c)),
                State::Declined => ("declined", None),
                State::Pending if now.duration_since(o.at) < TTL => ("pending", None),
                State::Pending => ("expired", None),
            },
        }
    }
}

/// Base64url without padding (what Telegram's `start` takes: `A-Z a-z 0-9 _ -`).
pub fn base64url(bytes: &[u8]) -> String {
    const ABC: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let n = chunk.iter().enumerate().fold(0u32, |n, (i, b)| n | (*b as u32) << (16 - 8 * i));
        for i in 0..=chunk.len() {
            out.push(ABC[(n >> (18 - 6 * i) & 63) as usize] as char);
        }
    }
    out
}

/// The partner's bot, named at build time (`REEL_PARTNER_BOT`, a Telegram username); None
/// without one, or with a name Telegram would not take.
pub fn bot() -> Option<&'static str> {
    option_env!("REEL_PARTNER_BOT").map(str::trim).map(|b| b.trim_start_matches('@')).filter(|b| is_username(b))
}

fn is_username(name: &str) -> bool {
    (5..=32).contains(&name.len()) && name.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_')
}

/// Telegram's limit on `start`.
pub const START_MAX: usize = 64;

/// The template a bot fills (`{t}` the key, `{u}` the address) to send the viewer back to
/// `base`: this device's page (`http://192.168.1.10:47392`) or the phone app (`reel:/`).
pub fn template(base: &str) -> String {
    format!("{base}/s?t={{t}}&u={{u}}")
}

/// `https://t.me/<bot>?start=<the template, base64url>`; None when it would not fit `start`.
pub fn bot_link(bot: &str, template: &str) -> Option<String> {
    let start = base64url(template.as_bytes());
    (start.len() <= START_MAX).then(|| format!("https://t.me/{bot}?start={start}"))
}

/// The source in a link that opened the app (`reel://s?t=<key>&u=<address>`, as a partner's bot
/// fills the template): `(address, key)`, or None for any other link. Anyone can make such a
/// link: the app only fills its fields with it, and saves nothing until the viewer does.
pub fn from_link(link: &str) -> Option<(String, String)> {
    let u = reqwest::Url::parse(link).ok()?;
    if u.scheme() != "reel" || u.host_str() != Some("s") || !matches!(u.path(), "" | "/") || u.fragment().is_some() {
        return None;
    }
    let (mut url, mut key) = (None, String::new());
    for (k, v) in u.query_pairs() {
        match k.as_ref() {
            "u" => url = Some(v.into_owned()),
            "t" => key = v.into_owned(),
            _ => return None,
        }
    }
    let url = url.filter(|x| crate::application::settings::check_url(x).is_ok() && !x.is_empty() && x.len() <= MAX_FIELD)?;
    (key.len() <= MAX_FIELD).then_some((url, key))
}

/// The offer as the screen shows it: the host it would search, never the key.
pub fn view(o: Option<&Offer>) -> Value {
    let host = o.and_then(|o| reqwest::Url::parse(&o.url).ok()).and_then(|u| u.host_str().map(str::to_owned));
    json!({ "host": host })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rng(seed: u8) -> impl FnMut(&mut [u8]) {
        move |b: &mut [u8]| b.iter_mut().enumerate().for_each(|(i, x)| *x = seed.wrapping_add(i as u8))
    }

    #[test]
    fn base64url_as_telegram_takes_it() {
        assert_eq!(base64url(b"http://192.168.50.132:47392/s?t={t}&u={u}"), "aHR0cDovLzE5Mi4xNjguNTAuMTMyOjQ3MzkyL3M_dD17dH0mdT17dX0");
        assert_eq!(base64url(b"f"), "Zg");
        assert_eq!(base64url(b"fo"), "Zm8");
        assert_eq!(base64url(b"foo"), "Zm9v");
    }

    #[test]
    fn the_longest_address_on_a_home_network_still_fits_start() {
        let t = template("http://192.168.100.100:65535");
        assert!(bot_link("reel_partner_bot", &t).is_some());
        assert_eq!(bot_link("reel_partner_bot", &template("reel:/")).unwrap(), format!("https://t.me/reel_partner_bot?start={}", base64url(b"reel://s?t={t}&u={u}")));
        assert!(bot_link("b", &template("http://a-very-long-name.example.org:47392")).is_none());
    }

    #[test]
    fn an_offer_waits_for_a_yes_once_and_then_says_how_it_went() {
        let now = Instant::now();
        let mut o = Offers::default();
        assert!(matches!(o.offer(now, "ftp://x", "", &mut rng(1)), Err(Refused::Address(_))));
        let id = o.offer(now, " https://jackett.example.com/api ", "k", &mut rng(1)).unwrap();
        assert_eq!(view(o.pending(now))["host"], "jackett.example.com");
        assert_eq!(o.status(now, &id).0, "pending");
        assert_eq!(o.offer(now + Duration::from_millis(500), "https://b.example", "", &mut rng(2)), Err(Refused::TooSoon));
        let yes = o.answer(now, true).unwrap();
        assert_eq!((yes.url.as_str(), yes.key.as_str()), ("https://jackett.example.com/api", "k"));
        o.accepted(7);
        assert_eq!(o.status(now, &id), ("accepted", Some(7)));
        assert!(o.pending(now).is_none() && o.answer(now, true).is_none(), "a yes counts once");
        assert_eq!(o.status(now, "other").0, "expired");
    }

    #[test]
    fn no_answer_in_time_or_a_no_saves_nothing() {
        let now = Instant::now();
        let mut o = Offers::default();
        let id = o.offer(now, "https://a.example", "", &mut rng(1)).unwrap();
        assert!(o.answer(now + TTL, true).is_none());
        assert_eq!(o.status(now + TTL, &id).0, "expired");
        let later = now + TTL + SPACING;
        let id = o.offer(later, "https://a.example", "", &mut rng(3)).unwrap();
        assert!(o.answer(later, false).is_none());
        assert_eq!(o.status(later, &id).0, "declined");
    }

    #[test]
    fn a_link_to_the_app_gives_its_source_and_nothing_else_does() {
        let link = "reel://s?t=abc%26123&u=https%3A%2F%2Fjackett.example.com%2Fapi%3Fx%3D1";
        assert_eq!(from_link(link), Some(("https://jackett.example.com/api?x=1".into(), "abc&123".into())));
        assert_eq!(from_link("reel://s?u=http%3A%2F%2Fnas%3A9117%2Fapi"), Some(("http://nas:9117/api".into(), String::new())));
        for bad in ["reel://x?t=a&u=http%3A%2F%2Fa", "reel://s?t=a", "reel://s?t=a&u=ftp%3A%2F%2Fa", "reel://s?t=a&u=http%3A%2F%2Fa&z=1", "http://s?t=a&u=http%3A%2F%2Fa", "reel://s/x?u=http%3A%2F%2Fa"] {
            assert_eq!(from_link(bad), None, "{bad}");
        }
    }

    #[test]
    fn a_bot_name_is_a_telegram_username() {
        assert!(is_username("reel_partner_bot"));
        assert!(!is_username("bot"));
        assert!(!is_username("evil.com/x"));
    }
}
