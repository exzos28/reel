//! NSH native modules as a JSON RPC over HTTP on 127.0.0.1.
//!
//! On the web target NSH cannot load the app's Rust crate (`#[native_module]` is not built
//! for wasm32), so on a Samsung TV the crate runs natively in a service and the web UI calls
//! its modules over HTTP:
//!
//! ```text
//! POST /rpc      {"module":"Engine","method":"open","args":["sintel"]}
//!   200          {"ok":true,"value":7}
//!   4xx / 500    {"ok":false,"error":"…"}
//! GET  /health   {"ok":true,"info":{…host info…}}
//! GET  /ui/…     the web build's files (when the host has one): the TV app loads the UI from
//!                here, so the UI and the RPC share an origin and the UI's `fetch` of its own
//!                files works (a packaged widget's file:// URLs do not take `fetch`)
//! ```
//!
//! Every request to /health and /rpc but the CORS preflight carries `X-Reel-Token`; the TV app generates the
//! token and hands it to the service when it starts it, so other pages and apps on the TV
//! (which can reach 127.0.0.1 too) cannot drive the core. Method names are the ones NSH
//! gives the TSX side (camelCase), arguments are positional as in the TS declarations.

use std::{
    collections::HashMap,
    future::Future,
    path::PathBuf,
    pin::Pin,
    sync::{Arc, RwLock},
};

