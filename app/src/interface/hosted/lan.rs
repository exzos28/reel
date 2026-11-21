//! The settings page on the local network from inside the app, where the app is the TV:
//! Android TV (docs/hosted-settings.md). A Samsung TV's core serves it from a listener of its own
//! (platforms/tizen/core/src/logs.rs); a phone, a tablet and a desktop do not serve it. The same
//! port, routes and headers as there; `hosted::handle` answers the API.

use std::{
    net::{Ipv4Addr, SocketAddr},
    sync::OnceLock,
};

use axum::{
    Router,
    http::{HeaderMap, Method, StatusCode, Uri, header},
    response::IntoResponse,
    routing::{any, get},
};

/// The port a Samsung TV serves the page on too, so the address reads the same.
pub const PORT: u16 = 47_392;

/// Whether this device serves the page: Android TV only. `android`: this is Android's build;
/// `family`: the platform family the UI reported (`compat::family`). A phone or a tablet has a
/// keyboard at hand, and a Samsung TV's core serves the page itself.
pub fn serves_here(android: bool, family: Option<&str>) -> bool {
    android && family == Some("tv")
}

/// The port the page is served on, once a start bound it; `None` when the port was busy.
static LISTENING: OnceLock<Option<u16>> = OnceLock::new();

/// Serves the page on the LAN where this device should (`serves_here`), once per process: the
/// UI loads the settings again when it mounts again (an Activity made again), and the listener
/// stays the first one. A busy port is logged, not fatal.
pub fn start() {
    if !serves_here(cfg!(target_os = "android"), reel_domain::compat::family()) {
        return;
    }
    start_once(&LISTENING, SocketAddr::from((Ipv4Addr::UNSPECIFIED, PORT)), super::serving_on);
}

/// The first call binds `addr`, serves the page there and tells `serving(port)`; every later call
/// answers the first one's port and binds nothing.
fn start_once(gate: &OnceLock<Option<u16>>, addr: SocketAddr, serving: impl FnOnce(u16)) -> Option<u16> {
    *gate.get_or_init(|| match listen(addr) {
        Ok(port) => {
            tracing::info!("reel: settings page for a phone at http://<this TV>:{port}/settings");
            serving(port);
            Some(port)
        }
        Err(e) => {
            tracing::warn!("reel: the settings page for a phone is off, binding {addr}: {e}");
            None
        }
    })
}

/// Binds `addr` now (the port is known and a busy one fails here) and serves the page on a
/// thread of its own for as long as the process lives.
fn listen(addr: SocketAddr) -> std::io::Result<u16> {
    let socket = std::net::TcpListener::bind(addr)?;
    socket.set_nonblocking(true)?;
    let port = socket.local_addr()?.port();
    let runtime = tokio::runtime::Builder::new_current_thread().enable_all().build()?;
    let listener = {
        let _in = runtime.enter();
        tokio::net::TcpListener::from_std(socket)?
    };
    std::thread::Builder::new().name("reel-hosted".into()).spawn(move || {
        runtime.block_on(async move {
            if let Err(e) = axum::serve(listener, router()).await {
                tracing::warn!("reel: the settings page for a phone stopped: {e}");
            }
        });
    })?;
    Ok(port)
}

fn router() -> Router {
    Router::new()
        .route("/settings", get(page))
        // The same page at the short address a partner's link opens.
        .route(super::SHORT_PAGE, get(page))
        .route("/settings/api/{*rest}", any(api))
}

/// The page itself: no data in it, and nothing it may load from elsewhere.
async fn page() -> impl IntoResponse {
    (
        [
            (header::CONTENT_TYPE, "text/html; charset=utf-8"),
            (header::CACHE_CONTROL, "no-store"),
            (header::REFERRER_POLICY, "no-referrer"),
            (header::X_FRAME_OPTIONS, "DENY"),
            (
                header::CONTENT_SECURITY_POLICY,
                "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; form-action 'none'",
            ),
        ],
        super::PAGE,
    )
}

