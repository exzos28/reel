//! iOS and iPadOS: the screen stays on while a film plays (mpv, unlike AVPlayer, does not hold
//! it) or something saves (the app stops in the background, and saving with it:
//! design/offline-downloads.md), and dims as usual otherwise. A phone's interface stays upright
//! (`upright_on_phones`), and how the device is held is read for the player (`held`).

use std::{
    ffi::c_void,
    sync::{
        Once,
        atomic::{AtomicBool, AtomicIsize, AtomicU64, AtomicUsize, Ordering},
    },
    time::Duration,
};

use objc2::{MainThreadMarker, MainThreadOnly};
use objc2_foundation::{NSNotification, NSObject, NSObjectProtocol};
use objc2_ui_kit::UIApplication;

/// Players on screen.
static PLAYING: AtomicUsize = AtomicUsize::new(0);
/// Something saves (checked every few seconds).
static SAVING: AtomicBool = AtomicBool::new(false);
/// How the device is held, as UIKit last said (`UIDeviceOrientation`: 1 upright, 2 upside down,
/// 3 landscape left, 4 landscape right, 5 and 6 flat, 0 unknown): read on the main thread.
static HELD: AtomicIsize = AtomicIsize::new(0);
/// How many times the device has turned (`HELD` changed) since the app started.
static TURNS: AtomicU64 = AtomicU64::new(0);
/// The home indicator fades after a moment (`immersive`): the phone's player drawn sideways.
static IMMERSIVE: AtomicBool = AtomicBool::new(false);

/// A player came (`true`) or went: the screen stays on.
pub fn playing(on: bool) {
    if on {
        PLAYING.fetch_add(1, Ordering::Relaxed);
    } else {
        let _ = PLAYING.try_update(Ordering::Relaxed, Ordering::Relaxed, |n| n.checked_sub(1));
    }
    apply();
}

/// Every controller of every window, the root and those it presents (the player's dialog), on
/// the main thread.
fn each_controller(mut f: impl FnMut(&objc2::runtime::AnyObject)) {
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
                    f(&c);
                    controller = msg_send![&c, presentedViewController];
                }
            }
        }
    }
}

/// How the device is held, as the quarter turn a phone's player gives its picture: `Some(90)`
/// turned counter-clockwise (its top at the left: UIKit's landscape left), `Some(-90)` the other
/// way, `Some(0)` upright, `None` flat, upside down or not known; and how many times it has turned
/// since the app started. With the rotation lock on, iOS reports no turn.
pub fn held() -> (Option<i32>, u64) {
    let turn = match HELD.load(Ordering::Relaxed) {
        1 => Some(0),
        3 => Some(90),
        4 => Some(-90),
        _ => None,
    };
    (turn, TURNS.load(Ordering::Relaxed))
}

/// The device's turns as they come, read on the main thread.
fn read_held() {
    use objc2::{msg_send, rc::Retained, runtime::AnyObject};
    if MainThreadMarker::new().is_none() {
        return;
    }
    let device: Retained<AnyObject> = unsafe { msg_send![objc2::class!(UIDevice), currentDevice] };
    let held: isize = unsafe { msg_send![&device, orientation] };
    if HELD.swap(held, Ordering::Relaxed) != held {
        TURNS.fetch_add(1, Ordering::Relaxed);
    }
}

objc2::define_class!(
    /// Hears the device turn (`UIDeviceOrientationDidChangeNotification`).
    #[unsafe(super(NSObject))]
    #[thread_kind = MainThreadOnly]
    #[name = "ReelHeld"]
    struct Held;

    unsafe impl NSObjectProtocol for Held {}

    impl Held {
        #[unsafe(method(turned:))]
        fn turned(&self, _n: &NSNotification) {
            read_held();
        }
    }
);

