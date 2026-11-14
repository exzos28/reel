//! Adapters in this crate: the metadata providers behind `Metadata`, `NoEngine` behind
//! `Playback` on builds without the engine (the engine itself is reel-engine), and the mpv
//! video view on macOS.

pub mod metadata;
#[cfg_attr(feature = "engine", allow(dead_code))]
pub mod no_engine;
#[cfg(target_os = "macos")]
pub mod mpv;