use axum::{
    Json, Router,
    extract::State,
    http::{HeaderMap, HeaderValue, Method, StatusCode, header},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use serde_json::{Value, json};

/// The header that carries the token.
pub const TOKEN_HEADER: &str = "x-reel-token";

/// A call's outcome: the JSON value, or an error message for the caller.
pub type Reply = Result<Value, Error>;
type BoxFut = Pin<Box<dyn Future<Output = Reply> + Send>>;
type Handler = Arc<dyn Fn(Value) -> BoxFut + Send + Sync>;

/// Why a call failed; each maps to an HTTP status.
#[derive(Debug, Clone, PartialEq)]
pub enum Error {
    /// The arguments do not fit the method (400).
    BadArgs(String),
    /// No such module or method (404).
    Unknown(String),
    /// The method ran and failed, or panicked (500).
    Failed(String),
}

impl Error {
    fn status(&self) -> StatusCode {
        match self {
            Error::BadArgs(_) => StatusCode::BAD_REQUEST,
            Error::Unknown(_) => StatusCode::NOT_FOUND,
            Error::Failed(_) => StatusCode::INTERNAL_SERVER_ERROR,
        }
    }

    fn message(&self) -> &str {
        match self {
            Error::BadArgs(m) | Error::Unknown(m) | Error::Failed(m) => m,
        }
    }
}

/// Decodes the positional arguments as a tuple: `let (job, pos): (u32, f64) = args(a)?`.
/// The count must match exactly (serde checks a tuple's length).
pub fn args<T: DeserializeOwned>(args: Value) -> Result<T, Error> {
    serde_json::from_value(args).map_err(|e| Error::BadArgs(e.to_string()))
}

/// For methods without arguments: `[]` only.
pub fn no_args(args: &Value) -> Result<(), Error> {
    match args.as_array() {
        Some(a) if a.is_empty() => Ok(()),
        _ => Err(Error::BadArgs(format!("expected no arguments, got {args}"))),
    }
}

/// A method's result as the reply value.
pub fn ret<T: Serialize>(value: T) -> Reply {
    serde_json::to_value(value).map_err(|e| Error::Failed(e.to_string()))
}

/// The modules and their methods, by the names the TSX side uses.
#[derive(Default, Clone)]
pub struct Registry {
    methods: HashMap<(String, String), Handler>,
}

impl Registry {
    pub fn new() -> Self {
        Self::default()
    }

    /// A synchronous method. It runs on a blocking thread: the app's code may block (the
    /// engine starts its own runtime with `block_on`, which must not run on a runtime thread).
    pub fn sync<F>(&mut self, module: &str, method: &str, f: F) -> &mut Self
    where
        F: Fn(Value) -> Reply + Send + Sync + 'static,
    {
        let f = Arc::new(f);
        let name = format!("{module}.{method}");
        self.insert(module, method, move |args| {
            let f = f.clone();
            let name = name.clone();
            Box::pin(async move {
                match tokio::task::spawn_blocking(move || f(args)).await {
                    Ok(reply) => reply,
                    Err(e) => Err(Error::Failed(format!("{name} panicked: {e}"))),
                }
            })
        })
    }

    /// An asynchronous method (an `async fn` of the module), run on the server's runtime.
    pub fn r#async<F, Fut>(&mut self, module: &str, method: &str, f: F) -> &mut Self
    where
        F: Fn(Value) -> Fut + Send + Sync + 'static,
        Fut: Future<Output = Reply> + Send + 'static,
    {
        self.insert(module, method, move |args| Box::pin(f(args)))
    }

    fn insert(&mut self, module: &str, method: &str, h: impl Fn(Value) -> BoxFut + Send + Sync + 'static) -> &mut Self {
        let old = self.methods.insert((module.to_owned(), method.to_owned()), Arc::new(h));
        assert!(old.is_none(), "{module}.{method} registered twice");
        self
    }

    /// Calls `module.method` with the positional `args` (a JSON array).
    pub async fn call(&self, module: &str, method: &str, args: Value) -> Reply {
        if !args.is_array() {
            return Err(Error::BadArgs(format!("args must be an array, got {args}")));
        }
        let Some(h) = self.methods.get(&(module.to_owned(), method.to_owned())) else {
            return Err(Error::Unknown(format!("no method {module}.{method}")));
        };
        h(args).await
    }

    /// Every `Module.method`, sorted.
    pub fn names(&self) -> Vec<String> {
        let mut names: Vec<_> = self.methods.keys().map(|(m, f)| format!("{m}.{f}")).collect();
        names.sort();
        names
    }
}

/// The token the requests must carry. It can change while the server runs: the TV app
/// makes a new one each time it starts and hands it to the (possibly running) service.
#[derive(Clone)]
pub struct Token(Arc<RwLock<String>>);

impl Token {
    /// `token` must not be empty: an empty token would let anyone in.
    pub fn new(token: &str) -> Result<Self, String> {
        Self::check(token)?;
        Ok(Self(Arc::new(RwLock::new(token.to_owned()))))
    }

    pub fn set(&self, token: &str) -> Result<(), String> {
        Self::check(token)?;
        *self.0.write().unwrap_or_else(|e| e.into_inner()) = token.to_owned();
        Ok(())
    }

    fn check(token: &str) -> Result<(), String> {
        if token.len() < 16 {
            return Err("the token must be at least 16 characters".into());
        }
        Ok(())
    }

    fn matches(&self, given: Option<&HeaderValue>) -> bool {
        let want = self.0.read().unwrap_or_else(|e| e.into_inner());
        given.is_some_and(|g| g.as_bytes() == want.as_bytes())
    }
}

#[derive(Clone)]
struct Shared {
    registry: Arc<Registry>,
    token: Token,
    info: Arc<Value>,
}

#[derive(Deserialize)]
struct Call {
    module: String,
    method: String,
    #[serde(default = "empty_args")]
    args: Value,
}

fn empty_args() -> Value {
    Value::Array(vec![])
}

/// The HTTP routes. `info` is what `GET /health` answers with (the host's data dir and so on);
/// `ui_dir`, the web build served under /ui/ (no token: it is the app's public code).
pub fn router(registry: Arc<Registry>, token: Token, info: Value, ui_dir: Option<PathBuf>) -> Router {
    let shared = Shared { registry, token, info: Arc::new(info) };
    let mut router = Router::new()
        .route("/health", get(health).options(preflight))
        .route("/rpc", post(rpc).options(preflight))
        .with_state(shared);
    if let Some(dir) = ui_dir {
        let files = tower_http::services::ServeDir::new(dir).precompressed_br().precompressed_gzip();
        router = router.nest_service("/ui", files);
    }
    router.layer(axum::middleware::map_response(cors))
}

/// Serves `router` on `listener` until the process ends.
pub async fn serve(listener: tokio::net::TcpListener, router: Router) -> std::io::Result<()> {
    axum::serve(listener, router).await
}

// The TV app's page is a packaged widget (its origin is not http://127.0.0.1), so every
// answer allows any origin; the token, not the origin, is the access check.
async fn cors(mut res: Response) -> Response {
    let h = res.headers_mut();
    h.insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, HeaderValue::from_static("*"));
    h.insert(header::ACCESS_CONTROL_ALLOW_HEADERS, HeaderValue::from_static("content-type, x-reel-token"));
    h.insert(header::ACCESS_CONTROL_ALLOW_METHODS, HeaderValue::from_static("GET, POST, OPTIONS"));
    h.insert(header::ACCESS_CONTROL_MAX_AGE, HeaderValue::from_static("600"));
    res
}

