//! The desktops' screen stays on while a film plays. Windows, macOS and Linux turn the display
//! off after a while without input, and lock the session or sleep with it; mpv holds the screen
//! itself only from a window of its own (`stop-screensaver`), not drawn through its render API
//! as reel draws it. Each player holds a part (`Part`) while its film plays (`mpv::player`: not
//! paused, not at its end, the view not gone); the screen dims as usual once no part is held.
//! iOS keeps its own (`ios_awake`: while the player is on screen); elsewhere this holds nothing.

use std::sync::{
    Mutex,
    atomic::{AtomicBool, Ordering},
};

/// The players whose films play, and how the system is told the screen is wanted (or no longer).
pub struct Screen {
    playing: Mutex<usize>,
    keep: fn(bool),
}

static SCREEN: Screen = Screen { playing: Mutex::new(0), keep: os::keep };

/// One player's part: held while its film plays, let go for good when the player goes.
pub struct Part {
    screen: &'static Screen,
    on: AtomicBool,
    gone: AtomicBool,
}

impl Default for Part {
    fn default() -> Part {
        Part::of(&SCREEN)
    }
}

impl Part {
    fn of(screen: &'static Screen) -> Part {
        Part { screen, on: AtomicBool::new(false), gone: AtomicBool::new(false) }
    }

    /// The film plays (`true`) or not. Called from the player's event thread and the view's.
    pub fn set(&self, playing: bool) {
        if self.on.load(Ordering::SeqCst) == playing {
            return;
        }
        let mut count = self.screen.playing.lock().unwrap_or_else(|e| e.into_inner());
        // Under the lock, so a player that goes is never held again by a late event.
        let playing = playing && !self.gone.load(Ordering::SeqCst);
        if self.on.swap(playing, Ordering::SeqCst) == playing {
            return;
        }
        let was = *count > 0;
        *count = if playing { *count + 1 } else { count.saturating_sub(1) };
        if (*count > 0) != was {
            (self.screen.keep)(*count > 0);
        }
    }

    /// The player goes (the view let go): its part is let go, and stays so.
    pub fn let_go(&self) {
        self.gone.store(true, Ordering::SeqCst);
        self.set(false);
    }
}

impl Drop for Part {
    fn drop(&mut self) {
        self.let_go();
    }
}

/// Windows: a power request (`powercfg /requests` lists it) for the display and against sleep.
#[cfg(windows)]
mod os {
    use std::{ffi::c_void, sync::OnceLock};

    use windows::{
        Win32::{
            Foundation::HANDLE,
            System::{
                Power::{PowerClearRequest, PowerCreateRequest, PowerRequestDisplayRequired, PowerRequestSystemRequired, PowerSetRequest},
                Threading::{POWER_REQUEST_CONTEXT_SIMPLE_STRING, REASON_CONTEXT, REASON_CONTEXT_0},
            },
        },
        core::{PWSTR, w},
    };

    /// The app's request, made once and kept for the app's life (set and cleared as films play).
    fn request() -> Option<HANDLE> {
        static REQUEST: OnceLock<Option<usize>> = OnceLock::new();
        let made = *REQUEST.get_or_init(|| {
            let context = REASON_CONTEXT {
                // POWER_REQUEST_CONTEXT_VERSION.
                Version: 0,
                Flags: POWER_REQUEST_CONTEXT_SIMPLE_STRING,
                Reason: REASON_CONTEXT_0 { SimpleReasonString: PWSTR(w!("Playing a film").as_ptr() as *mut u16) },
            };
            match unsafe { PowerCreateRequest(&context) } {
                Ok(h) => Some(h.0 as usize),
                Err(e) => {
                    tracing::warn!("reel: no power request, the screen may turn off during a film: {e}");
                    None
                }
            }
        });
        made.map(|h| HANDLE(h as *mut c_void))
    }

    pub fn keep(on: bool) {
        let Some(request) = request() else { return };
        for kind in [PowerRequestDisplayRequired, PowerRequestSystemRequired] {
            let done = unsafe { if on { PowerSetRequest(request, kind) } else { PowerClearRequest(request, kind) } };
            if let Err(e) = done {
                tracing::warn!("reel: power request {} ({}): {e}", kind.0, if on { "set" } else { "clear" });
            }
        }
    }
}

