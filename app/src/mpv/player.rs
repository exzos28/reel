//! One mpv player: its handle, the props the TSX view sets, and a thread that
//! turns mpv's events into the view's events (the same contract as NSH's
//! `<Video>`: `load`, `progress`, `buffer`, `end`, `error`, plus `tracks`).

use std::{
    ffi::{CStr, c_char, c_int},
    sync::{
        Arc,
        atomic::{AtomicBool, AtomicU64, Ordering},
    },
    thread::JoinHandle,
    time::{Duration, Instant},
};

use serde_json::{Value, json};

use super::ffi::{self, Handle, Lib, cstr};
use crate::subtitles::tracks;

/// Where events go: (name, payload). Called on the player's event thread.
pub type Emit = Arc<dyn Fn(&str, Value) + Send + Sync>;

/// The raw handle, used from the event thread and the view (libmpv's client
/// API is thread-safe).
#[derive(Clone, Copy)]
pub struct Raw(pub Handle);
unsafe impl Send for Raw {}
unsafe impl Sync for Raw {}

struct Shared {
    stop: AtomicBool,
    /// Milliseconds between `progress` events.
    interval_ms: AtomicU64,
    /// The end was reached (mpv keeps the last frame: `keep-open`).
    at_end: AtomicBool,
}

pub struct Player {
    lib: &'static Lib,
    raw: Raw,
    shared: Arc<Shared>,
    thread: Option<JoinHandle<()>>,
    src: String,
}

const OBSERVED: [(&str, c_int); 7] = [
    ("time-pos", ffi::FORMAT_DOUBLE),
    // Seconds of the film mpv holds in memory ahead of the picture (the scrubber shows them).
    ("demuxer-cache-time", ffi::FORMAT_DOUBLE),
    ("duration", ffi::FORMAT_DOUBLE),
    ("paused-for-cache", ffi::FORMAT_FLAG),
    // A seek waits for data too: the UI shows it as buffering.
    ("seeking", ffi::FORMAT_FLAG),
    ("track-list", ffi::FORMAT_STRING),
    ("eof-reached", ffi::FORMAT_FLAG),
];

impl Player {
    /// A player drawing with `vo` ("libmpv": through a render context the
    /// view makes; "null" in tests).
    pub fn new(lib: &'static Lib, vo: &str, emit: Emit) -> Result<Player, String> {
        let handle = unsafe { (lib.create)() };
        if handle.is_null() {
            return Err("mpv_create failed".into());
        }
        let raw = Raw(handle);
        let options = [
            ("vo", vo),
            ("config", "no"),
            ("load-scripts", "no"),
            ("ytdl", "no"),
            ("terminal", "no"),
            ("idle", "yes"),
            ("keep-open", "yes"),
            ("input-default-bindings", "no"),
            ("input-vo-keyboard", "no"),
            ("osc", "no"),
            ("hwdec", "auto-safe"),
            // Subtitle files of the torrent are reel's (the overlay); mpv shows only embedded ones.
            ("sub-auto", "no"),
            ("audio-file-auto", "no"),
            ("cache", "yes"),
            // The engine keeps this much behind where the player reads (buffer::PLAYER_CACHE).
            ("demuxer-max-bytes", PLAYER_CACHE_OPTION),
        ];
        for (name, value) in options {
            let r = unsafe { (lib.set_option_string)(handle, cstr(name).as_ptr(), cstr(value).as_ptr()) };
            if r < 0 {
                eprintln!("reel mpv: option {name}={value}: {}", ffi::error_text(lib, r));
            }
        }
        let r = unsafe { (lib.initialize)(handle) };
        if r < 0 {
            unsafe { (lib.terminate_destroy)(handle) };
            return Err(format!("mpv_initialize: {}", ffi::error_text(lib, r)));
        }
        for (i, (name, format)) in OBSERVED.iter().enumerate() {
            unsafe { (lib.observe_property)(handle, i as u64 + 1, cstr(name).as_ptr(), *format) };
        }
        let shared = Arc::new(Shared { stop: AtomicBool::new(false), interval_ms: AtomicU64::new(250), at_end: AtomicBool::new(false) });
        let thread = {
            let shared = shared.clone();
            std::thread::Builder::new()
                .name("reel-mpv-events".into())
                .spawn(move || events(lib, raw, &shared, &emit))
                .map_err(|e| e.to_string())?
        };
        Ok(Player { lib, raw, shared, thread: Some(thread), src: String::new() })
    }

