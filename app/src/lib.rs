//! reel's Rust side: what `App.tsx` imports from `app/native`.
//! For the concept it only formats; the torrent core (librqbit) comes next.

use nsh_core::prelude::*;

#[native_module("app/native")]
fn native(registry: &mut Registry) {
    registry.module::<Fmt>();
}

/// Formatting shared by every platform.
#[module]
pub struct Fmt;

#[module]
impl Fmt {
    /// Playback position in seconds as "1:12:40" / "4:05".
    pub fn position(seconds: u32) -> String {
        let (h, m, s) = (seconds / 3600, seconds / 60 % 60, seconds % 60);
        if h > 0 {
            format!("{h}:{m:02}:{s:02}")
        } else {
            format!("{m}:{s:02}")
        }
    }
}

#[cfg(test)]
mod tests {
    use super::Fmt;

    #[test]
    fn position() {
        assert_eq!(Fmt::position(4360), "1:12:40");
        assert_eq!(Fmt::position(245), "4:05");
    }
}
