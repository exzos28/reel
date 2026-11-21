//! reel's own native views on Android (`app/android/java`, added to the APK by
//! `build/android-views.sh`): NSH registers native components only from Java
//! (`NshView.registerComponent`), and an app `nsh package` builds has no Java of its own to
//! call it, so this calls `app.reel.views.Install.install()` once, through JNI: the JVM the
//! app runs in, the app's class loader (where reel's classes are), the call. From then on
//! `Install` registers them on every activity's NshView, a new one included (an activity the
//! system makes again while the process lives on). On a phone `Install` keeps the window upright,
//! and `Held` tells how the device is held, for the player that draws itself sideways (`held`).

use std::{
    ffi::{CStr, c_char, c_void},
    ptr,
    sync::{
        OnceLock,
        atomic::{AtomicI32, AtomicU64, Ordering},
    },
};

use jni_sys::{JNI_OK, JNI_VERSION_1_6, JNIEnv, JavaVM, jboolean, jint, jobject, jsize, jvalue};
// (jboolean is Rust's bool in jni-sys 0.4.)

/// Whether reel's views are registered (installed once, then on every new activity by
/// `Install`; false when anything is missing).
pub fn installed() -> bool {
    static DONE: OnceLock<bool> = OnceLock::new();
    *DONE.get_or_init(|| match unsafe { install() } {
        Ok(ok) => ok,
        Err(e) => {
            tracing::warn!("reel views: {e}");
            false
        }
    })
}

type GetCreatedVms = unsafe extern "system" fn(*mut *mut JavaVM, jsize, *mut jsize) -> jint;

/// The JVM the app runs in: `JNI_GetCreatedJavaVMs` from the runtime already loaded.
unsafe fn vm() -> Result<*mut JavaVM, String> {
    let name = c"JNI_GetCreatedJavaVMs";
    let mut sym = unsafe { libc::dlsym(libc::RTLD_DEFAULT, name.as_ptr()) };
    for lib in [c"libnativehelper.so", c"libart.so"] {
        if !sym.is_null() {
            break;
        }
        let handle = unsafe { libc::dlopen(lib.as_ptr(), libc::RTLD_NOW | libc::RTLD_NOLOAD) };
        if !handle.is_null() {
            sym = unsafe { libc::dlsym(handle, name.as_ptr()) };
        }
    }
    if sym.is_null() {
        return Err("no JNI_GetCreatedJavaVMs".into());
    }
    let get: GetCreatedVms = unsafe { std::mem::transmute(sym) };
    let (mut vm, mut n) = (ptr::null_mut::<JavaVM>(), 0 as jsize);
    if unsafe { get(&mut vm, 1, &mut n) } != JNI_OK || n == 0 {
        return Err("no JVM".into());
    }
    Ok(vm)
}

/// A pending Java exception, cleared, as an error.
unsafe fn check(env: *mut JNIEnv, what: &str) -> Result<(), String> {
    let f = unsafe { &**env };
    if unsafe { (f.v1_6.ExceptionCheck)(env) } {
        unsafe { (f.v1_6.ExceptionDescribe)(env) };
        unsafe { (f.v1_6.ExceptionClear)(env) };
        return Err(format!("{what} threw"));
    }
    Ok(())
}

/// The player's full screen on or off (`Install.fullscreen`); nothing when the views are not
/// installed.
pub fn fullscreen(on: bool) {
    call_with_bool(c"fullscreen", on);
}

/// A phone's player is drawn sideways (`Install.immersive`): the system bars stay hidden while it
/// is; nothing when the views are not installed.
pub fn immersive(on: bool) {
    call_with_bool(c"immersive", on);
}

/// `Install.<name>(boolean)`, when the views are installed.
fn call_with_bool(name: &CStr, on: bool) {
    if !installed() {
        return;
    }
    let r = unsafe {
        with_install(|env, class| {
            let f = &**env;
            let id = method(env, class, name, c"(Z)V", true)?;
            let args = [jvalue { z: on }];
            (f.v1_6.CallStaticVoidMethodA)(env, class, id, args.as_ptr());
            check(env, &format!("Install.{name:?}"))
        })
    };
    if let Err(e) = r {
        tracing::warn!("reel views: {e}");
    }
}

/// How a phone is held, as `Held` last said: its codes (`Held.CLOCKWISE` 90, `OTHER_WAY` -90,
/// `UPRIGHT` 0, `UPSIDE_DOWN` 180), or `NOT_KNOWN` before it has said (not a phone, auto-rotate
/// off since the app started).
static HELD: AtomicI32 = AtomicI32::new(NOT_KNOWN);
const NOT_KNOWN: i32 = i32::MIN;
/// How many times it has turned (`HELD` changed) since the app started.
static TURNS: AtomicU64 = AtomicU64::new(0);

/// How a phone is held, as the quarter turn its player gives its picture: `Some(90)` turned
/// counter-clockwise (its top at the left), `Some(-90)` the other way, `Some(0)` upright, `None`
/// upside down or not known; and how many times it has turned since the app started. Followed
/// while the app is in front with the system's auto-rotate on (`Held`): with it off, no turn.
pub fn held() -> (Option<i32>, u64) {
    let turn = match HELD.load(Ordering::Relaxed) {
        t @ (90 | -90 | 0) => Some(t),
        _ => None,
    };
    (turn, TURNS.load(Ordering::Relaxed))
}