    pub fn raw(&self) -> Raw {
        self.raw
    }

    fn set(&self, name: &str, value: &str) {
        let r = unsafe { (self.lib.set_property_string)(self.raw.0, cstr(name).as_ptr(), cstr(value).as_ptr()) };
        if r < 0 {
            eprintln!("reel mpv: {name}={value}: {}", ffi::error_text(self.lib, r));
        }
    }

    fn command(&self, args: &[&str]) {
        let owned: Vec<_> = args.iter().map(|a| cstr(a)).collect();
        let mut ptrs: Vec<*const c_char> = owned.iter().map(|c| c.as_ptr()).collect();
        ptrs.push(std::ptr::null());
        let r = unsafe { (self.lib.command)(self.raw.0, ptrs.as_mut_ptr()) };
        if r < 0 {
            eprintln!("reel mpv: {}: {}", args.join(" "), ffi::error_text(self.lib, r));
        }
    }

    /// A prop of the TSX view changed (`None`: removed).
    pub fn set_prop(&mut self, name: &str, value: Option<&Value>) {
        match name {
            "src" => {
                let src = value.and_then(Value::as_str).unwrap_or("").to_owned();
                if src == self.src {
                    return;
                }
                self.src = src;
                self.shared.at_end.store(false, Ordering::Relaxed);
                if self.src.is_empty() {
                    self.command(&["stop"]);
                } else {
                    let src = self.src.clone();
                    self.command(&["loadfile", &src, "replace"]);
                }
            }
            "paused" => {
                let paused = value.and_then(Value::as_bool).unwrap_or(false);
                // As `<Video>`: playing again after the end starts over.
                if !paused && self.shared.at_end.swap(false, Ordering::Relaxed) {
                    self.command(&["seek", "0", "absolute"]);
                }
                self.set("pause", if paused { "yes" } else { "no" });
            }
            "muted" => self.set("mute", if value.and_then(Value::as_bool).unwrap_or(false) { "yes" } else { "no" }),
            "volume" => {
                let v = value.and_then(Value::as_f64).unwrap_or(1.0).clamp(0.0, 1.0);
                self.set("volume", &format!("{}", v * 100.0));
            }
            "rate" => self.set("speed", &format!("{}", value.and_then(Value::as_f64).unwrap_or(1.0))),
            "progressUpdateInterval" => {
                let ms = value.and_then(Value::as_f64).unwrap_or(250.0).max(16.0);
                self.shared.interval_ms.store(ms as u64, Ordering::Relaxed);
            }
            "audioTrack" => self.set("aid", &track_value(value)),
            "subtitleTrack" => self.set("sid", &track_value(value)),
            _ => {}
        }
    }

    /// `ref.command(name, args)`: `seek` `{ seconds }`.
    pub fn run(&mut self, name: &str, args: &Value) {
        if name == "seek" {
            let s = args.get("seconds").and_then(Value::as_f64).or_else(|| args.as_f64()).unwrap_or(0.0).max(0.0);
            self.shared.at_end.store(false, Ordering::Relaxed);
            self.command(&["seek", &format!("{s}"), "absolute"]);
        }
    }
}

/// A track prop: a track id, `"no"` (none), or null (mpv's own choice).
fn track_value(value: Option<&Value>) -> String {
    match value {
        Some(Value::Number(n)) => n.to_string(),
        Some(Value::String(s)) if s == "no" => "no".into(),
        _ => "auto".into(),
    }
}

/// `buffer::PLAYER_CACHE` as mpv's option value.
const PLAYER_CACHE_OPTION: &str = "64MiB";
const _: () = assert!(crate::buffer::PLAYER_CACHE == 64 * 1024 * 1024, "keep PLAYER_CACHE_OPTION in step");

impl Drop for Player {
    fn drop(&mut self) {
        // Silence first: tearing mpv down takes a moment, and it would play what it has
        // buffered meanwhile (the viewer has already left the player).
        self.command(&["stop"]);
        self.shared.stop.store(true, Ordering::Relaxed);
        unsafe { (self.lib.wakeup)(self.raw.0) };
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
        unsafe { (self.lib.terminate_destroy)(self.raw.0) };
    }
}

