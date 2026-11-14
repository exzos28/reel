//! Settings from a phone (docs/hosted-settings.md): a page this device serves on the local
//! network, where a browser paired with a code from the screen sets the search source, the
//! content language and the playback buffer. Everything but the listener is here, so every
//! host that serves the LAN (the Samsung TV's core, later Android TV) shares it: the host
//! routes `GET /settings` to [`PAGE`] and `/settings/api/*` to [`handle`], and says the port
//! with [`serving_on`].

mod pairing;

use std::{
    collections::HashSet,
    net::{IpAddr, UdpSocket},
    sync::{
        LazyLock, Mutex,
        atomic::{AtomicU16, Ordering},
    },
    time::Instant,
};

use serde::Deserialize;
use serde_json::{Value, json};

use crate::{
    application::{catalog, settings},
    wiring::playback,
};
use pairing::{Pairing, Refused};

/// The page, self-contained (no resource from elsewhere).
pub const PAGE: &str = include_str!("page.html");
/// Where the API lives; the page is at `/settings`.
pub const API: &str = "/settings/api";

/// The port the host serves the page on; 0 while none does.
static SERVING: AtomicU16 = AtomicU16::new(0);
static PAIRING: LazyLock<Mutex<Pairing>> = LazyLock::new(Default::default);
/// The source checks this API started: the only jobs whose results it gives out.
static CHECKS: LazyLock<Mutex<HashSet<u32>>> = LazyLock::new(Default::default);

/// The host serves the page on `port` (0: no longer).
pub fn serving_on(port: u16) {
    SERVING.store(port, Ordering::Relaxed);
    settings::bump();
}

fn random(buf: &mut [u8]) {
    getrandom::fill(buf).expect("the OS has random bytes");
}

/// This device's address on the local network: the one the OS would send from to reach
/// another network (a UDP socket "connected" to a documentation address, nothing sent).
fn lan_ip() -> Option<IpAddr> {
    let socket = UdpSocket::bind("0.0.0.0:0").ok()?;
    socket.connect("192.0.2.1:9").ok()?;
    let ip = socket.local_addr().ok()?.ip();
    (!ip.is_unspecified() && !ip.is_loopback()).then_some(ip)
}

/// `{"url":"http://192.168.1.20:47392/settings"}`, or `{"url":null}` where nothing serves the
/// page or the device has no address on a network.
pub fn address() -> Value {
    let port = SERVING.load(Ordering::Relaxed);
    let url = (port != 0).then(lan_ip).flatten().map(|ip| format!("http://{ip}:{port}/settings"));
    json!({ "url": url })
}

/// `{"code":"482913","expiresIn":115}` while a code waits to be typed, `{"code":null}` else.
pub fn pairing() -> Value {
    match PAIRING.lock().unwrap().code(Instant::now()) {
        Some((code, left)) => json!({ "code": code, "expiresIn": left }),
        None => json!({ "code": null }),
    }
}

/// The screen's QR code of the page: `{"url":"http://192.168.1.20:47392/settings",
/// "qr":"data:image/svg+xml,…"}`, or `{"url":null,"qr":null}` where the page is not served.
pub fn link() -> Value {
    let Some(url) = address()["url"].as_str().map(str::to_owned) else {
        return json!({ "url": null, "qr": null });
    };
    json!({ "qr": qr_svg(&url), "url": url })
}

/// Whether the page's API asks for a paired session. Off for now: anyone on the local
/// network who opens the page can change the settings (docs/todo.md: review its security).
/// On, a browser pairs with the code the TV shows first (docs/hosted-settings.md).
const PAIRING_REQUIRED: bool = false;

