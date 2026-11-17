//! libmpv's client and render API, loaded at run time (`dlopen`): the app
//! builds and runs without it, and uses the native `<Video>` where it is not
//! found. Where it is looked for: `REEL_LIBMPV` (a path), the app bundle's
//! `Contents/Frameworks` (what `scripts/libmpv.sh bundle-macos` puts there), then
//! Homebrew's and /usr/local's lib directories.

use std::{
    ffi::{CStr, CString, c_char, c_double, c_int, c_void},
    path::PathBuf,
    sync::OnceLock,
};

pub type Handle = *mut c_void;
pub type RenderContext = *mut c_void;

pub const FORMAT_STRING: c_int = 1;
pub const FORMAT_FLAG: c_int = 3;
pub const FORMAT_INT64: c_int = 4;
pub const FORMAT_DOUBLE: c_int = 5;

pub const EVENT_NONE: c_int = 0;
pub const EVENT_SHUTDOWN: c_int = 1;
pub const EVENT_LOG_MESSAGE: c_int = 2;
pub const EVENT_END_FILE: c_int = 7;
pub const EVENT_FILE_LOADED: c_int = 8;
pub const EVENT_PROPERTY_CHANGE: c_int = 22;

pub const END_FILE_REASON_EOF: c_int = 0;
pub const END_FILE_REASON_ERROR: c_int = 4;

pub const RENDER_PARAM_INVALID: c_int = 0;
pub const RENDER_PARAM_API_TYPE: c_int = 1;
pub const RENDER_PARAM_OPENGL_INIT_PARAMS: c_int = 2;
pub const RENDER_PARAM_OPENGL_FBO: c_int = 3;
pub const RENDER_PARAM_FLIP_Y: c_int = 4;

#[repr(C)]
pub struct Event {
    pub event_id: c_int,
    pub error: c_int,
    pub reply_userdata: u64,
    pub data: *mut c_void,
}

#[repr(C)]
pub struct EventProperty {
    pub name: *const c_char,
    pub format: c_int,
    pub data: *mut c_void,
}

/// mpv's own log line (`mpv_request_log_messages`).
#[repr(C)]
pub struct EventLogMessage {
    pub prefix: *const c_char,
    pub level: *const c_char,
    pub text: *const c_char,
    pub log_level: c_int,
}

#[repr(C)]
pub struct EventEndFile {
    pub reason: c_int,
    pub error: c_int,
}

#[repr(C)]
pub struct RenderParam {
    pub kind: c_int,
    pub data: *mut c_void,
}

#[repr(C)]
pub struct OpenGlInitParams {
    pub get_proc_address: unsafe extern "C" fn(ctx: *mut c_void, name: *const c_char) -> *mut c_void,
    pub get_proc_address_ctx: *mut c_void,
}

#[repr(C)]
pub struct OpenGlFbo {
    pub fbo: c_int,
    pub w: c_int,
    pub h: c_int,
    pub internal_format: c_int,
}

/// The functions reel uses.
#[allow(clippy::type_complexity)]
pub struct Lib {
    pub create: unsafe extern "C" fn() -> Handle,
    pub initialize: unsafe extern "C" fn(Handle) -> c_int,
    pub terminate_destroy: unsafe extern "C" fn(Handle),
    pub set_option_string: unsafe extern "C" fn(Handle, *const c_char, *const c_char) -> c_int,
    #[cfg_attr(not(target_os = "android"), allow(dead_code))]
    pub set_option: unsafe extern "C" fn(Handle, *const c_char, c_int, *mut c_void) -> c_int,
    pub set_property_string: unsafe extern "C" fn(Handle, *const c_char, *const c_char) -> c_int,
    pub get_property_string: unsafe extern "C" fn(Handle, *const c_char) -> *mut c_char,
    pub command: unsafe extern "C" fn(Handle, *mut *const c_char) -> c_int,
    pub observe_property: unsafe extern "C" fn(Handle, u64, *const c_char, c_int) -> c_int,
    pub request_log_messages: unsafe extern "C" fn(Handle, *const c_char) -> c_int,
    pub wait_event: unsafe extern "C" fn(Handle, c_double) -> *mut Event,
    pub wakeup: unsafe extern "C" fn(Handle),
    pub free: unsafe extern "C" fn(*mut c_void),
    pub error_string: unsafe extern "C" fn(c_int) -> *const c_char,
    pub render_context_create: unsafe extern "C" fn(*mut RenderContext, Handle, *mut RenderParam) -> c_int,
    pub render_context_set_update_callback:
        unsafe extern "C" fn(RenderContext, Option<unsafe extern "C" fn(*mut c_void)>, *mut c_void),
    pub render_context_update: unsafe extern "C" fn(RenderContext) -> u64,
    pub render_context_render: unsafe extern "C" fn(RenderContext, *mut RenderParam) -> c_int,
    pub render_context_report_swap: unsafe extern "C" fn(RenderContext),
    pub render_context_free: unsafe extern "C" fn(RenderContext),
}

