//! reel's domain: the types and decisions every layer shares, with no I/O. See
//! docs/architecture.md.
//!
//! `compat` keeps the device's player profile process-wide (the host sets it once at start);
//! everything else here is plain data and functions on it.

pub mod audio;
pub mod compat;
pub mod container;
pub mod discover;
pub mod episode;
pub mod keys;
pub mod numbering;
pub mod play;
pub mod ports;
pub mod redact;
pub mod release;
pub mod search;
pub mod subtitles;
pub mod timeline;
pub mod typo;
