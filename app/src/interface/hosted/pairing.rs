//! Pairing a browser with this device: a short code shown on the screen, typed on the page,
//! gives the browser a session. No clock or randomness of its own (the caller passes `now`
//! and a source of random bytes), so the rules are tested as they are.

use std::{
    collections::VecDeque,
    time::{Duration, Instant},
};

/// How long a code waits to be typed.
pub const CODE_TTL: Duration = Duration::from_secs(120);
/// Wrong tries a code takes before it is dropped.
pub const TRIES_PER_CODE: u8 = 5;
/// Wrong tries in `FAILURE_WINDOW` that lock pairing for `LOCKOUT`.
pub const MAX_FAILURES: usize = 10;
pub const FAILURE_WINDOW: Duration = Duration::from_secs(600);
pub const LOCKOUT: Duration = Duration::from_secs(600);
/// Sessions kept at once (the oldest goes) and how long one lasts unused.
pub const MAX_SESSIONS: usize = 4;
pub const SESSION_IDLE: Duration = Duration::from_secs(12 * 3600);

/// Fills a buffer with random bytes (the OS's in the core, a fixed sequence in tests).
pub type Random<'a> = &'a mut dyn FnMut(&mut [u8]);

struct Pending {
    id: String,
    code: String,
    expires: Instant,
    tries_left: u8,
}

struct Session {
    token: String,
    last_used: Instant,
}

#[derive(Debug, PartialEq)]
pub enum Refused {
    /// Wrong code; tries left for it (0: the code is gone).
    Wrong(u8),
    /// No such pairing waits: it expired, was replaced, cancelled or used up.
    Expired,
    /// Too many wrong tries lately: seconds until pairing opens again.
    Locked(u64),
}

#[derive(Default)]
pub struct Pairing {
    pending: Option<Pending>,
    failures: VecDeque<Instant>,
    locked_until: Option<Instant>,
    sessions: Vec<Session>,
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Six digits, uniform (no modulo bias).
fn code(random: Random) -> String {
    loop {
        let mut b = [0u8; 4];
        random(&mut b);
        let n = u32::from_le_bytes(b);
        // The largest multiple of 1_000_000 that fits in a u32.
        if n < 4_294_000_000 {
            return format!("{:06}", n % 1_000_000);
        }
    }
}

impl Pairing {
    fn locked(&mut self, now: Instant) -> Option<u64> {
        match self.locked_until {
            Some(until) if until > now => Some((until - now).as_secs().max(1)),
            Some(_) => {
                self.locked_until = None;
                None
            }
            None => None,
        }
    }

    /// A new code on the screen (replacing one that waits): the pairing id the page confirms
    /// it with, and the seconds it lasts.
    pub fn start(&mut self, now: Instant, random: Random) -> Result<(String, u64), Refused> {
        if let Some(s) = self.locked(now) {
            return Err(Refused::Locked(s));
        }
        let mut id = [0u8; 16];
        random(&mut id);
        let id = hex(&id);
        self.pending = Some(Pending { id: id.clone(), code: code(random), expires: now + CODE_TTL, tries_left: TRIES_PER_CODE });
        Ok((id, CODE_TTL.as_secs()))
    }

    /// The code typed for pairing `id`: a new session's token, or why not.
    pub fn confirm(&mut self, now: Instant, id: &str, typed: &str, random: Random) -> Result<String, Refused> {
        if let Some(s) = self.locked(now) {
            return Err(Refused::Locked(s));
        }
        self.expire(now);
        let Some(p) = self.pending.as_mut().filter(|p| p.id == id) else {
            return Err(Refused::Expired);
        };
        if typed.trim() == p.code {
            self.pending = None;
            let mut t = [0u8; 32];
            random(&mut t);
            let token = hex(&t);
            self.sessions.retain(|s| now.duration_since(s.last_used) < SESSION_IDLE);
            if self.sessions.len() >= MAX_SESSIONS {
                self.sessions.remove(0);
            }
            self.sessions.push(Session { token: token.clone(), last_used: now });
            return Ok(token);
        }
        p.tries_left -= 1;
        let left = p.tries_left;
        if left == 0 {
            self.pending = None;
        }
        self.failures.push_back(now);
        while self.failures.front().is_some_and(|t| now.duration_since(*t) >= FAILURE_WINDOW) {
            self.failures.pop_front();
        }
        if self.failures.len() >= MAX_FAILURES {
            self.failures.clear();
            self.pending = None;
            self.locked_until = Some(now + LOCKOUT);
            return Err(Refused::Locked(LOCKOUT.as_secs()));
        }
        Err(Refused::Wrong(left))
    }

