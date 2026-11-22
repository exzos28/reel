//! How long a film still takes to save (design/offline-downloads.md): the bytes it gained over
//! the last minute, and the time that leaves, rounded the way a person says it.
//!
//! The rate is the average over a sliding window (that is the smoothing). It says nothing while
//! the window is short or the speed swings too much between its two halves: a torrent's speed
//! comes in bursts, and a time that jumps from 5 min to 3 h is worse than none.

use std::collections::VecDeque;

/// Seconds of samples the rate is averaged over.
const WINDOW: f64 = 60.0;
/// The samples must span this many seconds before they say anything.
const MIN_SPAN: f64 = 20.0;
/// The two halves of the window may differ this many times at most (a torrent is bursty: a
/// tighter bound would switch the time on and off).
const MAX_SWING: f64 = 4.0;
/// Longer than this is no time worth saying.
const MAX_MINUTES: f64 = 99.0 * 60.0;

/// Samples of one item: `(seconds on a monotonic clock, bytes saved)`, oldest first.
#[derive(Debug, Clone, Default)]
pub struct Eta {
    samples: VecDeque<(f64, u64)>,
}

impl Eta {
    /// What is saved at `at` seconds. Fewer bytes than before (the files were checked again)
    /// starts over.
    pub fn push(&mut self, at: f64, have: u64) {
        if self.samples.back().is_some_and(|&(t, h)| have < h || at < t) {
            self.samples.clear();
        }
        self.samples.push_back((at, have));
        while self.samples.front().is_some_and(|&(t, _)| t < at - WINDOW) {
            self.samples.pop_front();
        }
    }

    /// Bytes a second over the window, or None when it is too short, stalled or too unstable.
    pub fn rate(&self) -> Option<f64> {
        let (&(t0, h0), &(t1, h1)) = (self.samples.front()?, self.samples.back()?);
        let span = t1 - t0;
        if span < MIN_SPAN {
            return None;
        }
        let half = t0 + span / 2.0;
        let &(tm, hm) = self.samples.iter().min_by(|a, b| (a.0 - half).abs().total_cmp(&(b.0 - half).abs()))?;
        if tm <= t0 || tm >= t1 {
            return None;
        }
        let early = (hm - h0) as f64 / (tm - t0);
        let late = (h1 - hm) as f64 / (t1 - tm);
        if early <= 0.0 || late <= 0.0 || early.max(late) > MAX_SWING * early.min(late) {
            return None;
        }
        Some((h1 - h0) as f64 / span)
    }
}

/// Minutes until `remaining` bytes are saved at `rate` bytes a second, rounded as said:
/// under an hour to the minute (at least 1), under ten hours to ten minutes, else to the hour.
/// None when there is no rate or it would take longer than 99 hours.
pub fn minutes_left(remaining: u64, rate: f64) -> Option<u32> {
    if !(rate > 0.0) {
        return None;
    }
    let minutes = remaining as f64 / rate / 60.0;
    if minutes > MAX_MINUTES {
        return None;
    }
    let rounded = if minutes < 60.0 {
        minutes.ceil().max(1.0)
    } else if minutes < 600.0 {
        (minutes / 10.0).round() * 10.0
    } else {
        (minutes / 60.0).round() * 60.0
    };
    Some(rounded as u32)
}

#[cfg(test)]
mod tests {
    use super::*;

    const MB: u64 = 1024 * 1024;

    fn steady(eta: &mut Eta, from: f64, to: f64, per_second: u64) {
        let mut t = from;
        while t <= to {
            eta.push(t, (t * per_second as f64) as u64);
            t += 2.0;
        }
    }

    #[test]
    fn a_steady_rate_is_measured_once_the_window_is_long_enough() {
        let mut eta = Eta::default();
        steady(&mut eta, 0.0, 10.0, MB);
        assert_eq!(eta.rate(), None, "10 s say nothing yet");
        steady(&mut eta, 12.0, 40.0, MB);
        let rate = eta.rate().unwrap();
        assert!((rate - MB as f64).abs() < 1.0, "{rate}");
    }

    #[test]
    fn only_the_last_minute_counts() {
        let mut eta = Eta::default();
        steady(&mut eta, 0.0, 100.0, MB);
        // From 100 s on it is ten times faster; after a minute only that shows.
        let base = 100 * MB;
        for t in (102..=170).step_by(2) {
            eta.push(t as f64, base + (t as u64 - 100) * 10 * MB);
        }
        let rate = eta.rate().unwrap();
        assert!((rate - 10.0 * MB as f64).abs() < 1.0, "{rate}");
    }

    #[test]
    fn a_stall_or_a_burst_says_nothing() {
        let mut stalled = Eta::default();
        steady(&mut stalled, 0.0, 30.0, MB);
        for t in (32..=60).step_by(2) {
            stalled.push(t as f64, 30 * MB);
        }
        assert_eq!(stalled.rate(), None, "nothing came in the second half");

        let mut burst = Eta::default();
        steady(&mut burst, 0.0, 30.0, MB / 10);
        for t in (32..=60).step_by(2) {
            burst.push(t as f64, 3 * MB + (t as u64 - 30) * 2 * MB);
        }
        assert_eq!(burst.rate(), None, "twenty times faster in the second half");
    }

    #[test]
    fn fewer_bytes_than_before_starts_over() {
        let mut eta = Eta::default();
        steady(&mut eta, 0.0, 40.0, MB);
        eta.push(42.0, 0);
        assert_eq!(eta.rate(), None);
        assert_eq!(eta.samples.len(), 1);
    }

    #[test]
    fn the_time_is_rounded_as_said() {
        let at = |minutes: f64| minutes_left((minutes * 60.0) as u64, 1.0);
        assert_eq!(at(0.2), Some(1));
        assert_eq!(at(24.3), Some(25));
        assert_eq!(at(59.5), Some(60));
        assert_eq!(at(110.0), Some(110), "1 h 50 min");
        assert_eq!(at(114.0), Some(110));
        assert_eq!(at(116.0), Some(120));
        assert_eq!(at(10.0 * 60.0 + 25.0), Some(600));
        assert_eq!(at(10.0 * 60.0 + 35.0), Some(660));
        assert_eq!(at(100.0 * 60.0), None, "too long to say");
        assert_eq!(minutes_left(MB, 0.0), None);
        assert_eq!(minutes_left(MB, f64::NAN), None);
    }

    #[test]
    fn the_reviews_example() {
        // 665 MB left at 0.1 MB/s: about 1 h 50 min.
        assert_eq!(minutes_left(665 * MB, 0.1 * MB as f64), Some(110));
    }
}
