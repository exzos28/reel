//! Search: what the viewer types, as rows of the same summaries the shelves
//! show (Movies, Shows, Anime), and the last searches they kept.
//!
//! Like the other catalog reads, `search(query)` is sync: it answers with
//! what is known and asks `Meta.search` in the background. The UI calls it
//! on every keystroke, so a query is asked only after it rests `DEBOUNCE`,
//! and a newer one cancels the wait (and stops listening to the older
//! answer). While the new answer is on its way the last one stays, so the
//! rows do not blink between keystrokes. Answers are kept per query and
//! content language while the app runs.
//!
//! Recent searches (`RECENT_MAX`, newest first) live in
//! `recent_searches.json` in the data dir; the UI keeps one when the viewer
//! submits the query or opens a title from its results.

use std::collections::VecDeque;
use std::path::PathBuf;

use super::*;

/// How long a query rests before it is asked.
#[cfg_attr(test, allow(dead_code))]
const DEBOUNCE: Duration = Duration::from_millis(350);
/// Answers kept in memory (the queries asked last).
const ANSWERS_MAX: usize = 40;
/// Recent searches kept.
pub(super) const RECENT_MAX: usize = 10;

#[derive(Clone)]
enum Answer {
    /// `Meta.search`'s `data`: `{"sections":[{source, items}]}`.
    Found(Value),
    Failed,
}

#[derive(Default)]
struct State {
    /// The key of the query the UI shows now ("" for none).
    wanted: String,
    answers: HashMap<String, Answer>,
    /// The keys of `answers`, oldest first.
    order: VecDeque<String>,
    /// The last answer shown with results: kept on screen while the next one comes.
    shown: Option<Value>,
    /// The wait or the call for `wanted`.
    job: Option<tokio::task::AbortHandle>,
}

static STATE: LazyLock<Mutex<State>> = LazyLock::new(Default::default);