/// The home indicator fades after a moment of no touches (`true`: the phone's player drawn
/// sideways, where it runs along the picture's side) or stays (`false`). UIKit asks the topmost
/// full-screen controller (`prefersHomeIndicatorAutoHidden`, answered from here for NSH's
/// controllers: `upright_on_phones`) as it shows, and again when told.
pub fn immersive(on: bool) {
    extern "C" fn run(_: *mut c_void) {
        use objc2::msg_send;
        each_controller(|c| unsafe {
            let _: () = msg_send![c, setNeedsUpdateOfHomeIndicatorAutoHidden];
        });
    }
    IMMERSIVE.store(on, Ordering::Relaxed);
    unsafe { dispatch_async_f(&raw const _dispatch_main_q, std::ptr::null_mut(), run) };
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
    // The Objective-C runtime: a method added to, or put in place of, one of NSH's controllers'.
    fn object_getClass(object: *const c_void) -> *mut c_void;
    fn sel_registerName(name: *const std::ffi::c_char) -> *const c_void;
    fn class_replaceMethod(class: *mut c_void, sel: *const c_void, imp: *const c_void, types: *const std::ffi::c_char) -> *const c_void;
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

/// A phone's interface stays upright, the player too: it draws itself sideways inside the upright
/// window (`Player.tsx`, design/player-rendering.md). NSH's window root controller answers its
/// `supportedInterfaceOrientations` itself (every orientation but upside down), so on a phone reel
/// puts portrait in place of that answer and has UIKit read it again (the window was shown before
/// this runs: an app opened with the phone sideways starts upright); a tablet keeps NSH's (its
/// window turns with the device). On a phone the device's turns are followed from here on
/// (`held`), and NSH's controllers answer whether the home indicator fades (`immersive`). Once, at
/// start, on the main thread.
pub fn upright_on_phones() {
    extern "C" fn portrait(_this: *mut c_void, _cmd: *const c_void) -> usize {
        // UIInterfaceOrientationMask.portrait.
        1 << 1
    }
    extern "C" fn indicator_hidden(_this: *mut c_void, _cmd: *const c_void) -> bool {
        IMMERSIVE.load(Ordering::Relaxed)
    }
    static ONCE: Once = Once::new();
    ONCE.call_once(|| unsafe {
        use objc2::{msg_send, rc::Retained, runtime::AnyObject};
        let Some(mtm) = MainThreadMarker::new() else { return };
        // UIUserInterfaceIdiomPhone is 0.
        let device: Retained<AnyObject> = msg_send![objc2::class!(UIDevice), currentDevice];
        let idiom: isize = msg_send![&device, userInterfaceIdiom];
        if idiom != 0 {
            return;
        }
        // UIKit reports how the device is held only to an app that asks; the player reads it.
        let _: () = msg_send![&device, beginGeneratingDeviceOrientationNotifications];
        let held: Retained<Held> = msg_send![Held::alloc(mtm), init];
        let center = objc2_foundation::NSNotificationCenter::defaultCenter();
        center.addObserver_selector_name_object(&held, objc2::sel!(turned:), Some(objc2_foundation::ns_string!("UIDeviceOrientationDidChangeNotification")), None);
        // Kept for the app's life.
        std::mem::forget(held);
        HELD.store(msg_send![&device, orientation], Ordering::Relaxed);
        // UIViewController's own answer (none of NSH's controllers has one): the player's dialog,
        // presented later, answers too.
        let imp = indicator_hidden as extern "C" fn(*mut c_void, *const c_void) -> bool;
        let base = objc2::class!(UIViewController) as *const objc2::runtime::AnyClass as *mut c_void;
        class_replaceMethod(base, sel_registerName(c"prefersHomeIndicatorAutoHidden".as_ptr()), imp as *const c_void, c"B@:".as_ptr());
        // The window's root controller's own class (NSH's), whatever objc2 named it.
        let mut root: Option<Retained<AnyObject>> = None;
        each_controller(|c| {
            if root.is_none() {
                root = Some(objc2::Message::retain(c));
            }
        });
        let Some(root) = root else {
            tracing::warn!("reel: no root controller: a phone may turn its pages sideways");
            return;
        };
        let class = object_getClass(Retained::as_ptr(&root) as *const c_void);
        let imp = portrait as extern "C" fn(*mut c_void, *const c_void) -> usize;
        class_replaceMethod(class, sel_registerName(c"supportedInterfaceOrientations".as_ptr()), imp as *const c_void, c"Q@:".as_ptr());
        let _: () = msg_send![&root, setNeedsUpdateOfSupportedInterfaceOrientations];
    });
}
