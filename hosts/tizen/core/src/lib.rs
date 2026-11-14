//! reel's Rust core on a Samsung TV: the modules of app/'s crate (`reel_app`), served to the
//! TV app's web UI as a JSON RPC on 127.0.0.1 (`reel_rpc`). The .NET service (service/)
//! loads this library and calls [`reel_core_start`]; `src/main.rs` serves the same on a
//! desktop, to run the web build in a browser against it.

mod logs;
mod table;

use std::{
    ffi::{CStr, c_char},
    net::{Ipv4Addr, SocketAddr},
    path::PathBuf,
    sync::{Arc, Mutex, OnceLock},
};

pub use table::registry;

/// The port the web UI calls. Fixed: the UI has no other way to find the core.
pub const DEFAULT_PORT: u16 = 47_391;

/// The player profile on a Samsung TV (AVPlay: no DTS, no TrueHD, no Dolby-Vision-only
/// releases; MKV and MP4 play): what `Sources` filters releases by (app/src/sources/compat.rs).
pub const TIZEN_PROFILE: &str = "tizen";

/// What the core needs from its host.
#[derive(Debug, Clone)]
pub struct Config {
    pub port: u16,
    pub token: String,
    /// Where settings and the metadata cache live (Tizen: the app's `data/`).
    pub data_dir: PathBuf,
    /// Where the engine keeps the pieces of what plays (Tizen: the app's `cache/`, on flash;
    /// the default temp dir may be a small RAM disk).
    pub cache_dir: PathBuf,
    /// The NSH web build, served under /ui/ (Tizen: the web app's `web/` in the package).
    pub ui_dir: Option<PathBuf>,
    /// The player profile set before serving (`Sources.setProfile`); None keeps the core's
    /// default for the platform it was built for.
    pub profile: Option<String>,
}

/// A running core.
pub struct Running {
    pub port: u16,
    pub token: reel_rpc::Token,
}

/// Binds the port now (so a busy port is reported to the caller) and serves on a thread of
/// its own with its own runtime.
pub fn start(config: Config) -> Result<Running, String> {
    // The engine puts its cache in the temp dir (app/src/engine.rs `cache_dir`). Set before
    // the engine starts; see docs/tizen.md for the app/ change that makes this a parameter.
    // SAFETY: called once, before this library starts any thread; the host's own threads
    // (the .NET runtime) do not read TMPDIR.
    unsafe { std::env::set_var("TMPDIR", &config.cache_dir) };
    std::fs::create_dir_all(&config.data_dir).map_err(|e| format!("creating {}: {e}", config.data_dir.display()))?;
    std::fs::create_dir_all(&config.cache_dir).map_err(|e| format!("creating {}: {e}", config.cache_dir.display()))?;

    if let Some(name) = &config.profile {
        if !reel_app::Sources::set_profile(name.clone()) {
            return Err(format!("unknown player profile {name:?}"));
        }
    }
    let token = reel_rpc::Token::new(&config.token)?;
    let addr = SocketAddr::from((Ipv4Addr::LOCALHOST, config.port));
    let listener = std::net::TcpListener::bind(addr).map_err(|e| format!("binding {addr}: {e}"))?;
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();

    let registry = Arc::new(registry(config.data_dir.clone()));
    let info = serde_json::json!({
        "core": env!("CARGO_PKG_VERSION"),
        "dataDir": config.data_dir,
        "cacheDir": config.cache_dir,
        "profile": config.profile,
        "methods": registry.names(),
        "ui": config.ui_dir.as_ref().map(|d| serde_json::json!({
            "dir": d,
            "index": d.join("index.html").is_file(),
        })),
    });
    let router = reel_rpc::router(registry, token.clone(), info, config.ui_dir.clone())
        .route("/img", axum::routing::get(thumb));

    let runtime = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .thread_name("reel-rpc")
        .build()
        .map_err(|e| format!("starting the runtime: {e}"))?;
    std::thread::Builder::new()
        .name("reel-core".into())
        .spawn(move || {
            runtime.block_on(async move {
                match tokio::net::TcpListener::from_std(listener) {
                    Ok(l) => {
                        if let Err(e) = reel_rpc::serve(l, router).await {
                            eprintln!("reel core: server stopped: {e}");
                        }
                    }
                    Err(e) => eprintln!("reel core: {e}"),
                }
            })
        })
        .map_err(|e| e.to_string())?;
    eprintln!("reel core: serving on 127.0.0.1:{port}, data {}", config.data_dir.display());
    Ok(Running { port, token })
}

// ---- C ABI for the .NET service (service/ReelCore_App.cs P/Invokes these) ----

static RUNNING: OnceLock<Running> = OnceLock::new();
static LAST_ERROR: Mutex<String> = Mutex::new(String::new());

fn fail(code: i32, message: String) -> i32 {
    eprintln!("reel core: {message}");
    *LAST_ERROR.lock().unwrap_or_else(|e| e.into_inner()) = message;
    code
}

/// # Safety
/// `p` is null or a NUL-terminated string.
unsafe fn string(p: *const c_char, what: &str) -> Result<String, String> {
    if p.is_null() {
        return Err(format!("{what} is null"));
    }
    // SAFETY: the caller's contract.
    unsafe { CStr::from_ptr(p) }.to_str().map(str::to_owned).map_err(|_| format!("{what} is not UTF-8"))
}

