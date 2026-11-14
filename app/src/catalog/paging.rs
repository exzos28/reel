//! The browse grid page by page. Page 1 of a catalog through a filter is
//! what `browse` asks for; each `more` asks for the page after the last one
//! (`Call::Discover(kind, filter, n)`, a slot like any other), and the grid
//! is the pages asked for so far, in order, as far as they are in. A filter
//! that changes starts again from page 1. A further page that fails leaves
//! the grid as it was: `more` asks for it again (not sooner than
//! `MORE_RETRY`). The sources say when there is no page after: TMDB's
//! `total_pages` (it serves 500 at most), AniList's `hasNextPage`.

use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};

use serde_json::Value;

use super::{Call, SLOTS, ask, bump, list_of, meta};
use crate::wiring::metadata;
use reel_domain::discover::{DiscoverKind, Filter};

/// How many pages of each (catalog, filter key) the grid shows: those asked for so far.
static PAGES: LazyLock<Mutex<HashMap<(DiscoverKind, String), u32>>> = LazyLock::new(Default::default);

/// A further page that failed is asked again by `more` after this.
const MORE_RETRY: Duration = Duration::from_secs(5);
/// Never more pages than this, whatever a source says (TMDB stops at 500 too).
const MAX_PAGES: u32 = 500;

fn wanted(kind: DiscoverKind, filter: &Filter) -> u32 {
    PAGES.lock().unwrap().get(&(kind, filter.key())).copied().unwrap_or(1)
}

/// A filter of `kind` was chosen: every grid of `kind` starts again from
/// page 1, but for `keep` (the one on screen until the new one's first page lands).
pub fn reset(kind: DiscoverKind, keep: Option<&Filter>) {
    let keep = keep.map(Filter::key);
    PAGES.lock().unwrap().retain(|(k, f), _| *k != kind || keep.as_deref() == Some(f.as_str()));
}

#[cfg(test)]
pub fn clear() {
    PAGES.lock().unwrap().clear();
}

/// Where a page is.
enum Page {
    In(Value),
    Loading,
    /// Answered without data: `Some(when)` it failed.
    Failed(Option<Instant>),
    /// Never asked (or forgotten, as when the content language changed).
    Unknown,
}

fn page(call: &Call) -> Page {
    match SLOTS.0.lock().unwrap().get(&call.key()) {
        None => Page::Unknown,
        Some(s) => match &s.data {
            Some(d) => Page::In(d.clone()),
            None if s.loading || !s.loaded => Page::Loading,
            None => Page::Failed(s.failed_at),
        },
    }
}

/// The grid: the cards of the pages in so far, whether the source has more,
/// and where the next one is: "idle", "loading" or "failed".
pub struct Grid {
    pub cards: Vec<Value>,
    pub more: bool,
    pub state: &'static str,
}

/// The grid of `kind` through `filter`, from page 1's answer `first` on.
/// Cards may repeat across pages (the lists move between asks): the shelf
/// keeps the first of each.
pub fn grid(kind: DiscoverKind, filter: &Filter, first: &Value) -> Grid {
    let mut cards = list_of(&first["items"]).to_vec();
    let mut more = first["more"].as_bool().unwrap_or(false);
    let mut state = "idle";
    for n in 2..=wanted(kind, filter) {
        if !more {
            break;
        }
        let call = Call::Discover(kind, filter.clone(), n);
        match page(&call) {
            Page::In(d) => {
                cards.extend(list_of(&d["items"]).iter().cloned());
                more = d["more"].as_bool().unwrap_or(false);
            }
            Page::Loading => {
                state = "loading";
                break;
            }
            Page::Failed(_) => {
                state = "failed";
                break;
            }
            Page::Unknown => {
                meta(&call);
                state = "loading";
                break;
            }
        }
    }
    Grid { cards, more: more && wanted(kind, filter) < MAX_PAGES, state }
}

/// Asks for the page after the last one of `kind`'s grid through `filter`
/// (or that last one again, when it failed a while ago). Whether a page is
/// on its way now; nothing when one already is, or the source has no more.
pub fn more(kind: DiscoverKind, filter: &Filter) -> bool {
    let n = wanted(kind, filter);
    let last = Call::Discover(kind, filter.clone(), n);
    let asked = match page(&last) {
        Page::In(d) if d["more"] == true && n < MAX_PAGES => {
            PAGES.lock().unwrap().insert((kind, filter.key()), n + 1);
            meta(&Call::Discover(kind, filter.clone(), n + 1));
            true
        }
        // Page 1 is `browse`'s own: it asks for it and again after a failure.
        Page::Failed(at) if n > 1 && at.is_none_or(|t| t.elapsed() >= MORE_RETRY) => {
            retry(&last);
            true
        }
        Page::Unknown if n > 1 => {
            meta(&last);
            true
        }
        _ => false,
    };
    if asked {
        bump();
    }
    asked
}

/// Asks `call` again now.
fn retry(call: &Call) {
    let rev = metadata().revision();
    let mut slots = SLOTS.0.lock().unwrap();
    let slot = slots.entry(call.key()).or_default();
    if slot.loading {
        return;
    }
    slot.loading = true;
    slot.failed_at = None;
    drop(slots);
    ask(call.clone(), rev);
}
