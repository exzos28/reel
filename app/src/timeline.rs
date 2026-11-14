//! What the player's scrubber draws: the engine's byte buckets of the
//! playing file mapped to time.
//!
//! Bytes become time proportionally (byte b of n is the moment b/n of the film). That is exact only for constant bitrate; with
//! variable bitrate and the index at either end it is an approximation, good
//! enough to show where the film is ready.

/// `ranges` (sorted, merged, 0..1) with the stretch the player holds in memory,
/// `position .. position + cached` seconds, merged in.
pub fn with_player_cache(mut ranges: Vec<(f64, f64)>, position: f64, cached: f64, duration: f64) -> Vec<(f64, f64)> {
    if duration <= 0.0 || cached <= 0.0 {
        return ranges;
    }
    let from = (position / duration).clamp(0.0, 1.0);
    let to = ((position + cached) / duration).clamp(0.0, 1.0);
    ranges.push((from, to));
    ranges.sort_by(|a, b| a.0.total_cmp(&b.0));
    let mut out: Vec<(f64, f64)> = Vec::with_capacity(ranges.len());
    for (a, b) in ranges {
        match out.last_mut() {
            Some(last) if a <= last.1 + 1e-12 => last.1 = last.1.max(b),
            _ => out.push((a, b)),
        }
    }
    out
}

/// Seconds of the film downloaded without a gap from `position` on, from the exact ready
/// stretches (`(from, to)` in 0..1, sorted and merged).
pub fn ready_ahead(ranges: &[(f64, f64)], position: f64, duration: f64) -> f64 {
    if duration <= 0.0 {
        return 0.0;
    }
    let at = (position / duration).clamp(0.0, 1.0);
    ranges.iter().find(|(from, to)| *from <= at && at < *to).map_or(0.0, |(_, to)| (to - at) * duration)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_players_cache_joins_what_is_on_disk() {
        // A 100 s film; 40..60 s on disk; the player at 30 s holds 12 s.
        let r = with_player_cache(vec![(0.4, 0.6)], 30.0, 12.0, 100.0);
        assert_eq!(r, vec![(0.3, 0.6)], "30..42 s touches 40..60 s");
        assert!((ready_ahead(&r, 30.0, 100.0) - 30.0).abs() < 1e-9);
        assert_eq!(with_player_cache(vec![(0.4, 0.6)], 10.0, 5.0, 100.0), vec![(0.1, 0.15), (0.4, 0.6)]);
        assert_eq!(with_player_cache(vec![(0.4, 0.6)], 10.0, 0.0, 100.0), vec![(0.4, 0.6)]);
    }

    #[test]
    fn ahead_runs_to_the_end_of_the_stretch_the_position_is_in() {
        // A 100 s film; 0..30 s and 60..70 s are in.
        let r = [(0.0, 0.3), (0.6, 0.7)];
        assert!((ready_ahead(&r, 5.0, 100.0) - 25.0).abs() < 1e-9);
        assert!((ready_ahead(&r, 65.0, 100.0) - 5.0).abs() < 1e-9);
        assert_eq!(ready_ahead(&r, 35.0, 100.0), 0.0, "in a gap");
        assert_eq!(ready_ahead(&r, 5.0, 0.0), 0.0);
        assert_eq!(ready_ahead(&[], 5.0, 100.0), 0.0);
    }
}
