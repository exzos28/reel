//! Who holds each torrent of the session. librqbit holds an infohash once: a second add of the
//! same torrent answers with the handle it already has (`AlreadyManaged`), on the storage the
//! first add chose. So neither a stream nor a saved item owns a torrent; they lease it, and it
//! leaves the session only when the last lease is released (design/offline-downloads.md).

use std::{collections::HashMap, sync::Mutex};

/// The leases on one torrent.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct Lease {
    /// Streams (player jobs) reading it.
    pub streams: u32,
    /// A saved item is saving it.
    pub kept: bool,
    /// Its files are a saved film's and stay on disk when it leaves the session (a saved item
    /// that completed while a stream still read it). Otherwise its files go with it (the
    /// ring's pieces, or a saved item that was removed).
    pub keep_files: bool,
}

/// What to do once a lease is released.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Release {
    /// Someone still holds it.
    Held,
    /// Nobody does: take it out of the session, deleting its files or not.
    Delete { files: bool },
}

/// The leases of the session's torrents, by librqbit's torrent id.
#[derive(Debug, Default)]
pub struct Leases(HashMap<usize, Lease>);

impl Leases {
    pub fn get(&self, id: usize) -> Lease {
        self.0.get(&id).copied().unwrap_or_default()
    }

    pub fn take_stream(&mut self, id: usize) {
        self.0.entry(id).or_default().streams += 1;
    }

    pub fn take_keep(&mut self, id: usize) {
        let l = self.0.entry(id).or_default();
        l.kept = true;
        l.keep_files = false;
    }

    pub fn release_stream(&mut self, id: usize) -> Release {
        let Some(l) = self.0.get_mut(&id) else { return Release::Delete { files: true } };
        l.streams = l.streams.saturating_sub(1);
        self.settle(id)
    }

    /// The saved item lets go: `keep_files` when it completed (its files stay), not when it
    /// was removed.
    pub fn release_keep(&mut self, id: usize, keep_files: bool) -> Release {
        let l = self.0.entry(id).or_default();
        l.kept = false;
        l.keep_files = keep_files;
        self.settle(id)
    }

    fn settle(&mut self, id: usize) -> Release {
        let l = self.get(id);
        if l.streams > 0 || l.kept {
            return Release::Held;
        }
        self.0.remove(&id);
        Release::Delete { files: !l.keep_files }
    }
}

/// The session's leases.
pub static LEASES: Mutex<Option<Leases>> = Mutex::new(None);

pub fn with<R>(f: impl FnOnce(&mut Leases) -> R) -> R {
    f(LEASES.lock().unwrap().get_or_insert_with(Leases::default))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_stream_alone_deletes_its_ring_on_close() {
        let mut l = Leases::default();
        l.take_stream(1);
        assert_eq!(l.release_stream(1), Release::Delete { files: true });
    }

    #[test]
    fn closing_the_player_never_deletes_a_film_being_saved() {
        let mut l = Leases::default();
        l.take_keep(1);
        l.take_stream(1);
        assert_eq!(l.release_stream(1), Release::Held);
        assert!(l.get(1).kept);
    }

    #[test]
    fn a_completed_film_keeps_its_files_after_the_stream_closes() {
        let mut l = Leases::default();
        l.take_keep(1);
        l.take_stream(1);
        assert_eq!(l.release_keep(1, true), Release::Held);
        assert_eq!(l.release_stream(1), Release::Delete { files: false });
    }

    #[test]
    fn a_removed_film_is_deleted_with_its_files() {
        let mut l = Leases::default();
        l.take_keep(1);
        assert_eq!(l.release_keep(1, false), Release::Delete { files: true });
    }

    #[test]
    fn two_streams_of_one_torrent_delete_it_after_the_second() {
        let mut l = Leases::default();
        l.take_stream(1);
        l.take_stream(1);
        assert_eq!(l.release_stream(1), Release::Held);
        assert_eq!(l.release_stream(1), Release::Delete { files: true });
    }
}
