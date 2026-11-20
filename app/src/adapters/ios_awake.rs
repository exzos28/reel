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

/// reel's background (`colors.ink`, nsh.json) behind everything on iOS: NSH paints the window's
/// root white ("as in React Native"), which showed as a white flash at start, before the UI drew,
/// and through the player's dialog as it faded in. Called on the main thread.
pub fn paint_root() {
    use objc2::{msg_send, rc::Retained, runtime::AnyObject};
    let Some(mtm) = MainThreadMarker::new() else { return };
    let app = UIApplication::sharedApplication(mtm);
    let ink: Retained<AnyObject> = unsafe {
        msg_send![objc2::class!(UIColor), colorWithRed: 15.0f64 / 255.0, green: 15.0f64 / 255.0, blue: 15.0f64 / 255.0, alpha: 1.0f64]
    };
    unsafe {
        let scenes: Retained<AnyObject> = msg_send![&app, connectedScenes];
        let scenes: Retained<objc2_foundation::NSArray<AnyObject>> = msg_send![&scenes, allObjects];
        for scene in scenes.iter() {
            let responds: bool = msg_send![&scene, respondsToSelector: objc2::sel!(windows)];
            if !responds {
                continue;
            }
            let windows: Retained<objc2_foundation::NSArray<AnyObject>> = msg_send![&scene, windows];
            for window in windows.iter() {
                let _: () = msg_send![&window, setBackgroundColor: &*ink];
                let root: Option<Retained<AnyObject>> = msg_send![&window, rootViewController];
                if let Some(root) = root {
                    let view: Option<Retained<AnyObject>> = msg_send![&root, view];
                    if let Some(view) = view {
                        let _: () = msg_send![&view, setBackgroundColor: &*ink];
                    }
                }
            }
        }
    }
}

/// Asks the window's scene for landscape or portrait (iOS 16+'s geometry request: it works with the
/// rotation lock on, which a phone's own turning does not).
pub fn turn(landscape: bool) {
    extern "C" fn run(context: *mut c_void) {
        use objc2::{msg_send, rc::Retained, runtime::AnyObject};
        let Some(mtm) = MainThreadMarker::new() else { return };
        // UIInterfaceOrientationMask: portrait 1 << 1, landscape (left and right) 1 << 3 | 1 << 4.
        let mask: usize = if context.is_null() { 1 << 1 } else { (1 << 3) | (1 << 4) };
        let Some(class) = objc2::runtime::AnyClass::get(c"UIWindowSceneGeometryPreferencesIOS") else { return };
        let app = UIApplication::sharedApplication(mtm);
        unsafe {
            let prefs: Retained<AnyObject> = msg_send![msg_send![class, alloc], initWithInterfaceOrientations: mask];
            let scenes: Retained<AnyObject> = msg_send![&app, connectedScenes];
            let scenes: Retained<objc2_foundation::NSArray<AnyObject>> = msg_send![&scenes, allObjects];
            for scene in scenes.iter() {
                let responds: bool = msg_send![&scene, respondsToSelector: objc2::sel!(requestGeometryUpdateWithPreferences:errorHandler:)];
                if responds {
                    let none: *const AnyObject = std::ptr::null();
                    let _: () = msg_send![&scene, requestGeometryUpdateWithPreferences: &*prefs, errorHandler: none];
                }
            }
        }
    }
    unsafe { dispatch_async_f(&raw const _dispatch_main_q, landscape as usize as *mut c_void, run) };
}
