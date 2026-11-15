//! HTTP for the providers: one reqwest client (the one librqbit already pulls
//! in), timeouts, a token bucket per provider, and status codes mapped to
//! `ProviderError`.

use std::time::{Duration, Instant};

use serde_json::{Value, json};

use super::provider::{Auth, Call, ProviderError};

/// The longest a call waits for its turn before it reports `RateLimited`.
pub const MAX_WAIT: Duration = Duration::from_secs(10);
pub const TIMEOUT: Duration = Duration::from_secs(15);
pub const CONNECT_TIMEOUT: Duration = Duration::from_secs(8);

pub fn client() -> reqwest::Client {
    crate::adapters::http_client::client_builder()
        .timeout(TIMEOUT)
        .connect_timeout(CONNECT_TIMEOUT)
        .user_agent(concat!("reel/", env!("CARGO_PKG_VERSION")))
        .build()
        .expect("HTTP client")
}

/// A token bucket: `rate` requests a second on average, `burst` at once.
/// A request reserves a token (the count may go below zero) and waits until
/// its token would have refilled.
#[derive(Debug)]
pub struct Bucket {
    rate: f64,
    burst: f64,
    tokens: f64,
    last: Instant,
    blocked_until: Option<Instant>,
}

impl Bucket {
    pub fn new(rate: f64, burst: f64, now: Instant) -> Bucket {
        Bucket { rate, burst, tokens: burst, last: now, blocked_until: None }
    }

    /// Reserves a slot: how long to wait for it, or Err(the wait) when that is
    /// longer than `max` (nothing is reserved then).
    pub fn reserve(&mut self, now: Instant, max: Duration) -> Result<Duration, Duration> {
        let elapsed = now.saturating_duration_since(self.last).as_secs_f64();
        self.tokens = (self.tokens + elapsed * self.rate).min(self.burst);
        self.last = now;
        let blocked = self.blocked_until.map(|t| t.saturating_duration_since(now)).unwrap_or_default();
        let refill = if self.tokens >= 1.0 { 0.0 } else { (1.0 - self.tokens) / self.rate };
        let wait = blocked.max(Duration::from_secs_f64(refill));
        if wait > max {
            return Err(wait);
        }
        self.tokens -= 1.0;
        Ok(wait)
    }

    /// The source said to stop (HTTP 429): no requests for `secs`.
    pub fn block(&mut self, now: Instant, secs: u64) {
        self.blocked_until = Some(now + Duration::from_secs(secs));
        self.tokens = self.tokens.min(0.0);
    }
}

pub struct Limiter(std::sync::Mutex<Bucket>);

impl Limiter {
    pub fn new(rate: f64, burst: f64) -> Limiter {
        Limiter(std::sync::Mutex::new(Bucket::new(rate, burst, Instant::now())))
    }

    pub async fn acquire(&self) -> Result<(), ProviderError> {
        let wait = self.0.lock().unwrap().reserve(Instant::now(), MAX_WAIT);
        match wait {
            Ok(d) if d.is_zero() => Ok(()),
            Ok(d) => {
                tokio::time::sleep(d).await;
                Ok(())
            }
            Err(d) => Err(ProviderError::RateLimited(Some(d.as_secs().max(1)))),
        }
    }

    pub fn block(&self, secs: u64) {
        self.0.lock().unwrap().block(Instant::now(), secs);
    }
}