/// macOS: an activity of the process's (an IOKit assertion: `pmset -g assertions` lists it)
/// against display and system sleep.
#[cfg(target_os = "macos")]
mod os {
    use std::sync::Mutex;

    use objc2::{rc::Retained, runtime::ProtocolObject};
    use objc2_foundation::{NSActivityOptions, NSObjectProtocol, NSProcessInfo, NSString};

    struct Activity(Retained<ProtocolObject<dyn NSObjectProtocol>>);
    // SAFETY: NSProcessInfo is thread-safe: an activity may end on any thread.
    unsafe impl Send for Activity {}

    static ACTIVITY: Mutex<Option<Activity>> = Mutex::new(None);

    pub fn keep(on: bool) {
        let info = NSProcessInfo::processInfo();
        let mut activity = ACTIVITY.lock().unwrap_or_else(|e| e.into_inner());
        if on && activity.is_none() {
            let options = NSActivityOptions::IdleDisplaySleepDisabled | NSActivityOptions::IdleSystemSleepDisabled;
            *activity = Some(Activity(info.beginActivityWithOptions_reason(options, &NSString::from_str("Playing a film"))));
        } else if !on && let Some(Activity(a)) = activity.take() {
            unsafe { info.endActivity(&a) };
        }
    }
}

/// Linux desktops: GTK's inhibitor (the session manager, or the desktop portal) against idle and
/// suspend, on GTK's thread.
#[cfg(all(target_os = "linux", not(target_arch = "arm")))]
mod os {
    use std::{
        cell::Cell,
        sync::atomic::{AtomicBool, Ordering},
    };

    use gtk4::{ApplicationInhibitFlags, gio, glib, prelude::*};

    /// Whether a film plays, as last said; GTK reads it on its thread.
    static WANTED: AtomicBool = AtomicBool::new(false);

    pub fn keep(on: bool) {
        WANTED.store(on, Ordering::SeqCst);
        glib::MainContext::default().invoke(apply);
    }

    fn apply() {
        thread_local! {
            /// GTK's cookie for the inhibitor held (0: none).
            static COOKIE: Cell<u32> = const { Cell::new(0) };
        }
        let on = WANTED.load(Ordering::SeqCst);
        let Some(app) = gio::Application::default().and_then(|a| a.downcast::<gtk4::Application>().ok()) else {
            tracing::warn!("reel: no GTK application, the screen may turn off during a film");
            return;
        };
        COOKIE.with(|cookie| {
            if on && cookie.get() == 0 {
                let window = app.active_window();
                let made = app.inhibit(window.as_ref(), ApplicationInhibitFlags::IDLE | ApplicationInhibitFlags::SUSPEND, Some("Playing a film"));
                if made == 0 {
                    tracing::warn!("reel: GTK did not inhibit idle, the screen may turn off during a film");
                }
                cookie.set(made);
            } else if !on && cookie.get() != 0 {
                app.uninhibit(cookie.replace(0));
            }
        });
    }
}

#[cfg(not(any(windows, target_os = "macos", all(target_os = "linux", not(target_arch = "arm")))))]
mod os {
    pub fn keep(_on: bool) {}
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use super::{Part, Screen};

    static TOLD: Mutex<Vec<bool>> = Mutex::new(Vec::new());
    static SCREEN: Screen = Screen { playing: Mutex::new(0), keep: |on| TOLD.lock().unwrap().push(on) };

    #[test]
    fn the_screen_is_kept_while_any_film_plays_and_never_for_a_player_gone() {
        let (a, b) = (Part::of(&SCREEN), Part::of(&SCREEN));
        a.set(true);
        a.set(true);
        b.set(true);
        a.set(false);
        assert_eq!(*TOLD.lock().unwrap(), [true], "kept once, while one film still plays");
        b.let_go();
        b.set(true);
        assert_eq!(*TOLD.lock().unwrap(), [true, false], "a player gone is not held again");
        a.set(true);
        drop(a);
        assert_eq!(*TOLD.lock().unwrap(), [true, false, true, false], "a player dropped lets go");
        assert_eq!(*SCREEN.playing.lock().unwrap(), 0);
    }
}