/// `text` as a QR code: an SVG data URL, white on black like reel's screens.
fn qr_svg(text: &str) -> Option<String> {
    let code = qrcode::QrCode::with_error_correction_level(text, qrcode::EcLevel::M).ok()?;
    let svg = code
        .render::<qrcode::render::svg::Color>()
        .quiet_zone(true)
        .dark_color(qrcode::render::svg::Color("#0F0F0F"))
        .light_color(qrcode::render::svg::Color("#F5F5F5"))
        .build();
    let escaped: String = svg
        .chars()
        .map(|c| match c {
            '%' => "%25".to_owned(),
            '#' => "%23".to_owned(),
            '<' => "%3C".to_owned(),
            '>' => "%3E".to_owned(),
            '"' => "'".to_owned(),
            '\n' => " ".to_owned(),
            c => c.to_string(),
        })
        .collect();
    Some(format!("data:image/svg+xml,{escaped}"))
}

/// The viewer dismissed the code on the screen.
pub fn cancel_pairing() {
    if PAIRING.lock().unwrap().cancel() {
        settings::bump();
    }
}

/// An HTTP request to the API, as the host's server got it.
pub struct Request<'a> {
    pub method: &'a str,
    /// The path without the query, e.g. `/settings/api/state`.
    pub path: &'a str,
    /// The `Host` header.
    pub host: Option<&'a str>,
    /// The `X-Reel-Session` header.
    pub session: Option<&'a str>,
    pub body: &'a str,
}

/// The header that carries the session.
pub const SESSION_HEADER: &str = "x-reel-session";

#[derive(Debug, PartialEq)]
pub struct Response {
    pub status: u16,
    pub body: Value,
}

fn reply(status: u16, body: Value) -> Response {
    Response { status, body }
}

fn error(status: u16, what: &str) -> Response {
    reply(status, json!({ "error": what }))
}

/// Whether `host` (a `Host` header) names this device by an IP address, as a browser that
/// typed the address does. A name could be a DNS-rebinding page's.
fn host_is_ip(host: &str) -> bool {
    let name = match host.strip_prefix('[') {
        Some(v6) => v6.split(']').next().unwrap_or(""),
        None => host.rsplit_once(':').map_or(host, |(h, port)| if port.chars().all(|c| c.is_ascii_digit()) { h } else { host }),
    };
    name.parse::<IpAddr>().is_ok()
}

