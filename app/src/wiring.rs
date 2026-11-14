//! The composition root: the one place that picks the adapters behind the ports. The
//! application reaches them only through these accessors, as trait objects.
//!
//! Built on first use: NSH and the Tizen host call the modules in any order, with no start
//! hook of their own.

use std::sync::OnceLock;

use reel_domain::ports::{Metadata, Playback};

/// Finding and playing releases: the engine inside the app (cargo feature `engine`, on by
/// default), else `NoEngine`, whose answers say there is no engine on this device.
pub fn playback() -> &'static dyn Playback {
    static PLAYBACK: OnceLock<Box<dyn Playback>> = OnceLock::new();
    PLAYBACK
        .get_or_init(|| {
            #[cfg(feature = "engine")]
            let p: Box<dyn Playback> = Box::new(reel_engine::Local::new(std::sync::Arc::new(host::AppHost)));
            #[cfg(not(feature = "engine"))]
            let p: Box<dyn Playback> = Box::new(crate::no_engine::NoEngine::default());
            p
        })
        .as_ref()
}

/// Titles and the rest: TMDB, AniList and Jikan behind the cache. A background refresh
/// that stored something new wakes whoever waits on the catalog.
pub fn metadata() -> &'static dyn Metadata {
    static METADATA: OnceLock<Box<dyn Metadata>> = OnceLock::new();
    METADATA.get_or_init(|| Box::new(crate::metadata::Providers::new(crate::catalog::notify_changed))).as_ref()
}

/// What the engine asks the application.
#[cfg(feature = "engine")]
mod host {
    use reel_domain::{
        play::{PlaySource, Resume},
        ports::PlaybackHost,
    };

    use crate::{catalog, progress};

    pub struct AppHost;

    impl PlaybackHost for AppHost {
        fn play_source(&self, key: &str) -> PlaySource {
            catalog::play_source(key)
        }

        fn resume(&self, key: &str) -> Option<Resume> {
            progress::get(key).map(|e| Resume { position: e.position, duration: e.duration, watched: e.watched })
        }

        fn files_known(&self) {
            catalog::bump();
        }
    }
}
