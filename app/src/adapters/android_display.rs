//! What an Android screen shows, read from the system once (`compat::Display`): NSH tells the UI
//! its window in points, which on a TV is a 1080p surface whatever the screen behind it, and
//! nothing of HDR. The default display's modes give the tallest picture the screen takes (an
//! Android TV lists the modes of the TV it is plugged into), its HDR capabilities whether it
//! shows HDR10 and Dolby Vision. Framework calls only, through JNI (no Java of reel's needed).

use std::{
    ffi::{CStr, c_void},
    ptr,
};

use jni_sys::{JNI_OK, JNI_VERSION_1_6, JNIEnv, JavaVM, jint, jmethodID, jobject, jsize, jvalue};
use reel_domain::compat::Display;

/// `Display.HdrCapabilities`' types.
const HDR_TYPE_DOLBY_VISION: jint = 1;
const HDR_TYPE_HDR10: jint = 2;
const HDR_TYPE_HDR10_PLUS: jint = 4;

/// The default display's facts; all unknown when the system did not say (logged).
pub fn display() -> Display {
    match unsafe { with_env(|env| read(env)) } {
        Ok(d) => {
            tracing::info!("reel display: {d:?}");
            d
        }
        Err(e) => {
            tracing::warn!("reel display: {e}");
            Display::default()
        }
    }
}

type GetCreatedVms = unsafe extern "system" fn(*mut *mut JavaVM, jsize, *mut jsize) -> jint;

/// Runs `f` with this thread's JNI environment (attached for the call when it is not) in a local
/// frame of its own.
unsafe fn with_env<T>(f: impl FnOnce(*mut JNIEnv) -> Result<T, String>) -> Result<T, String> {
    // As `android_views` finds it: the runtime already loaded exports it.
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
    let invoke = unsafe { &**vm };
    let mut env: *mut c_void = ptr::null_mut();
    let attached_here = unsafe { (invoke.v1_4.GetEnv)(vm, &mut env, JNI_VERSION_1_6) } != JNI_OK;
    if attached_here && unsafe { (invoke.v1_4.AttachCurrentThread)(vm, &mut env, ptr::null_mut()) } != JNI_OK {
        return Err("could not attach the thread".into());
    }
    let env = env as *mut JNIEnv;
    let fns = unsafe { &**env };
    let result = if unsafe { (fns.v1_6.PushLocalFrame)(env, 32) } == JNI_OK {
        let r = f(env);
        unsafe { (fns.v1_6.PopLocalFrame)(env, ptr::null_mut()) };
        r
    } else {
        Err("no local frame".into())
    };
    if attached_here {
        unsafe { (invoke.v1_4.DetachCurrentThread)(vm) };
    }
    result
}

/// A pending Java exception, cleared, as an error.
unsafe fn check(env: *mut JNIEnv, what: &str) -> Result<(), String> {
    let f = unsafe { &**env };
    if unsafe { (f.v1_6.ExceptionCheck)(env) } {
        unsafe { (f.v1_6.ExceptionClear)(env) };
        return Err(format!("{what} threw"));
    }
    Ok(())
}

/// Instance method `name` of the framework class `class`.
unsafe fn method(env: *mut JNIEnv, class: &CStr, name: &CStr, sig: &CStr) -> Result<jmethodID, String> {
    let f = unsafe { &**env };
    let c = unsafe { (f.v1_6.FindClass)(env, class.as_ptr()) };
    unsafe { check(env, &format!("{class:?}"))? };
    let id = unsafe { (f.v1_6.GetMethodID)(env, c, name.as_ptr(), sig.as_ptr()) };
    unsafe { check(env, &format!("{class:?}.{name:?}"))? };
    if id.is_null() { Err(format!("no {class:?}.{name:?}")) } else { Ok(id) }
}

unsafe fn object(env: *mut JNIEnv, this: jobject, id: jmethodID, args: &[jvalue], what: &str) -> Result<jobject, String> {
    let o = unsafe { ((**env).v1_6.CallObjectMethodA)(env, this, id, args.as_ptr()) };
    unsafe { check(env, what)? };
    if o.is_null() { Err(format!("{what}: null")) } else { Ok(o) }
}