/// The query as asked: no spaces at the ends, one between words.
fn clean(query: &str) -> String {
    query.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// A query's answer is the same whatever its case, per content language.
pub(super) fn answer_key(query: &str, lang: &str) -> String {
    format!("{lang}\n{}", clean(query).to_lowercase())
}

/// The search screen: `{"query","state","tmdb","recent","sections"}`.
/// `state`: "recent" (nothing typed: `recent` lists the last searches),
/// "searching" (`sections` still show the previous query's results),
/// "done" (`sections` empty: nothing found), "failed" (the sources did not
/// answer). `tmdb`: whether films and shows are searched (without a key
/// only anime is). `sections`: `[{"id":"movies"|"shows"|"anime","items":
/// [summary…]}]`, empty ones left out, each title once.
pub fn search(query: &str) -> Value {
    let q = clean(query);
    let tmdb = tmdb_on();
    if q.is_empty() {
        let mut st = STATE.lock().unwrap();
        st.wanted.clear();
        st.shown = None;
        if let Some(job) = st.job.take() {
            job.abort();
        }
        drop(st);
        return json!({ "query": "", "state": "recent", "tmdb": tmdb, "recent": recent(), "sections": [] });
    }
    let lang = settings::content_language();
    let key = answer_key(&q, &lang);
    let (state, data) = {
        let mut st = STATE.lock().unwrap();
        if st.wanted != key {
            st.wanted = key.clone();
            if let Some(job) = st.job.take() {
                job.abort();
            }
            // A query that failed is asked again when it is typed again.
            if matches!(st.answers.get(&key), Some(Answer::Failed)) {
                st.answers.remove(&key);
            }
            if !st.answers.contains_key(&key) {
                st.job = start(q.clone(), lang, key.clone());
            }
        }
        match st.answers.get(&key).cloned() {
            Some(Answer::Found(data)) => {
                st.shown = Some(data.clone());
                ("done", Some(data))
            }
            Some(Answer::Failed) => ("failed", None),
            None => ("searching", st.shown.clone()),
        }
    };
    let sections = data.as_ref().map(sections).unwrap_or_default();
    json!({ "query": q, "state": state, "tmdb": tmdb, "recent": [], "sections": sections })
}

/// Waits for the query to rest, then asks `Meta`; the abort handle cancels both.
#[cfg(not(test))]
fn start(query: String, lang: String, key: String) -> Option<tokio::task::AbortHandle> {
    let task = runtime().spawn(async move {
        tokio::time::sleep(DEBOUNCE).await;
        start_meta();
        let text = metadata().search(query, lang).await;
        let envelope: Value = serde_json::from_str(&text).unwrap_or(Value::Null);
        if !envelope["error"].is_null() {
            eprintln!("reel catalog: search: {}", envelope["error"]);
        }
        land(&key, &envelope);
    });
    Some(task.abort_handle())
}

/// Tests answer by `land`; nothing goes to the network.
#[cfg(test)]
fn start(_query: String, _lang: String, _key: String) -> Option<tokio::task::AbortHandle> {
    None
}

/// Stores the answer to the query of `key` (`{"data",…}` as `Meta` resolves it).
pub(super) fn land(key: &str, envelope: &Value) {
    let answer = match &envelope["data"] {
        Value::Null => Answer::Failed,
        data => Answer::Found(data.clone()),
    };
    let mut st = STATE.lock().unwrap();
    if st.wanted == key {
        st.job = None;
    }
    if st.answers.insert(key.to_owned(), answer).is_none() {
        st.order.push_back(key.to_owned());
    }
    while st.order.len() > ANSWERS_MAX {
        if let Some(old) = st.order.pop_front() {
            st.answers.remove(&old);
        }
    }
    drop(st);
    bump();
}

/// The rows of an answer: Movies, Shows (TMDB's, not anime) and Anime (what
/// TMDB knows as anime, then AniList's), each title once.
fn sections(data: &Value) -> Vec<Value> {
    let mut seen = HashSet::new();
    let (mut movies, mut shows, mut anime) = (Vec::new(), Vec::new(), Vec::new());
    for section in list_of(&data["sections"]) {
        let anilist = section["source"] == "anilist";
        for card in list_of(&section["items"]) {
            let Some(id) = card["id"].as_str() else { continue };
            if !seen.insert(id.to_owned()) {
                continue;
            }
            let row = if anilist || card["anime"] == true {
                &mut anime
            } else if card["kind"] == "series" {
                &mut shows
            } else {
                &mut movies
            };
            row.push(summary(&card_info(card)));
        }
    }
    [("movies", movies), ("shows", shows), ("anime", anime)]
        .into_iter()
        .filter(|(_, items)| !items.is_empty())
        .map(|(id, items)| json!({ "id": id, "items": items }))
        .collect()
}

// ---- Recent searches.

struct Recent {
    file: Option<PathBuf>,
    queries: Vec<String>,
}

static RECENT: Mutex<Option<Recent>> = Mutex::new(None);

fn recent_file() -> Option<PathBuf> {
    DATA_DIR.lock().unwrap().as_ref().map(|d| d.join("recent_searches.json"))
}

/// The recent searches, read from the data dir the first time (and again
/// when the data dir changed).
fn with_recent<R>(f: impl FnOnce(&mut Recent) -> R) -> R {
    let file = recent_file();
    let mut guard = RECENT.lock().unwrap();
    if guard.as_ref().is_none_or(|r| r.file != file) {
        let queries = file
            .as_deref()
            .and_then(|f| std::fs::read_to_string(f).ok())
            .and_then(|text| serde_json::from_str::<Vec<String>>(&text).ok())
            .unwrap_or_default();
        *guard = Some(Recent { file, queries });
    }
    f(guard.as_mut().expect("just set"))
}

/// The last searches, newest first.
pub fn recent() -> Vec<String> {
    with_recent(|r| r.queries.clone())
}

/// Keeps `query` as the newest recent search (once, whatever its case).
pub fn remember(query: &str) {
    let q = clean(query);
    if q.is_empty() {
        return;
    }
    with_recent(|r| {
        r.queries.retain(|x| x.to_lowercase() != q.to_lowercase());
        r.queries.insert(0, q);
        r.queries.truncate(RECENT_MAX);
        if let Some(file) = &r.file {
            let result = std::fs::create_dir_all(file.parent().unwrap_or(std::path::Path::new(".")))
                .and_then(|_| std::fs::write(file, serde_json::to_vec(&r.queries).expect("plain data")));
            if let Err(e) = result {
                eprintln!("reel catalog: writing {}: {e}", file.display());
            }
        }
    });
    bump();
}

/// Forgets every answer and the recent searches in memory (tests).
#[cfg(test)]
pub(super) fn reset() {
    *STATE.lock().unwrap() = State::default();
    *RECENT.lock().unwrap() = None;
}

/// The query the screen waits for (tests).
#[cfg(test)]
pub(super) fn wanted() -> String {
    STATE.lock().unwrap().wanted.clone()
}