/// The page's API, answered by `hosted::handle`. No CORS headers: only the page, from this
/// origin, may call it.
async fn api(method: Method, uri: Uri, headers: HeaderMap, body: String) -> impl IntoResponse {
    // Blocking: a write saves settings.json, a check asks the engine.
    let answer = tokio::task::spawn_blocking(move || {
        let text = |name| headers.get(name).and_then(|v: &axum::http::HeaderValue| v.to_str().ok());
        super::handle(&super::Request {
            method: method.as_str(),
            path: uri.path(),
            host: text(header::HOST.as_str()),
            session: text(super::SESSION_HEADER),
            body: &body,
        })
    })
    .await;
    let json = [(header::CONTENT_TYPE, "application/json"), (header::CACHE_CONTROL, "no-store")];
    match answer {
        Ok(r) => (StatusCode::from_u16(r.status).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR), json, r.body.to_string()),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, json, serde_json::json!({ "error": e.to_string() }).to_string()),
    }
}

#[cfg(test)]
mod tests {
    use std::{
        io::{Read, Write},
        net::{SocketAddr, TcpStream},
        sync::OnceLock,
    };

    use super::{serves_here, start_once};

    fn request(port: u16, raw: &str) -> (u16, String, String) {
        let mut conn = TcpStream::connect(("127.0.0.1", port)).unwrap();
        conn.write_all(raw.as_bytes()).unwrap();
        let mut out = String::new();
        conn.read_to_string(&mut out).unwrap();
        let (head, body) = out.split_once("\r\n\r\n").unwrap();
        let status = head.split(' ').nth(1).unwrap().parse().unwrap();
        (status, head.to_ascii_lowercase(), body.to_owned())
    }

    #[test]
    fn only_android_tv_serves_the_page() {
        assert!(serves_here(true, Some("tv")));
        for family in [Some("phone"), Some("tablet"), None] {
            assert!(!serves_here(true, family), "an Android {family:?}");
        }
        // A Samsung TV's core serves it itself; a development host standing in for a TV does not.
        assert!(!serves_here(false, Some("tv")));
        assert!(!serves_here(false, Some("mac")));
    }

    /// Started again (the UI mounted again, the Activity made again), it keeps the first
    /// listener and binds nothing more; that one serves the page and its API.
    #[test]
    fn one_listener_however_often_it_starts() {
        let gate = OnceLock::new();
        let addr = SocketAddr::from(([127, 0, 0, 1], 0));
        let mut told = Vec::new();
        let first = start_once(&gate, addr, |p| told.push(p)).expect("a free port");
        assert_eq!(start_once(&gate, addr, |p| told.push(p)), Some(first));
        assert_eq!(start_once(&gate, addr, |p| told.push(p)), Some(first));
        assert_eq!(told, [first], "the port is told once");

        let (status, head, body) = request(first, "GET /settings HTTP/1.1\r\nHost: 192.168.1.20\r\nConnection: close\r\n\r\n");
        assert_eq!(status, 200);
        assert!(head.contains("content-type: text/html"));
        assert!(head.contains("content-security-policy: default-src 'none'"));
        assert!(body.contains("Pair with the TV"));
        assert_eq!(request(first, "GET /s HTTP/1.1\r\nHost: 192.168.1.20\r\nConnection: close\r\n\r\n").0, 200);

        let (status, head, body) = request(first, "POST /settings/api/pair HTTP/1.1\r\nHost: evil.example:47392\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
        assert_eq!((status, body.as_str()), (403, r#"{"error":"host"}"#), "hosted::handle answers");
        assert!(head.contains("content-type: application/json"));
        assert!(!head.contains("access-control-allow-origin"), "no CORS: only the page calls it");
    }

    #[test]
    fn a_busy_port_leaves_the_page_off() {
        let taken = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let gate = OnceLock::new();
        let busy = taken.local_addr().unwrap();
        assert_eq!(start_once(&gate, busy, |_| panic!("not served")), None);
        // Not tried again: the port stays the first start's answer.
        drop(taken);
        assert_eq!(start_once(&gate, busy, |_| panic!("not served")), None);
    }
}