/// Sends the call and returns the JSON body, or the error it maps to.
pub async fn fetch(client: &reqwest::Client, limiter: &Limiter, call: &Call) -> Result<Value, ProviderError> {
    limiter.acquire().await?;
    let request = match call {
        Call::Get { url, query, auth } => {
            let mut rb = client.get(url).query(query).header("Accept", "application/json");
            match auth {
                Auth::None => {}
                Auth::Bearer(token) => rb = rb.bearer_auth(token),
                Auth::ApiKey(key) => rb = rb.query(&[("api_key", key)]),
            }
            rb
        }
        Call::Graphql { url, query, variables } => client
            .post(*url)
            .header("Accept", "application/json")
            .json(&json!({ "query": query, "variables": variables })),
    };
    let response = request.send().await.map_err(transport)?;
    let status = response.status().as_u16();
    let retry_after =
        response.headers().get("retry-after").and_then(|v| v.to_str().ok()).and_then(|v| v.trim().parse::<u64>().ok());
    let body: Option<Value> = response.json().await.ok();
    if status == 429 {
        limiter.block(retry_after.unwrap_or(60).min(300));
        return Err(ProviderError::RateLimited(retry_after));
    }
    if let Some(error) = body.as_ref().and_then(graphql_error) {
        return Err(error);
    }
    match status {
        200..=299 => body.ok_or_else(|| ProviderError::Parse("not JSON".into())),
        401 | 403 => Err(ProviderError::Unauthorized),
        404 => Err(ProviderError::NotFound),
        _ => Err(ProviderError::Http(status)),
    }
}

fn transport(e: reqwest::Error) -> ProviderError {
    if e.is_timeout() { ProviderError::Timeout } else { ProviderError::Network(e.without_url().to_string()) }
}

/// AniList answers errors as `{"errors":[{"status":404,…}],"data":null}`.
fn graphql_error(body: &Value) -> Option<ProviderError> {
    let first = body.get("errors")?.as_array()?.first()?;
    if body.get("data").is_some_and(|d| !d.is_null() && d.as_object().is_some_and(|o| o.values().any(|v| !v.is_null())))
    {
        return None;
    }
    Some(match first.get("status").and_then(Value::as_u64) {
        Some(404) => ProviderError::NotFound,
        Some(429) => ProviderError::RateLimited(None),
        Some(401 | 403) => ProviderError::Unauthorized,
        Some(code) => ProviderError::Http(code as u16),
        None => ProviderError::Parse(first.get("message").and_then(Value::as_str).unwrap_or("GraphQL error").into()),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bucket_spaces_requests() {
        let t0 = Instant::now();
        // 30 a minute with a burst of 2 (AniList).
        let mut b = Bucket::new(0.5, 2.0, t0);
        assert_eq!(b.reserve(t0, MAX_WAIT), Ok(Duration::ZERO));
        assert_eq!(b.reserve(t0, MAX_WAIT), Ok(Duration::ZERO));
        assert_eq!(b.reserve(t0, MAX_WAIT), Ok(Duration::from_secs(2)));
        assert_eq!(b.reserve(t0, MAX_WAIT), Ok(Duration::from_secs(4)));
        // Past the longest wait: refused, nothing reserved.
        let mut b2 = Bucket::new(0.5, 1.0, t0);
        b2.reserve(t0, MAX_WAIT).unwrap();
        for _ in 0..5 {
            b2.reserve(t0, MAX_WAIT).unwrap();
        }
        assert!(b2.reserve(t0, MAX_WAIT).is_err());
        // Refills with time.
        assert_eq!(b.reserve(t0 + Duration::from_secs(60), MAX_WAIT), Ok(Duration::ZERO));
    }

    #[test]
    fn bucket_honours_429() {
        let t0 = Instant::now();
        let mut b = Bucket::new(10.0, 10.0, t0);
        b.block(t0, 5);
        assert_eq!(b.reserve(t0, MAX_WAIT), Ok(Duration::from_secs(5)));
        b.block(t0, 60);
        assert!(b.reserve(t0, MAX_WAIT).is_err());
        assert_eq!(b.reserve(t0 + Duration::from_secs(61), MAX_WAIT), Ok(Duration::ZERO));
    }

    #[test]
    fn graphql_errors() {
        let nf = json!({"errors": [{"message": "Not Found.", "status": 404}], "data": {"Media": null}});
        assert_eq!(graphql_error(&nf), Some(ProviderError::NotFound));
        let ok = json!({"data": {"Media": {"id": 1}}});
        assert_eq!(graphql_error(&ok), None);
    }
}
