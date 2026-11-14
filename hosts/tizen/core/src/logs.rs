//! The TV's logs for whoever develops reel, on the local network: `GET http://<TV>:47392/logs`
//! answers with the core's log (data/core.log, its end), the service's startup error and the TV
//! app's own journal (which the app POSTs to /shell-log from the TV itself). Read only, and keys
//! in URLs are cut out. `scripts/tizen-logs.sh <TV IP>` fetches it.

use std::{
    net::{Ipv4Addr, SocketAddr},
    path::{Path, PathBuf},
    sync::{Mutex, Once},
};

use axum::{
    Router,
    extract::{ConnectInfo, State},
    http::{StatusCode, header},
    response::IntoResponse,
    routing::{get, post},
};

pub const LOGS_PORT: u16 = 47_392;
/// How much of the end of core.log /logs answers with.
const CORE_LOG_TAIL: u64 = 512 * 1024;

static SHELL_LOG: Mutex<String> = Mutex::new(String::new());
/// The app's own lines (its console's warnings and errors), newest last.
static APP_LOG: Mutex<Vec<String>> = Mutex::new(Vec::new());
const APP_LOG_LINES: usize = 2000;
static STARTED: Once = Once::new();

/// Serves the logs on a thread of its own, once per process; a busy port is logged, not fatal.
pub fn serve_once(data_dir: PathBuf) {
    STARTED.call_once(|| {
        let spawned = std::thread::Builder::new().name("reel-logs".into()).spawn(move || {
            let runtime = match tokio::runtime::Builder::new_current_thread().enable_all().build() {
                Ok(r) => r,
                Err(e) => return eprintln!("reel logs: {e}"),
            };
            runtime.block_on(async move {
                let addr = SocketAddr::from((Ipv4Addr::UNSPECIFIED, LOGS_PORT));
                match tokio::net::TcpListener::bind(addr).await {
                    Ok(l) => {
                        eprintln!("reel logs: GET http://<this TV>:{LOGS_PORT}/logs");
                        let app = router(data_dir).into_make_service_with_connect_info::<SocketAddr>();
                        if let Err(e) = axum::serve(l, app).await {
                            eprintln!("reel logs: stopped: {e}");
                        }
                    }
                    Err(e) => eprintln!("reel logs: binding {addr}: {e}"),
                }
            });
        });
        if let Err(e) = spawned {
            eprintln!("reel logs: {e}");
        }
    });
}

fn router(data_dir: PathBuf) -> Router {
    Router::new()
        .route("/logs", get(logs))
        .route("/shell-log", post(shell_log))
        .route("/app-log", post(app_log))
        .with_state(data_dir)
}

async fn logs(State(data_dir): State<PathBuf>) -> impl IntoResponse {
    let shell = SHELL_LOG.lock().unwrap_or_else(|e| e.into_inner()).clone();
    let text = format!(
        "=== startup-error.txt ===\n{}\n=== core.log (end) ===\n{}\n=== TV app (shell) ===\n{}\n=== app (web UI) ===\n{}\n",
        read(&data_dir.join("startup-error.txt"), u64::MAX),
        read(&data_dir.join("core.log"), CORE_LOG_TAIL),
        shell,
        APP_LOG.lock().unwrap_or_else(|e| e.into_inner()).join("\n"),
    );
    ([(header::CONTENT_TYPE, "text/plain; charset=utf-8")], redact(&text))
}

/// The TV app's journal, whole each time; only from the TV itself.
async fn shell_log(ConnectInfo(peer): ConnectInfo<SocketAddr>, body: String) -> impl IntoResponse {
    if !peer.ip().is_loopback() {
        return StatusCode::FORBIDDEN;
    }
    *SHELL_LOG.lock().unwrap_or_else(|e| e.into_inner()) = body.chars().take(256 * 1024).collect();
    StatusCode::NO_CONTENT
}

/// Lines of the app's console, appended; only from the TV itself.
async fn app_log(ConnectInfo(peer): ConnectInfo<SocketAddr>, body: String) -> impl IntoResponse {
    if !peer.ip().is_loopback() {
        return StatusCode::FORBIDDEN;
    }
    let mut log = APP_LOG.lock().unwrap_or_else(|e| e.into_inner());
    log.extend(body.lines().map(|l| l.chars().take(2000).collect::<String>()));
    let over = log.len().saturating_sub(APP_LOG_LINES);
    log.drain(..over);
    StatusCode::NO_CONTENT
}

/// The last `tail` bytes of a file, or why it could not be read.
fn read(path: &Path, tail: u64) -> String {
    use std::io::{Read, Seek, SeekFrom};
    let mut f = match std::fs::File::open(path) {
        Ok(f) => f,
        Err(e) => return format!("({}: {e})", path.display()),
    };
    let len = f.metadata().map(|m| m.len()).unwrap_or(0);
    if len > tail {
        let _ = f.seek(SeekFrom::Start(len - tail));
    }
    let mut bytes = Vec::new();
    let _ = f.read_to_end(&mut bytes);
    String::from_utf8_lossy(&bytes).into_owned()
}

/// Cuts the values of key-like URL parameters: apikey, passkey, pk, token, api_key.
fn redact(text: &str) -> String {
    const KEYS: [&str; 5] = ["apikey=", "passkey=", "api_key=", "token=", "pk="];
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    'outer: while !rest.is_empty() {
        let lower = rest.to_ascii_lowercase();
        let found = KEYS.iter().filter_map(|k| lower.find(k).map(|i| (i, k.len()))).min();
        match found {
            Some((i, n)) if i == 0 || !rest.as_bytes()[i - 1].is_ascii_alphanumeric() => {
                out.push_str(&rest[..i + n]);
                out.push('…');
                let after = &rest[i + n..];
                let end = after.find(|c: char| c == '&' || c.is_whitespace() || c == '"' || c == '\'').unwrap_or(after.len());
                rest = &after[end..];
            }
            Some((i, n)) => {
                out.push_str(&rest[..i + n]);
                rest = &rest[i + n..];
                continue 'outer;
            }
            None => {
                out.push_str(rest);
                break;
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::redact;

    #[test]
    fn keys_are_cut_from_urls() {
        assert_eq!(redact("GET http://h/api?apikey=s3cr3t&t=search"), "GET http://h/api?apikey=…&t=search");
        assert_eq!(redact("X-Token=abc magnet:?xt=1&pk=zzz end"), "X-Token=… magnet:?xt=1&pk=… end");
        assert_eq!(redact("checkpk=1 apk=2"), "checkpk=1 apk=2", "not inside a longer name");
        assert_eq!(redact("nothing here"), "nothing here");
    }
}