async fn preflight() -> StatusCode {
    StatusCode::NO_CONTENT
}

fn failure(status: StatusCode, message: &str) -> Response {
    (status, Json(json!({ "ok": false, "error": message }))).into_response()
}

async fn health(State(s): State<Shared>, headers: HeaderMap) -> Response {
    if !s.token.matches(headers.get(TOKEN_HEADER)) {
        return failure(StatusCode::UNAUTHORIZED, "missing or wrong token");
    }
    Json(json!({ "ok": true, "info": *s.info })).into_response()
}

// The body is read as text, not `Json<…>`: a client may send it as text/plain to skip the
// CORS preflight, and axum's Json extractor insists on application/json.
async fn rpc(State(s): State<Shared>, method: Method, headers: HeaderMap, body: String) -> Response {
    debug_assert_eq!(method, Method::POST);
    if !s.token.matches(headers.get(TOKEN_HEADER)) {
        return failure(StatusCode::UNAUTHORIZED, "missing or wrong token");
    }
    let call: Call = match serde_json::from_str(&body) {
        Ok(c) => c,
        Err(e) => return failure(StatusCode::BAD_REQUEST, &format!("bad request body: {e}")),
    };
    match s.registry.call(&call.module, &call.method, call.args).await {
        Ok(value) => Json(json!({ "ok": true, "value": value })).into_response(),
        Err(e) => failure(e.status(), e.message()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    const TOKEN: &str = "0123456789abcdef0123";

    fn registry() -> Registry {
        let mut r = Registry::new();
        r.sync("Fmt", "twice", |a| {
            let (n,): (u32,) = args(a)?;
            ret(n * 2)
        })
        .sync("Fmt", "hello", |a| {
            no_args(&a)?;
            ret("hi")
        })
        .sync("Fmt", "boom", |_| panic!("boom"))
        .r#async("Meta", "echo", |a| async move {
            let (s, n): (String, f64) = args(a)?;
            ret(format!("{s}:{n}"))
        });
        r
    }

    #[tokio::test]
    async fn calls_by_name_with_positional_args() {
        let r = registry();
        assert_eq!(r.call("Fmt", "twice", json!([21])).await, Ok(json!(42)));
        assert_eq!(r.call("Fmt", "hello", json!([])).await, Ok(json!("hi")));
        assert_eq!(r.call("Meta", "echo", json!(["a", 1.5])).await, Ok(json!("a:1.5")));
        assert_eq!(r.names(), ["Fmt.boom", "Fmt.hello", "Fmt.twice", "Meta.echo"]);
    }

    #[tokio::test]
    async fn rejects_wrong_calls() {
        let r = registry();
        assert!(matches!(r.call("Fmt", "twice", json!([])).await, Err(Error::BadArgs(_))));
        assert!(matches!(r.call("Fmt", "twice", json!([1, 2])).await, Err(Error::BadArgs(_))));
        assert!(matches!(r.call("Fmt", "twice", json!(["x"])).await, Err(Error::BadArgs(_))));
        assert!(matches!(r.call("Fmt", "hello", json!([1])).await, Err(Error::BadArgs(_))));
        assert!(matches!(r.call("Fmt", "twice", json!(3)).await, Err(Error::BadArgs(_))));
        assert!(matches!(r.call("Fmt", "nope", json!([])).await, Err(Error::Unknown(_))));
        assert!(matches!(r.call("Fmt", "boom", json!([])).await, Err(Error::Failed(_))));
    }

    #[test]
    fn refuses_short_tokens() {
        assert!(Token::new("").is_err());
        assert!(Token::new("short").is_err());
        assert!(Token::new(TOKEN).unwrap().set("").is_err());
    }

    async fn request(port: u16, raw: String) -> (u16, String, String) {
        let mut conn = tokio::net::TcpStream::connect(("127.0.0.1", port)).await.unwrap();
        conn.write_all(raw.as_bytes()).await.unwrap();
        let mut out = String::new();
        conn.read_to_string(&mut out).await.unwrap();
        let (head, body) = out.split_once("\r\n\r\n").unwrap();
        let status = head.split(' ').nth(1).unwrap().parse().unwrap();
        (status, head.to_ascii_lowercase(), body.to_owned())
    }

    fn post(token: &str, body: &str) -> String {
        format!(
            "POST /rpc HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: text/plain\r\nX-Reel-Token: {token}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        )
    }

    #[tokio::test]
    async fn serves_over_http() {
        let token = Token::new(TOKEN).unwrap();
        let ui = std::env::temp_dir().join(format!("reel-rpc-ui-{}", std::process::id()));
        std::fs::create_dir_all(&ui).unwrap();
        std::fs::write(ui.join("index.html"), "<p>ui</p>").unwrap();
        let app = router(Arc::new(registry()), token.clone(), json!({ "dataDir": "/data" }), Some(ui));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(serve(listener, app));

        let (status, head, body) = request(port, post(TOKEN, r#"{"module":"Fmt","method":"twice","args":[4]}"#)).await;
        assert_eq!(status, 200);
        assert!(head.contains("access-control-allow-origin: *"));
        assert_eq!(serde_json::from_str::<Value>(&body).unwrap(), json!({ "ok": true, "value": 8 }));

        let (status, _, _) = request(port, post("wrong-token-wrong-token", r#"{"module":"Fmt","method":"twice","args":[4]}"#)).await;
        assert_eq!(status, 401);
        let (status, _, body) = request(port, post(TOKEN, r#"{"module":"Fmt","method":"nope"}"#)).await;
        assert_eq!(status, 404);
        assert!(body.contains("Fmt.nope"));
        let (status, _, _) = request(port, post(TOKEN, "not json")).await;
        assert_eq!(status, 400);

        // A new token replaces the old one.
        token.set("fedcba9876543210fedcba").unwrap();
        let (status, _, _) = request(port, post(TOKEN, r#"{"module":"Fmt","method":"hello"}"#)).await;
        assert_eq!(status, 401);
        let (status, _, body) = request(port, post("fedcba9876543210fedcba", r#"{"module":"Fmt","method":"hello"}"#)).await;
        assert_eq!((status, body.as_str()), (200, r#"{"ok":true,"value":"hi"}"#));

        let preflight = "OPTIONS /rpc HTTP/1.1\r\nHost: 127.0.0.1\r\nOrigin: file://\r\nAccess-Control-Request-Method: POST\r\nAccess-Control-Request-Headers: x-reel-token\r\nConnection: close\r\n\r\n";
        let (status, head, _) = request(port, preflight.into()).await;
        assert_eq!(status, 204);
        assert!(head.contains("access-control-allow-headers: content-type, x-reel-token"));

        let health = "GET /health HTTP/1.1\r\nHost: 127.0.0.1\r\nX-Reel-Token: fedcba9876543210fedcba\r\nConnection: close\r\n\r\n";
        let (status, _, body) = request(port, health.into()).await;
        assert_eq!(status, 200);
        assert_eq!(serde_json::from_str::<Value>(&body).unwrap(), json!({ "ok": true, "info": { "dataDir": "/data" } }));

        // The web build, without a token.
        let page = "GET /ui/index.html HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n";
        let (status, head, body) = request(port, page.into()).await;
        assert_eq!((status, body.as_str()), (200, "<p>ui</p>"));
        assert!(head.contains("content-type: text/html"));
    }
}