    /// Whether `token` is a live session; using it keeps it alive.
    pub fn session(&mut self, now: Instant, token: &str) -> bool {
        self.sessions.retain(|s| now.duration_since(s.last_used) < SESSION_IDLE);
        match self.sessions.iter_mut().find(|s| !token.is_empty() && s.token == token) {
            Some(s) => {
                s.last_used = now;
                true
            }
            None => false,
        }
    }

    /// The code to show and the seconds it has left, while one waits.
    pub fn code(&mut self, now: Instant) -> Option<(String, u64)> {
        self.expire(now);
        self.pending.as_ref().map(|p| (p.code.clone(), (p.expires - now).as_secs()))
    }

    /// Drops the code that waits (Back on the screen): whether there was one.
    pub fn cancel(&mut self) -> bool {
        self.pending.take().is_some()
    }

    /// Drops a code past its time: whether one went.
    pub fn expire(&mut self, now: Instant) -> bool {
        if self.pending.as_ref().is_some_and(|p| p.expires <= now) {
            self.pending = None;
            return true;
        }
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Random bytes from a counter: different every call, the same every run.
    fn counter() -> impl FnMut(&mut [u8]) {
        let mut n: u8 = 0;
        move |buf: &mut [u8]| {
            for b in buf {
                n = n.wrapping_add(37);
                *b = n;
            }
        }
    }

    #[test]
    fn the_code_on_the_screen_gives_a_session() {
        let (mut p, mut r, t0) = (Pairing::default(), counter(), Instant::now());
        let (id, ttl) = p.start(t0, &mut r).unwrap();
        assert_eq!(ttl, 120);
        let (code, left) = p.code(t0).unwrap();
        assert_eq!(code.len(), 6);
        assert!(code.chars().all(|c| c.is_ascii_digit()));
        assert_eq!(left, 120);
        let token = p.confirm(t0, &id, &code, &mut r).unwrap();
        assert_eq!(token.len(), 64);
        assert!(p.session(t0, &token));
        assert!(!p.session(t0, "someone-elses"));
        assert!(!p.session(t0, ""));
        assert_eq!(p.code(t0), None, "the code leaves the screen once used");
        assert_eq!(p.confirm(t0, &id, &code, &mut r), Err(Refused::Expired), "a code works once");
    }

    #[test]
    fn a_code_works_only_for_the_pairing_that_asked_for_it_and_only_in_time() {
        let (mut p, mut r, t0) = (Pairing::default(), counter(), Instant::now());
        let (id, _) = p.start(t0, &mut r).unwrap();
        let (code, _) = p.code(t0).unwrap();
        assert_eq!(p.confirm(t0, "another-pairing", &code, &mut r), Err(Refused::Expired));
        let later = t0 + CODE_TTL;
        assert_eq!(p.code(later), None);
        assert_eq!(p.confirm(later, &id, &code, &mut r), Err(Refused::Expired));

        // A new request replaces the code that waits.
        let (first, _) = p.start(t0, &mut r).unwrap();
        let (old_code, _) = p.code(t0).unwrap();
        let (_second, _) = p.start(t0, &mut r).unwrap();
        assert_eq!(p.confirm(t0, &first, &old_code, &mut r), Err(Refused::Expired));
    }

    #[test]
    fn wrong_codes_use_up_the_code_then_lock_pairing() {
        let (mut p, mut r, t0) = (Pairing::default(), counter(), Instant::now());
        let (id, _) = p.start(t0, &mut r).unwrap();
        let wrong = |p: &mut Pairing| if p.code(t0).unwrap().0 == "000000" { "000001" } else { "000000" };
        for left in (1..TRIES_PER_CODE).rev() {
            let w = wrong(&mut p);
            assert_eq!(p.confirm(t0, &id, w, &mut r), Err(Refused::Wrong(left)));
        }
        let w = wrong(&mut p);
        assert_eq!(p.confirm(t0, &id, w, &mut r), Err(Refused::Wrong(0)));
        assert_eq!(p.code(t0), None, "five wrong tries drop the code");

        // Five more on a second code reach ten in the window: locked.
        let (id, _) = p.start(t0, &mut r).unwrap();
        for _ in 0..4 {
            let w = wrong(&mut p);
            assert!(matches!(p.confirm(t0, &id, w, &mut r), Err(Refused::Wrong(_))));
        }
        let w = wrong(&mut p);
        assert_eq!(p.confirm(t0, &id, w, &mut r), Err(Refused::Locked(600)));
        assert_eq!(p.code(t0), None);
        let t1 = t0 + Duration::from_secs(60);
        assert_eq!(p.start(t1, &mut r), Err(Refused::Locked(540)));
        assert!(matches!(p.confirm(t1, &id, "123456", &mut r), Err(Refused::Locked(_))));
        assert!(p.start(t0 + LOCKOUT, &mut r).is_ok(), "open again after the lockout");
    }

    #[test]
    fn failures_outside_the_window_do_not_count() {
        let (mut p, mut r, t0) = (Pairing::default(), counter(), Instant::now());
        let mut now = t0;
        for _ in 0..30 {
            let (id, _) = p.start(now, &mut r).unwrap();
            let w = if p.code(now).unwrap().0 == "000000" { "000001" } else { "000000" };
            assert!(matches!(p.confirm(now, &id, w, &mut r), Err(Refused::Wrong(_))));
            now += Duration::from_secs(70); // at most nine in any ten minutes
        }
    }

    #[test]
    fn sessions_expire_unused_and_the_oldest_goes() {
        let (mut p, mut r, t0) = (Pairing::default(), counter(), Instant::now());
        let mut pair = |p: &mut Pairing, now| {
            let (id, _) = p.start(now, &mut r).unwrap();
            let (code, _) = p.code(now).unwrap();
            p.confirm(now, &id, &code, &mut r).unwrap()
        };
        let a = pair(&mut p, t0);
        let others: Vec<_> = (0..MAX_SESSIONS).map(|_| pair(&mut p, t0)).collect();
        assert!(!p.session(t0, &a), "the fifth session pushes out the first");
        assert!(others.iter().all(|t| p.session(t0, t)));
        let used = t0 + SESSION_IDLE - Duration::from_secs(1);
        assert!(p.session(used, &others[0]), "use keeps a session alive");
        assert!(p.session(used + SESSION_IDLE - Duration::from_secs(1), &others[0]));
        assert!(!p.session(used + SESSION_IDLE - Duration::from_secs(1), &others[1]), "unused for 12 h");
    }

    #[test]
    fn cancel_drops_the_code() {
        let (mut p, mut r, t0) = (Pairing::default(), counter(), Instant::now());
        let (id, _) = p.start(t0, &mut r).unwrap();
        let (code, _) = p.code(t0).unwrap();
        assert!(p.cancel());
        assert!(!p.cancel());
        assert_eq!(p.confirm(t0, &id, &code, &mut r), Err(Refused::Expired));
    }

    #[test]
    fn codes_are_six_digits_from_the_random_bytes() {
        let mut fixed = |b: &mut [u8]| b.copy_from_slice(&42u32.to_le_bytes()[..b.len()]);
        assert_eq!(code(&mut fixed), "000042");
        // A value past the last whole million is drawn again.
        let mut draws = vec![u32::MAX, 7].into_iter();
        let mut seq = |b: &mut [u8]| b.copy_from_slice(&draws.next().unwrap().to_le_bytes());
        assert_eq!(code(&mut seq), "000007");
    }
}