#[derive(Deserialize)]
struct Confirm {
    pairing: String,
    code: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SourceIn {
    url: String,
    #[serde(default)]
    key: Option<String>,
    #[serde(default)]
    remove_key: bool,
}

#[derive(Deserialize)]
struct LanguageIn {
    tag: String,
}

#[derive(Deserialize)]
struct BufferIn {
    mb: u32,
}

fn body<'a, T: Deserialize<'a>>(text: &'a str) -> Result<T, Response> {
    serde_json::from_str(text).map_err(|e| reply(400, json!({ "error": "body", "message": e.to_string() })))
}

fn refused(r: Refused) -> Response {
    match r {
        Refused::Wrong(left) => reply(403, json!({ "error": "wrong_code", "attemptsLeft": left })),
        Refused::Expired => error(410, "expired"),
        Refused::Locked(s) => reply(429, json!({ "error": "locked", "retryAfter": s })),
    }
}

/// The source as the page may see it: the address without keys in it, whether a key is set.
fn source_view() -> Value {
    json!({ "url": settings::source_url_redacted(), "hasKey": settings::current()["source"]["hasKey"] })
}

/// What the page shows: the settings it may change, never the key.
fn state() -> Value {
    let all = settings::current();
    json!({
        "source": source_view(),
        "contentLanguage": all["contentLanguage"],
        "contentLanguages": all["contentLanguages"],
        "bufferMB": all["bufferMB"],
        "bufferChoices": all["bufferChoices"],
    })
}

/// Answers a request to the API (`/settings/api/…`).
pub fn handle(req: &Request) -> Response {
    let Some(route) = req.path.strip_prefix(API) else {
        return error(404, "not_found");
    };
    if !req.host.is_some_and(host_is_ip) {
        return error(403, "host");
    }
    if !settings::loaded() {
        return error(503, "not_ready");
    }
    let now = Instant::now();
    match (req.method, route) {
        ("POST", "/pair") => {
            let started = PAIRING.lock().unwrap().start(now, &mut random);
            match started {
                Ok((id, ttl)) => {
                    settings::bump();
                    expire_later(ttl);
                    reply(200, json!({ "pairing": id, "expiresIn": ttl }))
                }
                Err(r) => refused(r),
            }
        }
        ("POST", "/pair/confirm") => {
            let c: Confirm = match body(req.body) {
                Ok(c) => c,
                Err(r) => return r,
            };
            let (result, gone) = {
                let mut p = PAIRING.lock().unwrap();
                let had = p.code(now).is_some();
                let result = p.confirm(now, &c.pairing, &c.code, &mut random);
                (result, had && p.code(now).is_none())
            };
            if gone {
                settings::bump(); // the code left the screen
            }
            match result {
                Ok(session) => reply(200, json!({ "session": session })),
                Err(r) => refused(r),
            }
        }
        (_, "/pair" | "/pair/confirm") => error(405, "method"),
        _ => {
            if PAIRING_REQUIRED && !PAIRING.lock().unwrap().session(now, req.session.unwrap_or("")) {
                return error(401, "session");
            }
            authorized(req, route)
        }
    }
}

fn authorized(req: &Request, route: &str) -> Response {
    match (req.method, route) {
        ("GET", "/state") => reply(200, state()),
        ("POST", "/source") => {
            let s: SourceIn = match body(req.body) {
                Ok(s) => s,
                Err(r) => return r,
            };
            // The address as the page got it (keys cut out) stands for the saved one.
            let saved = settings::source().map(|s| s.url).unwrap_or_default();
            let url = if !saved.is_empty() && s.url.trim() == settings::source_url_redacted() { saved } else { s.url };
            let key = match (s.remove_key, s.key.as_deref().map(str::trim)) {
                (true, _) => Some(""),
                (false, Some(k)) if !k.is_empty() => Some(k),
                _ => None,
            };
            if let Err(message) = settings::set_source_with(&url, key) {
                return reply(400, json!({ "ok": false, "message": message }));
            }
            let check = settings::source().map(|s| playback().check_source(s)).unwrap_or(0);
            if check != 0 {
                CHECKS.lock().unwrap().insert(check);
            }
            reply(200, json!({ "ok": true, "source": source_view(), "check": check }))
        }
        ("GET", r) if r.starts_with("/check/") => match r["/check/".len()..].parse::<u32>() {
            Ok(id) if CHECKS.lock().unwrap().contains(&id) => reply(200, playback().search_result(id)),
            _ => error(404, "not_found"),
        },
        ("POST", "/language") => {
            let l: LanguageIn = match body(req.body) {
                Ok(l) => l,
                Err(r) => return r,
            };
            if !settings::is_content_language(&l.tag) {
                return error(400, "language");
            }
            let now = settings::set_content_language(&l.tag);
            catalog::language_changed();
            reply(200, json!({ "contentLanguage": now }))
        }
        ("POST", "/buffer") => {
            let b: BufferIn = match body(req.body) {
                Ok(b) => b,
                Err(r) => return r,
            };
            if !settings::buffer_choices().contains(&b.mb) {
                return error(400, "buffer");
            }
            reply(200, json!({ "bufferMB": settings::set_buffer_mb(b.mb) }))
        }
        (_, "/state" | "/source" | "/language" | "/buffer") => error(405, "method"),
        _ => error(404, "not_found"),
    }
}

/// Takes the code off the screen once its time is up.
fn expire_later(ttl: u64) {
    catalog::runtime().spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(ttl) + std::time::Duration::from_millis(500)).await;
        if PAIRING.lock().unwrap().expire(Instant::now()) {
            settings::bump();
        }
    });
}

#[cfg(test)]
mod tests;