/// Sends stdout and stderr (the app's `eprintln!` log) to `path`, appending.
fn log_to(path: &str) -> Result<(), String> {
    use std::os::fd::AsRawFd;
    let file = std::fs::OpenOptions::new().create(true).append(true).open(path).map_err(|e| format!("{path}: {e}"))?;
    // SAFETY: dup2 onto the standard descriptors; `file` stays open until both are duplicated.
    unsafe {
        if libc::dup2(file.as_raw_fd(), 1) < 0 || libc::dup2(file.as_raw_fd(), 2) < 0 {
            return Err(format!("dup2: {}", std::io::Error::last_os_error()));
        }
    }
    Ok(())
}

/// Starts the core: 0 when it serves, 1 when it was already running (its token is replaced
/// by `token`), a negative code on failure (message from [`reel_core_last_error`]).
/// `ui_dir` may be null (no web build to serve), `log_path` too (keep the host's stdout/stderr).
///
/// # Safety
/// The string arguments are NUL-terminated (`ui_dir` and `log_path` may be null).
#[unsafe(no_mangle)]
pub unsafe extern "C" fn reel_core_start(
    port: u16,
    token: *const c_char,
    data_dir: *const c_char,
    cache_dir: *const c_char,
    ui_dir: *const c_char,
    log_path: *const c_char,
) -> i32 {
    let result = std::panic::catch_unwind(|| {
        // SAFETY: the caller's contract.
        let (token, data_dir, cache_dir) = unsafe { (string(token, "token")?, string(data_dir, "data_dir")?, string(cache_dir, "cache_dir")?) };
        if !log_path.is_null() {
            // SAFETY: the caller's contract.
            log_to(&unsafe { string(log_path, "log_path")? })?;
        }
        // Up before the core, so a core that does not start can still say why.
        logs::serve_once(PathBuf::from(&data_dir));
        if let Some(running) = RUNNING.get() {
            running.token.set(&token)?;
            return Ok(1);
        }
        // SAFETY: the caller's contract.
        let ui_dir = if ui_dir.is_null() { None } else { Some(PathBuf::from(unsafe { string(ui_dir, "ui_dir")? })) };
        // This library is the core of the TV host: the TV's player decides what plays.
        let profile = Some(TIZEN_PROFILE.to_owned());
        let running = start(Config { port, token, data_dir: data_dir.into(), cache_dir: cache_dir.into(), ui_dir, profile })?;
        let _ = RUNNING.set(running);
        Ok(0)
    });
    match result {
        Ok(Ok(code)) => code,
        Ok(Err(message)) => fail(-1, message),
        Err(_) => fail(-2, "panicked while starting".into()),
    }
}

/// Replaces the token of the running core: 0, or a negative code.
///
/// # Safety
/// `token` is a NUL-terminated string.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn reel_core_set_token(token: *const c_char) -> i32 {
    // SAFETY: the caller's contract.
    let token = match unsafe { string(token, "token") } {
        Ok(t) => t,
        Err(e) => return fail(-1, e),
    };
    match RUNNING.get() {
        Some(r) => r.token.set(&token).map(|_| 0).unwrap_or_else(|e| fail(-1, e)),
        None => fail(-3, "the core is not running".into()),
    }
}

/// Copies the last error message (UTF-8, NUL-terminated, truncated to fit) into `buf`;
/// returns the full message length in bytes.
///
/// # Safety
/// `buf` points to `len` writable bytes (or is null with `len` 0).
#[unsafe(no_mangle)]
pub unsafe extern "C" fn reel_core_last_error(buf: *mut c_char, len: usize) -> usize {
    let message = LAST_ERROR.lock().unwrap_or_else(|e| e.into_inner()).clone();
    if !buf.is_null() && len > 0 {
        let n = message.len().min(len - 1);
        // SAFETY: `buf` has `len` bytes and `n < len`.
        unsafe {
            std::ptr::copy_nonoverlapping(message.as_ptr(), buf.cast::<u8>(), n);
            *buf.add(n) = 0;
        }
    }
    message.len()
}

/// `GET /img?w=500&src=…`: a provider's picture shrunk for the TV's cards (app/src/thumbs.rs;
/// only the hosts it knows, so no token: an <img> sends none).
async fn thumb(axum::extract::Query(q): axum::extract::Query<std::collections::HashMap<String, String>>) -> axum::response::Response {
    use axum::http::{header, StatusCode};
    use axum::response::IntoResponse;
    let (Some(src), Some(width)) = (q.get("src"), q.get("w").and_then(|w| w.parse::<u32>().ok())) else {
        return (StatusCode::BAD_REQUEST, "w and src").into_response();
    };
    match reel_app::thumbs::get(src, width).await {
        Ok(bytes) => ([(header::CONTENT_TYPE, "image/jpeg"), (header::CACHE_CONTROL, "max-age=2592000")], bytes).into_response(),
        Err(e) => (StatusCode::BAD_GATEWAY, e).into_response(),
    }
}
