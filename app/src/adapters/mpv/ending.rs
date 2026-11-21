//! The players still playing, so the next film starts only once the last one has ended
//! (`VideoEngine.ended`): a player counts from when it is made until its playback has ended
//! after it was let go (`Player`'s drop: mpv's own word, or `ENDING_WAIT`).

use std::{
    sync::atomic::{AtomicUsize, Ordering},
    time::Duration,
};

static PLAYING: AtomicUsize = AtomicUsize::new(0);
static ENDED: tokio::sync::Notify = tokio::sync::Notify::const_new();

/// A player was made.
pub(super) fn started() {
    PLAYING.fetch_add(1, Ordering::SeqCst);
}

/// A player's playback has ended (or it was given up on): once per `started`.
pub(super) fn ended() {
    let _ = PLAYING.try_update(Ordering::SeqCst, Ordering::SeqCst, |n| n.checked_sub(1));
    ENDED.notify_waiters();
}

/// Waits until no player plays: true then, false if one still does after `wait`.
pub async fn none_playing(wait: Duration) -> bool {
    let waiting = crate::application::catalog::runtime().spawn(async move {
        let deadline = tokio::time::Instant::now() + wait;
        loop {
            let notified = ENDED.notified();
            tokio::pin!(notified);
            notified.as_mut().enable();
            if PLAYING.load(Ordering::SeqCst) == 0 {
                return true;
            }
            if tokio::time::timeout_at(deadline, notified).await.is_err() {
                return PLAYING.load(Ordering::SeqCst) == 0;
            }
        }
    });
    waiting.await.unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn block_on<T>(f: impl std::future::Future<Output = T>) -> T {
        tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap().block_on(f)
    }

    #[test]
    fn the_next_film_waits_for_the_last_player_to_end() {
        assert!(block_on(none_playing(Duration::from_millis(50))), "none made: at once");
        started();
        let began = std::time::Instant::now();
        let ending = std::thread::spawn(|| {
            std::thread::sleep(Duration::from_millis(150));
            ended();
        });
        assert!(block_on(none_playing(Duration::from_secs(5))));
        assert!(began.elapsed() >= Duration::from_millis(150), "waited for it: {:?}", began.elapsed());
        ending.join().unwrap();
        started();
        assert!(!block_on(none_playing(Duration::from_millis(100))), "one that does not end: not for ever");
        ended();
    }
}
