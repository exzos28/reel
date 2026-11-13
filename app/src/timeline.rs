//! What the player's scrubber draws: the engine's byte buckets of the
//! playing file mapped to time.
//!
//! Bytes become time proportionally (bucket i of n is the stretch
//! i/n..(i+1)/n of the film). That is exact only for constant bitrate; with
//! variable bitrate and the index at either end it is an approximation, good
//! enough to show where the film is ready.

/// A bucket counts as ready when this much of it is downloaded.
const READY: f64 = 0.5;
/// "Ready ahead" counts only buckets downloaded whole.
const FULL: f64 = 0.999;

/// The ready stretches of the film as `(from, to)` in 0..1, neighbours merged.
pub fn ready_ranges(buckets: &[f64]) -> Vec<(f64, f64)> {
    let n = buckets.len() as f64;
    let mut out: Vec<(f64, f64)> = Vec::new();
    for (i, b) in buckets.iter().enumerate() {
        if *b < READY {
            continue;
        }
        let (from, to) = (i as f64 / n, (i + 1) as f64 / n);
        match out.last_mut() {
            Some(last) if (last.1 - from).abs() < 1e-12 => last.1 = to,
            _ => out.push((from, to)),
        }
    }
    out
}

/// Seconds of the film downloaded without a gap from `position` on.
pub fn ready_ahead(buckets: &[f64], position: f64, duration: f64) -> f64 {
    let n = buckets.len();
    if n == 0 || duration <= 0.0 {
        return 0.0;
    }
    let at = (position / duration).clamp(0.0, 1.0);
    let mut i = (at * n as f64).floor() as usize;
    if i >= n || buckets[i] < FULL {
        return 0.0;
    }
    let mut ahead = (i + 1) as f64 / n as f64 - at;
    i += 1;
    while i < n && buckets[i] >= FULL {
        ahead += 1.0 / n as f64;
        i += 1;
    }
    ahead * duration
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ranges_merge_neighbours() {
        let r = ready_ranges(&[1.0, 1.0, 0.2, 0.6, 0.0]);
        assert_eq!(r, vec![(0.0, 0.4), (0.6, 0.8)]);
        assert!(ready_ranges(&[]).is_empty());
    }

    #[test]
    fn ahead_counts_whole_buckets_from_the_position() {
        // 10 buckets of a 100 s film; 0..30 s whole, then a gap.
        let b = [1.0, 1.0, 1.0, 0.2, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0];
        assert!((ready_ahead(&b, 5.0, 100.0) - 25.0).abs() < 1e-9);
        assert_eq!(ready_ahead(&b, 35.0, 100.0), 0.0);
        assert_eq!(ready_ahead(&b, 5.0, 0.0), 0.0);
        assert_eq!(ready_ahead(&[], 5.0, 100.0), 0.0);
    }
}
