//! The mpv video view on Android: the Java side (`app/android/java/app/reel/views/MpvView.java`)
//! is a TextureView that NSH lays out; these are its `native` methods, which drive the same
//! `Player` as on macOS. mpv draws into the view's Surface itself (`vo=gpu`,
//! `gpu-context=android`, `wid` a global reference to the Surface) and decodes with
//! MediaCodec where it can. The player's events go back to the view's `emit`.
//!
//! The methods are called on the UI thread and never wait for mpv's (the player's calls are
//! asynchronous): mpv's thread may be waiting for the stream, or for the UI thread itself, which
//! takes the TextureView's frames. A Surface mpv drew into is let go once mpv has stopped using
//! it (`MpvView.release`), and the player stops on a thread of its own.

use std::{
    ffi::{c_char, c_void},
    ptr,
    sync::{Arc, Mutex, Once},
};

use jni_sys::{JNI_OK, JNI_VERSION_1_6, JNIEnv, JavaVM, jclass, jlong, jmethodID, jobject, jstring, jvalue};
use serde_json::Value;

use super::{ffi, player::Player};

/// Where mpv draws and how it decodes and plays sound on Android (mpv-android's choices).
const PLATFORM: [(&str, &str); 5] = [
    ("gpu-context", "android"),
    ("opengl-es", "yes"),
    // MediaCodec where the device has the codec: straight into mpv's renderer (an AImageReader
    // gives the decoder its window; "mediacodec-copy" alone found none and fell back to the
    // CPU), else copied back.
    ("hwdec", "mediacodec,mediacodec-copy"),
    ("ao", "audiotrack,opensles"),
    ("force-window", "no"),
];

/// A JVM pointer that may cross threads (the JVM is process-wide).
#[derive(Clone, Copy)]
struct Vm(*mut JavaVM);
unsafe impl Send for Vm {}
unsafe impl Sync for Vm {}

/// A global reference that may cross threads (global references are thread-safe).
#[derive(Clone, Copy)]
struct Global(jobject);
unsafe impl Send for Global {}
unsafe impl Sync for Global {}

impl Global {
    /// The reference (a method, so closures take the whole `Global`, which crosses threads,
    /// not its raw field).
    fn get(self) -> jobject {
        self.0
    }
}

/// One view's player and what it holds of Java.
struct View {
    player: Player,
    vm: Vm,
    /// The Java view (for `emit`), a global reference.
    this: Global,
    /// `MpvView`'s class (for `release`), a global reference: threads of the player's find no
    /// class of the app's by name.
    class: Global,
    /// The Surface mpv draws into, a global reference while attached.
    surface: Option<Global>,
}

unsafe fn env_of(vm: Vm) -> Option<*mut JNIEnv> {
    let invoke = unsafe { &**vm.0 };
    let mut env: *mut c_void = ptr::null_mut();
    if unsafe { (invoke.v1_4.GetEnv)(vm.0, &mut env, JNI_VERSION_1_6) } == JNI_OK {
        return Some(env.cast());
    }
    // The player's event thread: attached once, as a daemon (it never returns to Java).
    if unsafe { (invoke.v1_4.AttachCurrentThreadAsDaemon)(vm.0, &mut env, ptr::null_mut()) } == JNI_OK {
        return Some(env.cast());
    }
    None
}

unsafe fn string(env: *mut JNIEnv, s: &str) -> jstring {
    let c = ffi::cstr(s);
    unsafe { ((**env).v1_6.NewStringUTF)(env, c.as_ptr() as *const c_char) }
}

unsafe fn rust_string(env: *mut JNIEnv, s: jstring) -> String {
    if s.is_null() {
        return String::new();
    }
    let f = unsafe { &**env };
    let chars = unsafe { (f.v1_6.GetStringUTFChars)(env, s, ptr::null_mut()) };
    if chars.is_null() {
        return String::new();
    }
    let out = unsafe { std::ffi::CStr::from_ptr(chars) }.to_string_lossy().into_owned();
    unsafe { (f.v1_6.ReleaseStringUTFChars)(env, s, chars) };
    out
}

/// A value the Java side sends as a one-element JSON array (`[value]`: any JSON, strings too).
fn value(json: &str) -> Option<Value> {
    match serde_json::from_str::<Value>(json).ok()? {
        Value::Array(mut a) if a.len() == 1 => Some(a.remove(0)),
        _ => None,
    }
}

