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
/// The player asked for landscape (`turn`): a phone's root controller allows it from then on, as
/// the player opens, before its video view comes (`upright_on_phones`).
static SIDEWAYS_ASKED: AtomicBool = AtomicBool::new(false);

/// A player came (`true`) or went: the screen stays on, and a phone may turn (`upright_on_phones`).
pub fn playing(on: bool) {
    if on {
        PLAYING.fetch_add(1, Ordering::Relaxed);
    } else {
        let _ = PLAYING.try_update(Ordering::Relaxed, Ordering::Relaxed, |n| n.checked_sub(1));
    }
    apply();
    orientations_changed();
}

/// Asks UIKit to read the root controller's orientations again (iOS 16+): it turns back upright
/// when the player goes.
fn orientations_changed() {
    extern "C" fn run(_: *mut c_void) {
        if MainThreadMarker::new().is_some() {
            reread_orientations();
        }
    }
    unsafe { dispatch_async_f(&raw const _dispatch_main_q, std::ptr::null_mut(), run) };
}

/// Every window's controllers, the root and those it presents (the player's dialog), read their
/// orientations again (iOS 16+). On the main thread.
fn reread_orientations() {
    use objc2::{msg_send, rc::Retained, runtime::AnyObject};
    let Some(mtm) = MainThreadMarker::new() else { return };
    let app = UIApplication::sharedApplication(mtm);
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
                let mut controller: Option<Retained<AnyObject>> = msg_send![&window, rootViewController];
                while let Some(c) = controller {
                    let can: bool = msg_send![&c, respondsToSelector: objc2::sel!(setNeedsUpdateOfSupportedInterfaceOrientations)];
                    if can {
                        let _: () = msg_send![&c, setNeedsUpdateOfSupportedInterfaceOrientations];
                    }
                    controller = msg_send![&c, presentedViewController];
                }
            }
        }
    }
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

/// Runs `work(context)` on the main thread, a moment later (from any thread).
pub fn on_main(context: usize, work: extern "C" fn(*mut c_void)) {
    unsafe { dispatch_async_f(&raw const _dispatch_main_q, context as *mut c_void, work) };
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

/// The screen's sides, points, shorter first: read on the main thread as the app starts.
static SCREEN: std::sync::Mutex<Option<(f64, f64)>> = std::sync::Mutex::new(None);

/// Keeps the screen's size (UIKit's main screen) for `windowed`. Called on the main thread.
pub fn remember_screen() {
    use objc2::{msg_send, rc::Retained, runtime::AnyObject};
    use objc2_core_foundation::CGRect;
    if MainThreadMarker::new().is_none() {
        return;
    }
    let bounds: CGRect = unsafe {
        let screen: Retained<AnyObject> = msg_send![objc2::class!(UIScreen), mainScreen];
        msg_send![&screen, bounds]
    };
    let (w, h) = (bounds.size.width, bounds.size.height);
    *SCREEN.lock().unwrap() = Some((w.min(h), w.max(h)));
}

/// Whether a window `width` x `height` points does not fill the screen (iPadOS's windowed mode,
/// Split View); false while the screen is not known.
pub fn windowed(width: f64, height: f64) -> bool {
    SCREEN.lock().unwrap().is_some_and(|(short, long)| (width.min(height) - short).abs() > 1.0 || (width.max(height) - long).abs() > 1.0)
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
        // The controllers' orientations first: the player's dialog may have just come or be going.
        reread_orientations();
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
    SIDEWAYS_ASKED.store(landscape, Ordering::Relaxed);
    unsafe { dispatch_async_f(&raw const _dispatch_main_q, landscape as usize as *mut c_void, run) };
}

/// A phone shows reel upright only; the player (a full-screen dialog of its own, with its own
/// orientations) turns sideways. NSH's window root controller has no say in it, so reel adds its
/// `supportedInterfaceOrientations`: portrait on a phone, every orientation on a tablet. Once, at
/// start, on the main thread.
pub fn upright_on_phones() {
    use std::ffi::{c_char, c_void};
    unsafe extern "C" {
        fn object_getClass(object: *mut c_void) -> *mut c_void;
        fn sel_registerName(name: *const c_char) -> *const c_void;
        fn class_addMethod(class: *mut c_void, sel: *const c_void, imp: *const c_void, types: *const c_char) -> bool;
    }
    extern "C" fn orientations(_this: *mut c_void, _cmd: *const c_void) -> usize {
        use objc2::{msg_send, rc::Retained, runtime::AnyObject};
        // UIUserInterfaceIdiomPhone is 0; masks: portrait 1 << 1, all 1 << 1 | 1 << 2 | 1 << 3 | 1 << 4.
        let device: Retained<AnyObject> = unsafe { msg_send![objc2::class!(UIDevice), currentDevice] };
        let idiom: isize = unsafe { msg_send![&device, userInterfaceIdiom] };
        // A phone's player turns: portrait and landscape while one is on screen, or asked for
        // landscape as it opens.
        if idiom != 0 {
            30
        } else if PLAYING.load(Ordering::Relaxed) > 0 || SIDEWAYS_ASKED.load(Ordering::Relaxed) {
            (1 << 1) | (1 << 3) | (1 << 4)
        } else {
            1 << 1
        }
    }
    static ONCE: Once = Once::new();
    ONCE.call_once(|| unsafe {
        use objc2::{msg_send, rc::Retained, runtime::AnyObject};
        let Some(mtm) = MainThreadMarker::new() else { return };
        let app = UIApplication::sharedApplication(mtm);
        // The window's root controller's own class (NSH's), whatever objc2 named it.
        let mut class: *mut c_void = std::ptr::null_mut();
        let scenes: Retained<AnyObject> = msg_send![&app, connectedScenes];
        let scenes: Retained<objc2_foundation::NSArray<AnyObject>> = msg_send![&scenes, allObjects];
        for scene in scenes.iter() {
            let responds: bool = msg_send![&scene, respondsToSelector: objc2::sel!(windows)];
            if !responds {
                continue;
            }
            let windows: Retained<objc2_foundation::NSArray<AnyObject>> = msg_send![&scene, windows];
            for window in windows.iter() {
                let root: Option<Retained<AnyObject>> = msg_send![&window, rootViewController];
                if let Some(root) = root {
                    class = object_getClass(Retained::as_ptr(&root) as *mut c_void);
                }
            }
        }
        if class.is_null() {
            tracing::warn!("reel: no root controller: the phone turns sideways everywhere");
            return;
        }
        let imp = orientations as extern "C" fn(*mut c_void, *const c_void) -> usize;
        class_addMethod(class, sel_registerName(c"supportedInterfaceOrientations".as_ptr()), imp as *const c_void, c"Q@:".as_ptr());
    });
}