/// `Held.nativeHeld(int)`: the phone is held another way (`Held`'s codes), on the main thread.
#[unsafe(no_mangle)]
extern "system" fn Java_app_reel_views_Held_nativeHeld(_: *mut JNIEnv, _: jobject, turn: jint) {
    if HELD.swap(turn, Ordering::Relaxed) != turn {
        TURNS.fetch_add(1, Ordering::Relaxed);
    }
}

unsafe fn install() -> Result<bool, String> {
    unsafe {
        with_install(|env, class| {
            let run = method(env, class, c"install", c"()Z", true)?;
            let ok: jboolean = ((**env).v1_6.CallStaticBooleanMethodA)(env, class, run, ptr::null());
            check(env, "Install.install")?;
            Ok(ok)
        })
    }
}

/// Runs `f` with this thread's JNI environment and the `Install` class (from the app's class
/// loader), attaching the thread for the call when it is not.
unsafe fn with_install<T>(f: impl FnOnce(*mut JNIEnv, jobject) -> Result<T, String>) -> Result<T, String> {
    let vm = unsafe { vm()? };
    let invoke = unsafe { &**vm };
    let mut env: *mut c_void = ptr::null_mut();
    let attached_here = unsafe { (invoke.v1_4.GetEnv)(vm, &mut env, JNI_VERSION_1_6) } != JNI_OK;
    if attached_here && unsafe { (invoke.v1_4.AttachCurrentThread)(vm, &mut env, ptr::null_mut()) } != JNI_OK {
        return Err("could not attach the thread".into());
    }
    let env = env as *mut JNIEnv;
    let result = unsafe { install_class(env) }.and_then(|class| f(env, class));
    if attached_here {
        unsafe { (invoke.v1_4.DetachCurrentThread)(vm) };
    }
    result
}

unsafe fn method(env: *mut JNIEnv, class: jobject, name: &CStr, sig: &CStr, is_static: bool) -> Result<jni_sys::jmethodID, String> {
    let f = unsafe { &**env };
    let id = if is_static {
        unsafe { (f.v1_6.GetStaticMethodID)(env, class, name.as_ptr(), sig.as_ptr()) }
    } else {
        unsafe { (f.v1_6.GetMethodID)(env, class, name.as_ptr(), sig.as_ptr()) }
    };
    unsafe { check(env, &format!("{name:?}"))? };
    if id.is_null() { Err(format!("no method {name:?}")) } else { Ok(id) }
}

unsafe fn install_class(env: *mut JNIEnv) -> Result<jobject, String> {
    let f = unsafe { &**env };
    // The app (ActivityThread.currentApplication()), then its class loader.
    let thread = unsafe { (f.v1_6.FindClass)(env, c"android/app/ActivityThread".as_ptr()) };
    unsafe { check(env, "ActivityThread")? };
    let current = unsafe { method(env, thread, c"currentApplication", c"()Landroid/app/Application;", true)? };
    let app = unsafe { (f.v1_6.CallStaticObjectMethodA)(env, thread, current, ptr::null()) };
    unsafe { check(env, "currentApplication")? };
    if app.is_null() {
        return Err("no application yet".into());
    }
    let context = unsafe { (f.v1_6.GetObjectClass)(env, app) };
    let get_loader = unsafe { method(env, context, c"getClassLoader", c"()Ljava/lang/ClassLoader;", false)? };
    let loader = unsafe { (f.v1_6.CallObjectMethodA)(env, app, get_loader, ptr::null()) };
    unsafe { check(env, "getClassLoader")? };
    let loader_class = unsafe { (f.v1_6.GetObjectClass)(env, loader) };
    let load = unsafe { method(env, loader_class, c"loadClass", c"(Ljava/lang/String;)Ljava/lang/Class;", false)? };
    let name = unsafe { (f.v1_6.NewStringUTF)(env, c"app.reel.views.Install".as_ptr() as *const c_char) };
    let args = [jvalue { l: name }];
    let install = unsafe { (f.v1_6.CallObjectMethodA)(env, loader, load, args.as_ptr()) };
    unsafe { check(env, "loading app.reel.views.Install (is the APK built with build/android-views.sh?)")? };
    Ok(install)
}

/// `Link.nativeOpen(String)`: a link that opened the app, offered to the screen
/// (`hosted::offer_link`; `app/android/java/app/reel/views/Link.java` says why).
#[unsafe(no_mangle)]
extern "system" fn Java_app_reel_views_Link_nativeOpen(env: *mut JNIEnv, _: jobject, url: jobject) {
    if url.is_null() {
        return;
    }
    let f = unsafe { &**env };
    let chars = unsafe { (f.v1_6.GetStringUTFChars)(env, url, ptr::null_mut()) };
    if chars.is_null() {
        return;
    }
    let link = unsafe { CStr::from_ptr(chars) }.to_string_lossy().into_owned();
    unsafe { (f.v1_6.ReleaseStringUTFChars)(env, url, chars) };
    if !crate::interface::hosted::offer_link(&link) {
        tracing::warn!("reel: a link with no source to offer");
    }
}