/// libavcodec's MediaCodec needs the JVM (`av_jni_set_java_vm`), once.
fn give_ffmpeg_the_vm(vm: Vm) {
    static ONCE: Once = Once::new();
    ONCE.call_once(|| unsafe {
        let lib = libc::dlopen(c"libavcodec.so".as_ptr(), libc::RTLD_NOW);
        let sym = if lib.is_null() { ptr::null_mut() } else { libc::dlsym(lib, c"av_jni_set_java_vm".as_ptr()) };
        if sym.is_null() {
            tracing::warn!("reel mpv: no av_jni_set_java_vm (MediaCodec off)");
            return;
        }
        let set: unsafe extern "C" fn(*mut c_void, *mut c_void) -> i32 = std::mem::transmute(sym);
        set(vm.0.cast(), ptr::null_mut());
    });
}

/// `long nativeCreate()`: a player for this view (0 when libmpv is missing).
#[unsafe(no_mangle)]
extern "system" fn Java_app_reel_views_MpvView_nativeCreate(env: *mut JNIEnv, this: jobject) -> jlong {
    let Some(lib) = ffi::lib() else { return 0 };
    let f = unsafe { &**env };
    let mut vm: *mut JavaVM = ptr::null_mut();
    if unsafe { (f.v1_6.GetJavaVM)(env, &mut vm) } != JNI_OK {
        return 0;
    }
    let vm = Vm(vm);
    give_ffmpeg_the_vm(vm);
    let me = Global(unsafe { (f.v1_6.NewGlobalRef)(env, this) });
    let class: jclass = unsafe { (f.v1_6.GetObjectClass)(env, this) };
    let emit_id = Global(unsafe { (f.v1_6.GetMethodID)(env, class, c"emit".as_ptr(), c"(Ljava/lang/String;Ljava/lang/String;)V".as_ptr()) } as jobject);
    // Events from the player's thread: `MpvView.emit(name, json)`.
    let sink = Mutex::new(());
    let emit = Arc::new(move |name: &str, data: Value| {
        let _one_at_a_time = sink.lock();
        let Some(env) = (unsafe { env_of(vm) }) else { return };
        let f = unsafe { &**env };
        let args = [jvalue { l: unsafe { string(env, name) } }, jvalue { l: unsafe { string(env, &data.to_string()) } }];
        unsafe { (f.v1_6.CallVoidMethodA)(env, me.get(), emit_id.get() as jmethodID, args.as_ptr()) };
        if unsafe { (f.v1_6.ExceptionCheck)(env) } {
            unsafe { (f.v1_6.ExceptionClear)(env) };
        }
        unsafe { (f.v1_6.DeleteLocalRef)(env, args[0].l) };
        unsafe { (f.v1_6.DeleteLocalRef)(env, args[1].l) };
    });
    match Player::new(lib, "null", &PLATFORM, emit) {
        Ok(player) => {
            let class = Global(unsafe { (f.v1_6.NewGlobalRef)(env, class) });
            Box::into_raw(Box::new(View { player, vm, this: me, class, surface: None })) as jlong
        }
        Err(e) => {
            tracing::warn!("reel mpv: {e}");
            unsafe { (f.v1_6.DeleteGlobalRef)(env, me.0) };
            0
        }
    }
}

unsafe fn view<'a>(handle: jlong) -> Option<&'a mut View> {
    unsafe { (handle as *mut View).as_mut() }
}

/// `nativeAttach(long, Surface)`: draw into the Surface (it was created).
#[unsafe(no_mangle)]
extern "system" fn Java_app_reel_views_MpvView_nativeAttach(env: *mut JNIEnv, _: jobject, handle: jlong, surface: jobject) {
    let Some(v) = (unsafe { view(handle) }) else { return };
    unsafe { detach(env, v, ptr::null_mut()) };
    let f = unsafe { &**env };
    let global = Global(unsafe { (f.v1_6.NewGlobalRef)(env, surface) });
    v.surface = Some(global);
    v.player.set_window(global.0 as i64);
    v.player.set_property("force-window", "yes");
    v.player.set_property("vo", "gpu");
}

/// mpv stops drawing into the Surface. Once it has, the Surface (and `texture`, its
/// SurfaceTexture, when given) is released (`MpvView.release`) and its global reference
/// deleted: mpv reads `wid` when its output starts, until then.
unsafe fn detach(env: *mut JNIEnv, v: &mut View, texture: jobject) {
    let Some(surface) = v.surface.take() else { return };
    let f = unsafe { &**env };
    let texture = Global(if texture.is_null() { ptr::null_mut() } else { unsafe { (f.v1_6.NewGlobalRef)(env, texture) } });
    v.player.set_property("vo", "null");
    v.player.set_property("force-window", "no");
    v.player.set_window(0);
    let (vm, class) = (v.vm, v.class);
    v.player.after_requests(move || unsafe { release(vm, class, surface, texture) });
}

