//! iOS and iPadOS: the screen stays on while a film plays (mpv, unlike AVPlayer, does not hold
//! it) or something saves (the app stops in the background, and saving with it:
//! design/offline-downloads.md), and dims as usual otherwise.

use std::{
    ffi::c_void,
    sync::{
        Once,
        atomic::{AtomicBool, AtomicUsize, Ordering},
    },
    time::Duration,
};

use objc2::MainThreadMarker;
use objc2_ui_kit::UIApplication;

/// Players on screen.
static PLAYING: AtomicUsize = AtomicUsize::new(0);
/// Something saves (checked every few seconds).
static SAVING: AtomicBool = AtomicBool::new(false);

/// A player came (`true`) or went.
pub fn playing(on: bool) {
    if on {
        PLAYING.fetch_add(1, Ordering::Relaxed);
    } else {
        let _ = PLAYING.try_update(Ordering::Relaxed, Ordering::Relaxed, |n| n.checked_sub(1));
    }
    apply();
}

/// Starts following what saves; once.
pub fn watch() {
    static ONCE: Once = Once::new();
    ONCE.call_once(|| {
        let _ = std::thread::Builder::new().name("reel-awake".into()).spawn(|| {
            loop {
                let now = crate::application::library::saving_now();
                if SAVING.swap(now, Ordering::Relaxed) != now {
                    apply();
                }
                std::thread::sleep(Duration::from_secs(3));
            }
        });
    });
}

unsafe extern "C" {
    static _dispatch_main_q: c_void;
    fn dispatch_async_f(queue: *const c_void, context: *mut c_void, work: extern "C" fn(*mut c_void));
}

/// UIKit's idle timer, on the main thread.
fn apply() {
    let on = PLAYING.load(Ordering::Relaxed) > 0 || SAVING.load(Ordering::Relaxed);
    extern "C" fn set(context: *mut c_void) {
        let Some(mtm) = MainThreadMarker::new() else { return };
        UIApplication::sharedApplication(mtm).setIdleTimerDisabled(!context.is_null());
    }
    unsafe { dispatch_async_f(&raw const _dispatch_main_q, on as usize as *mut c_void, set) };
}
