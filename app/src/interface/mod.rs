//! The interface beside the NSH modules of `lib.rs`: what this device serves over HTTP (the
//! hosted settings page, the cards' pictures for a TV). The Tizen host mounts them; on Android TV
//! the app serves the settings page itself (`hosted/lan.rs`).

pub mod hosted;
pub mod thumbs;