/// `MpvView.release(surface, texture)` (mpv no longer draws into them), and the references go.
unsafe fn release(vm: Vm, class: Global, surface: Global, texture: Global) {
    let Some(env) = (unsafe { env_of(vm) }) else { return };
    let f = unsafe { &**env };
    let id = unsafe { (f.v1_6.GetStaticMethodID)(env, class.get(), c"release".as_ptr(), c"(Landroid/view/Surface;Landroid/graphics/SurfaceTexture;)V".as_ptr()) };
    if !id.is_null() {
        let args = [jvalue { l: surface.get() }, jvalue { l: texture.get() }];
        unsafe { (f.v1_6.CallStaticVoidMethodA)(env, class.get(), id, args.as_ptr()) };
    }
    if unsafe { (f.v1_6.ExceptionCheck)(env) } {
        unsafe { (f.v1_6.ExceptionClear)(env) };
    }
    unsafe { (f.v1_6.DeleteGlobalRef)(env, surface.get()) };
    if !texture.get().is_null() {
        unsafe { (f.v1_6.DeleteGlobalRef)(env, texture.get()) };
    }
}

/// `nativeDetach(long, SurfaceTexture)`: the Surface is going away; it and its texture are
/// released once mpv no longer draws into them (the view keeps them until then).
#[unsafe(no_mangle)]
extern "system" fn Java_app_reel_views_MpvView_nativeDetach(env: *mut JNIEnv, _: jobject, handle: jlong, texture: jobject) {
    if let Some(v) = unsafe { view(handle) } {
        unsafe { detach(env, v, texture) };
    }
}

/// `nativeSize(long, int, int)`: the Surface's size in pixels.
#[unsafe(no_mangle)]
extern "system" fn Java_app_reel_views_MpvView_nativeSize(_: *mut JNIEnv, _: jobject, handle: jlong, width: i32, height: i32) {
    if let Some(v) = unsafe { view(handle) } {
        v.player.set_property("android-surface-size", &format!("{width}x{height}"));
    }
}

/// `nativeProp(long, String name, String json)`: a prop of the TSX view, `[value]`.
#[unsafe(no_mangle)]
extern "system" fn Java_app_reel_views_MpvView_nativeProp(env: *mut JNIEnv, _: jobject, handle: jlong, name: jstring, json: jstring) {
    let Some(v) = (unsafe { view(handle) }) else { return };
    let (name, json) = unsafe { (rust_string(env, name), rust_string(env, json)) };
    v.player.set_prop(&name, value(&json).as_ref());
}

/// `nativeCommand(long, String name, String json)`: `ref.command(name, args)`, `[args]`.
#[unsafe(no_mangle)]
extern "system" fn Java_app_reel_views_MpvView_nativeCommand(env: *mut JNIEnv, _: jobject, handle: jlong, name: jstring, json: jstring) {
    let Some(v) = (unsafe { view(handle) }) else { return };
    let (name, json) = unsafe { (rust_string(env, name), rust_string(env, json)) };
    v.player.run(&name, &value(&json).unwrap_or(Value::Null));
}

/// `nativeDestroy(long)`: the view is gone; the player stops and is freed on a thread of its
/// own (stopping waits for mpv's thread). The Surface it may still draw into is the view's to
/// release: mpv holds its own reference to the window while it stops.
#[unsafe(no_mangle)]
extern "system" fn Java_app_reel_views_MpvView_nativeDestroy(_: *mut JNIEnv, _: jobject, handle: jlong) {
    if handle == 0 {
        return;
    }
    let v = unsafe { Box::from_raw(handle as *mut View) };
    let stopping = std::thread::Builder::new().name("reel-mpv-close".into()).spawn(move || {
        let View { player, vm, this, class, surface } = *v;
        // Stops the event thread too, before the Java view's reference goes.
        drop(player);
        let Some(env) = (unsafe { env_of(vm) }) else { return };
        let f = unsafe { &**env };
        for global in [surface.map(Global::get), Some(this.get()), Some(class.get())].into_iter().flatten() {
            unsafe { (f.v1_6.DeleteGlobalRef)(env, global) };
        }
        // A thread of ours: it leaves the JVM before it ends.
        unsafe { ((**vm.0).v1_4.DetachCurrentThread)(vm.0) };
    });
    if let Err(e) = stopping {
        tracing::warn!("reel mpv: the player was not stopped: {e}");
    }
}