unsafe fn read(env: *mut JNIEnv) -> Result<Display, String> {
    let f = unsafe { &**env };
    // The app (ActivityThread.currentApplication()), its DisplayManager, the default display.
    let thread = unsafe { (f.v1_6.FindClass)(env, c"android/app/ActivityThread".as_ptr()) };
    unsafe { check(env, "ActivityThread")? };
    let current = unsafe { (f.v1_6.GetStaticMethodID)(env, thread, c"currentApplication".as_ptr(), c"()Landroid/app/Application;".as_ptr()) };
    unsafe { check(env, "currentApplication")? };
    let app = unsafe { (f.v1_6.CallStaticObjectMethodA)(env, thread, current, ptr::null()) };
    unsafe { check(env, "currentApplication")? };
    if app.is_null() {
        return Err("no application yet".into());
    }
    let service = unsafe { method(env, c"android/content/Context", c"getSystemService", c"(Ljava/lang/String;)Ljava/lang/Object;")? };
    let name = unsafe { (f.v1_6.NewStringUTF)(env, c"display".as_ptr()) };
    let manager = unsafe { object(env, app, service, &[jvalue { l: name }], "getSystemService")? };
    let get_display = unsafe { method(env, c"android/hardware/display/DisplayManager", c"getDisplay", c"(I)Landroid/view/Display;")? };
    let display = unsafe { object(env, manager, get_display, &[jvalue { i: 0 }], "getDisplay")? };

    // The tallest picture of its modes (the short side: a screen held upright too).
    let modes_of = unsafe { method(env, c"android/view/Display", c"getSupportedModes", c"()[Landroid/view/Display$Mode;")? };
    let modes = unsafe { object(env, display, modes_of, &[], "getSupportedModes")? };
    let width = unsafe { method(env, c"android/view/Display$Mode", c"getPhysicalWidth", c"()I")? };
    let height = unsafe { method(env, c"android/view/Display$Mode", c"getPhysicalHeight", c"()I")? };
    let mut lines = 0;
    for i in 0..unsafe { (f.v1_6.GetArrayLength)(env, modes) } {
        let mode = unsafe { (f.v1_6.GetObjectArrayElement)(env, modes, i) };
        unsafe { check(env, "a mode")? };
        let w = unsafe { (f.v1_6.CallIntMethodA)(env, mode, width, ptr::null()) };
        let h = unsafe { (f.v1_6.CallIntMethodA)(env, mode, height, ptr::null()) };
        unsafe { check(env, "a mode's size")? };
        lines = lines.max(w.min(h));
        unsafe { (f.v1_6.DeleteLocalRef)(env, mode) };
    }

    // Its HDR types (none on a screen without HDR).
    let hdr_of = unsafe { method(env, c"android/view/Display", c"getHdrCapabilities", c"()Landroid/view/Display$HdrCapabilities;")? };
    let caps = unsafe { ((**env).v1_6.CallObjectMethodA)(env, display, hdr_of, ptr::null()) };
    unsafe { check(env, "getHdrCapabilities")? };
    let mut types: Vec<jint> = Vec::new();
    if !caps.is_null() {
        let types_of = unsafe { method(env, c"android/view/Display$HdrCapabilities", c"getSupportedHdrTypes", c"()[I")? };
        let array = unsafe { object(env, caps, types_of, &[], "getSupportedHdrTypes")? };
        let n = unsafe { (f.v1_6.GetArrayLength)(env, array) };
        types = vec![0; n.max(0) as usize];
        unsafe { (f.v1_6.GetIntArrayRegion)(env, array, 0, n, types.as_mut_ptr()) };
        unsafe { check(env, "the HDR types")? };
    }
    Ok(Display {
        lines: (lines > 0).then_some(lines as u32),
        hdr: Some(types.iter().any(|t| matches!(*t, HDR_TYPE_HDR10 | HDR_TYPE_HDR10_PLUS))),
        dolby_vision: Some(types.contains(&HDR_TYPE_DOLBY_VISION)),
    })
}