// Function pointers into a library that is never unloaded.
unsafe impl Send for Lib {}
unsafe impl Sync for Lib {}

fn candidates() -> Vec<PathBuf> {
    let mut out = Vec::new();
    // Android: in the APK's native libraries (scripts/android-views.sh), found by name.
    if cfg!(target_os = "android") {
        out.push("libmpv.so".into());
        return out;
    }
    if let Some(p) = std::env::var_os("REEL_LIBMPV") {
        out.push(PathBuf::from(p));
    }
    if let Some(dir) = std::env::current_exe().ok().and_then(|e| e.parent().map(|p| p.join("../Frameworks"))) {
        out.push(dir.join("libmpv.2.dylib"));
        out.push(dir.join("Libmpv.framework/Libmpv"));
    }
    out.push("/opt/homebrew/lib/libmpv.2.dylib".into());
    out.push("/usr/local/lib/libmpv.2.dylib".into());
    out
}

/// libmpv, loaded once; None when it is not found (logged once).
pub fn lib() -> Option<&'static Lib> {
    static LIB: OnceLock<Option<Lib>> = OnceLock::new();
    LIB.get_or_init(|| {
        for path in candidates() {
            if path.is_absolute() && !path.exists() {
                continue;
            }
            match unsafe { load(&path) } {
                Ok(lib) => {
                    tracing::warn!("reel mpv: using {}", path.display());
                    return Some(lib);
                }
                Err(e) => tracing::warn!("reel mpv: {}: {e}", path.display()),
            }
        }
        None
    })
    .as_ref()
}

unsafe fn load(path: &std::path::Path) -> Result<Lib, String> {
    let c = CString::new(path.as_os_str().as_encoded_bytes()).map_err(|e| e.to_string())?;
    let handle = unsafe { libc::dlopen(c.as_ptr(), libc::RTLD_NOW | libc::RTLD_LOCAL) };
    if handle.is_null() {
        let err = unsafe { libc::dlerror() };
        return Err(if err.is_null() { "dlopen failed".into() } else { unsafe { CStr::from_ptr(err) }.to_string_lossy().into_owned() });
    }
    macro_rules! sym {
        ($name:literal) => {{
            let p = unsafe { libc::dlsym(handle, concat!($name, "\0").as_ptr().cast()) };
            if p.is_null() {
                return Err(format!("{} is missing", $name));
            }
            unsafe { std::mem::transmute::<*mut c_void, _>(p) }
        }};
    }
    Ok(Lib {
        create: sym!("mpv_create"),
        initialize: sym!("mpv_initialize"),
        terminate_destroy: sym!("mpv_terminate_destroy"),
        set_option_string: sym!("mpv_set_option_string"),
        set_option: sym!("mpv_set_option"),
        set_property_string: sym!("mpv_set_property_string"),
        get_property_string: sym!("mpv_get_property_string"),
        command: sym!("mpv_command"),
        observe_property: sym!("mpv_observe_property"),
        request_log_messages: sym!("mpv_request_log_messages"),
        wait_event: sym!("mpv_wait_event"),
        wakeup: sym!("mpv_wakeup"),
        free: sym!("mpv_free"),
        error_string: sym!("mpv_error_string"),
        render_context_create: sym!("mpv_render_context_create"),
        render_context_set_update_callback: sym!("mpv_render_context_set_update_callback"),
        render_context_update: sym!("mpv_render_context_update"),
        render_context_render: sym!("mpv_render_context_render"),
        render_context_report_swap: sym!("mpv_render_context_report_swap"),
        render_context_free: sym!("mpv_render_context_free"),
    })
}

/// A C string for a call (names and values are ours: no NULs).
pub fn cstr(s: &str) -> CString {
    CString::new(s.replace('\0', "")).expect("no NUL")
}

/// An mpv error code as text.
pub fn error_text(lib: &Lib, code: c_int) -> String {
    let p = unsafe { (lib.error_string)(code) };
    if p.is_null() { format!("mpv error {code}") } else { unsafe { CStr::from_ptr(p) }.to_string_lossy().into_owned() }
}
