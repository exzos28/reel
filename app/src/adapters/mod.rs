//! Adapters in this crate: the metadata providers behind `Metadata`, `NoEngine` behind
//! `Playback` on builds without the engine (the engine itself is reel-engine), and the mpv
//! video view on macOS.

#[cfg(target_os = "android")]
pub mod android_views;
pub mod http_client;
#[cfg(target_os = "ios")]
pub mod ios_awake;
pub mod metadata;
#[cfg_attr(feature = "engine", allow(dead_code))]
pub mod no_engine;
#[cfg(any(target_os = "macos", target_os = "ios", target_os = "android", target_os = "linux", windows))]
pub mod mpv;
