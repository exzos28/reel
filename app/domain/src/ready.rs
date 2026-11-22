//! How far a job is from its first frame: one value, 0..=100, for the player's loading bar.
//!
//! Each step before any byte comes adds a small fixed share as it happens (the release found,
//! the torrent's metadata, someone connected). The bytes the player reads before it shows the
//! picture take the most: the file's start, the index the demuxer reads at its end, and on
//! Resume the place it starts from. The first frame fills the bar. Steps that do not apply (a
//! release already known, a saved film) are left out, and the bytes take their share.
//!
//! The value never goes back. Bytes found to be needed later (the index's place is known only
//! once the start is in) share what is left of the bar with the bytes still to come, so the bar
//! slows down instead of jumping back. Bytes that go (the cache let a piece go) only stop it. The
//! engine counts bytes it expects before it knows where they are (the place to resume from, until
//! the index says) in the need, so that the start coming in alone does not fill the bar.

/// A step on the way to the bytes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Step {
    /// The search source answered and the catalog chose a release.
    Release,
    /// The torrent's metadata is in (a `.torrent` fetched, or a magnet's from peers).
    Metadata,
    /// Someone sharing it is connected.
    Peer,
}

impl Step {
    /// Its share of the bar, percent.
    const fn share(self) -> f64 {
        match self {
            Step::Release => 10.0,
            Step::Metadata => 10.0,
            Step::Peer => 5.0,
        }
    }
}

/// The first frame's share, percent: the bar is full only once the picture is on screen.
const FRAME_SHARE: f64 = 5.0;

/// Where the bytes' part was re-based: the bytes needed and in then, and the part shown then.
#[derive(Debug, Clone, Copy, PartialEq)]
struct Base {
    need: u64,
    have: u64,
    from: f64,
}

/// A job's way to its first frame.
#[derive(Debug, Clone, PartialEq)]
pub struct Readiness {
    /// The steps that apply, and whether each is done.
    steps: Vec<(Step, bool)>,
    /// The bytes' part, 0..=1.
    bytes: f64,
    base: Option<Base>,
    frame: bool,
    /// The last value given.
    shown: u8,
}

impl Readiness {
    /// A job that goes through `steps` before its bytes (none for a saved film).
    pub fn new(steps: &[Step]) -> Readiness {
        Readiness { steps: steps.iter().map(|&s| (s, false)).collect(), bytes: 0.0, base: None, frame: false, shown: 0 }
    }

    /// `step` happened (nothing when it does not apply or happened already).
    pub fn step(&mut self, step: Step) {
        for (s, done) in &mut self.steps {
            if *s == step {
                *done = true;
            }
        }
    }

    /// Of the bytes the player reads before its first frame (`need`: those known so far and
    /// those expected), `have` are in. Another `need` than last time re-bases the bytes' part:
    /// what it showed stays, and the bytes still to come share the rest. Once they are all in,
    /// every step counts as done (a film being saved has its bytes without anyone connected).
    pub fn bytes(&mut self, have: u64, need: u64) {
        if need == 0 {
            return;
        }
        let have = have.min(need);
        let base = match self.base {
            // The first bytes known: what is in already counts.
            None => Base { need, have: 0, from: 0.0 },
            Some(b) if b.need != need => Base { need, have, from: self.bytes },
            Some(b) => b,
        };
        self.base = Some(base);
        let left = base.need - base.have;
        let part = if left == 0 {
            1.0
        } else {
            base.from + (1.0 - base.from) * have.saturating_sub(base.have) as f64 / left as f64
        };
        self.bytes = self.bytes.max(part).min(1.0);
        if have == need {
            self.bytes = 1.0;
            for (_, done) in &mut self.steps {
                *done = true;
            }
        }
    }

    /// The first frame is on screen: the bar is full.
    pub fn frame(&mut self) {
        self.frame = true;
    }