/// The event thread: until the player is dropped.
fn events(lib: &'static Lib, raw: Raw, shared: &Shared, emit: &Emit) {
    let mut time = 0.0;
    let mut duration = 0.0;
    let mut cached_until = 0.0;
    let mut last_progress: Option<Instant> = None;
    let (mut buffering, mut cache_wait, mut seeking) = (false, false, false);
    loop {
        if shared.stop.load(Ordering::Relaxed) {
            return;
        }
        let event = unsafe { &*(lib.wait_event)(raw.0, 0.5) };
        match event.event_id {
            ffi::EVENT_NONE => {}
            ffi::EVENT_SHUTDOWN => return,
            ffi::EVENT_FILE_LOADED => {
                duration = get_f64(lib, raw, "duration").unwrap_or(duration);
                emit("load", json!({ "duration": duration }));
            }
            ffi::EVENT_END_FILE if !event.data.is_null() => {
                let end = unsafe { &*(event.data as *const ffi::EventEndFile) };
                if end.reason == ffi::END_FILE_REASON_ERROR {
                    emit("error", json!({ "message": ffi::error_text(lib, end.error) }));
                } else if end.reason == ffi::END_FILE_REASON_EOF && !shared.at_end.swap(true, Ordering::Relaxed) {
                    emit("end", json!({}));
                }
            }
            ffi::EVENT_PROPERTY_CHANGE if !event.data.is_null() => {
                let p = unsafe { &*(event.data as *const ffi::EventProperty) };
                if p.data.is_null() {
                    continue; // unavailable (no file)
                }
                let name = unsafe { CStr::from_ptr(p.name) }.to_bytes();
                match (name, p.format) {
                    (b"time-pos", ffi::FORMAT_DOUBLE) => {
                        time = unsafe { *(p.data as *const f64) };
                        let every = Duration::from_millis(shared.interval_ms.load(Ordering::Relaxed));
                        if last_progress.is_none_or(|t| t.elapsed() >= every) {
                            last_progress = Some(Instant::now());
                            emit("progress", json!({ "currentTime": time, "duration": duration, "cached": (cached_until - time).max(0.0) }));
                        }
                    }
                    (b"demuxer-cache-time", ffi::FORMAT_DOUBLE) => {
                        cached_until = unsafe { *(p.data as *const f64) };
                    }
                    (b"duration", ffi::FORMAT_DOUBLE) => {
                        duration = unsafe { *(p.data as *const f64) };
                        emit("progress", json!({ "currentTime": time, "duration": duration }));
                    }
                    (b"paused-for-cache" | b"seeking", ffi::FORMAT_FLAG) => {
                        let on = unsafe { *(p.data as *const c_int) } != 0;
                        if name == b"seeking" {
                            seeking = on;
                        } else {
                            cache_wait = on;
                        }
                        let now = cache_wait || seeking;
                        if now != buffering {
                            buffering = now;
                            emit("buffer", json!({ "isBuffering": now }));
                        }
                    }
                    (b"eof-reached", ffi::FORMAT_FLAG) => {
                        if unsafe { *(p.data as *const c_int) } != 0 && !shared.at_end.swap(true, Ordering::Relaxed) {
                            emit("end", json!({}));
                        }
                    }
                    (b"track-list", ffi::FORMAT_STRING) => {
                        let list = unsafe { CStr::from_ptr(*(p.data as *const *const c_char)) }.to_string_lossy();
                        if let Some(t) = tracks::from_mpv(&list) {
                            emit("tracks", serde_json::to_value(t).unwrap_or(Value::Null));
                        }
                    }
                    _ => {}
                }
            }
            _ => {}
        }
    }
}

fn get_f64(lib: &Lib, raw: Raw, name: &str) -> Option<f64> {
    let p = unsafe { (lib.get_property_string)(raw.0, cstr(name).as_ptr()) };
    if p.is_null() {
        return None;
    }
    let v = unsafe { CStr::from_ptr(p) }.to_str().ok().and_then(|s| s.parse().ok());
    unsafe { (lib.free)(p.cast()) };
    v
}