    /// The value now, 0..=100: never less than the last one, 100 only with the first frame.
    pub fn percent(&mut self) -> u8 {
        let value = if self.frame {
            100.0
        } else {
            let steps: f64 = self.steps.iter().map(|(s, _)| s.share()).sum();
            let done: f64 = self.steps.iter().filter(|(_, d)| *d).map(|(s, _)| s.share()).sum();
            let bytes_share = 100.0 - FRAME_SHARE - steps;
            (done + bytes_share * self.bytes).min(100.0 - FRAME_SHARE)
        };
        // A hair over, so that 55.0 computed as 54.999… is still 55.
        self.shown = self.shown.max((value + 1e-9).floor() as u8);
        self.shown
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const ALL: [Step; 3] = [Step::Release, Step::Metadata, Step::Peer];

    #[test]
    fn each_step_adds_its_share_as_it_happens() {
        let mut r = Readiness::new(&ALL);
        assert_eq!(r.percent(), 0);
        r.step(Step::Release);
        assert_eq!(r.percent(), 10);
        r.step(Step::Metadata);
        assert_eq!(r.percent(), 20);
        r.step(Step::Peer);
        assert_eq!(r.percent(), 25);
        // Again: nothing more.
        r.step(Step::Peer);
        assert_eq!(r.percent(), 25);
    }

    #[test]
    fn a_step_that_does_not_apply_is_left_out_and_the_bytes_take_its_share() {
        // The release was known at Play: no search.
        let mut r = Readiness::new(&[Step::Metadata, Step::Peer]);
        r.step(Step::Release);
        assert_eq!(r.percent(), 0);
        r.step(Step::Metadata);
        r.step(Step::Peer);
        assert_eq!(r.percent(), 15);
        r.bytes(40, 80);
        assert_eq!(r.percent(), 15 + 40); // half of the bytes' 80
    }

    #[test]
    fn the_bytes_count_in_proportion_and_stop_short_of_full_until_the_first_frame() {
        let mut r = Readiness::new(&ALL);
        r.step(Step::Release);
        r.step(Step::Metadata);
        r.step(Step::Peer);
        r.bytes(0, 100);
        assert_eq!(r.percent(), 25);
        r.bytes(50, 100);
        assert_eq!(r.percent(), 25 + 35);
        r.bytes(100, 100);
        assert_eq!(r.percent(), 95);
        r.frame();
        assert_eq!(r.percent(), 100);
    }

    #[test]
    fn bytes_found_needed_later_share_the_rest_of_the_bar_without_a_step_back() {
        let mut r = Readiness::new(&[Step::Metadata, Step::Peer]);
        r.step(Step::Metadata);
        r.step(Step::Peer);
        // The start: 8 of 16 in.
        r.bytes(8, 16);
        let before = r.percent();
        assert_eq!(before, 15 + 40);
        // The index at the end turns out to be needed too: 16 more. Same value, not 15 + 20.
        r.bytes(8, 32);
        assert_eq!(r.percent(), before);
        // The rest comes in steadily to the cap.
        let mut last = before;
        for have in (8..=32).step_by(4) {
            r.bytes(have, 32);
            let p = r.percent();
            assert!(p >= last, "{p} after {last}");
            last = p;
        }
        assert_eq!(last, 95);
        // Halfway through the 24 still to come: halfway through what was left of the bar.
        let mut half = Readiness::new(&[Step::Metadata, Step::Peer]);
        half.step(Step::Metadata);
        half.step(Step::Peer);
        half.bytes(8, 16);
        half.bytes(8, 32);
        half.bytes(20, 32);
        assert_eq!(half.percent(), 75); // 55 + (95 − 55) / 2
    }

    #[test]
    fn bytes_expected_and_then_not_needed_leave_the_rest_to_what_is_still_to_come() {
        // The index's end was expected (16 of 32), and the index turned out to be at the start.
        let mut r = Readiness::new(&[]);
        r.bytes(8, 32);
        assert_eq!(r.percent(), 23); // a quarter of 95
        r.bytes(8, 16);
        assert_eq!(r.percent(), 23);
        r.bytes(12, 16);
        assert_eq!(r.percent(), 59); // 23.75 + (95 − 23.75) / 2
        r.bytes(16, 16);
        assert_eq!(r.percent(), 95);
    }

    #[test]
    fn bytes_that_go_never_take_the_bar_back() {
        let mut r = Readiness::new(&[]);
        r.bytes(60, 100);
        let p = r.percent();
        r.bytes(20, 100); // the cache let pieces go
        assert_eq!(r.percent(), p);
        r.bytes(80, 100);
        assert!(r.percent() > p);
    }

    #[test]
    fn a_saved_film_is_ready_but_for_its_first_frame() {
        let mut r = Readiness::new(&[]);
        r.bytes(1, 1);
        assert_eq!(r.percent(), 95);
        r.frame();
        assert_eq!(r.percent(), 100);
    }

    #[test]
    fn bytes_all_in_count_every_step_done() {
        // A film being saved: its start is on disk, nobody connected.
        let mut r = Readiness::new(&[Step::Metadata, Step::Peer]);
        r.step(Step::Metadata);
        r.bytes(16, 16);
        assert_eq!(r.percent(), 95);
    }

    #[test]
    fn what_was_in_before_the_first_need_counts() {
        let mut r = Readiness::new(&[]);
        r.bytes(45, 90); // half in already when first known
        assert_eq!(r.percent(), 47); // half of 95
    }

    #[test]
    fn nothing_needed_yet_is_nothing_in() {
        let mut r = Readiness::new(&[Step::Metadata]);
        r.bytes(0, 0);
        assert_eq!(r.percent(), 0);
    }
}
