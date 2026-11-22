//! One mpv player: its handle, the props the TSX view sets, and a thread that
//! turns mpv's events into the view's events (the same contract as NSH's
//! `<Video>`: `load`, `progress`, `buffer`, `end`, `error`, plus `tracks`).
//!
//! The views call it on the UI's thread, so nothing here waits for mpv's: props and commands
//! are mpv's asynchronous calls (`mpv_set_property_async`, `mpv_command_async`), answered on
//! the event thread. mpv's thread can be busy for long (a stream that does not come) and can
//! itself wait for the UI's (Android's TextureView takes its frames there): a call that waited
//! for it froze the app (an ANR on Back while the film waited for the stream).

use std::{
    collections::HashMap,
    ffi::{CStr, c_char, c_int, c_void},
    sync::{
        Arc, Mutex, OnceLock,
        atomic::{AtomicBool, AtomicU64, Ordering},
    },
    thread::JoinHandle,
    time::{Duration, Instant},
};

use serde_json::{Value, json};

use super::ffi::{self, Handle, Lib, cstr};
use reel_domain::subtitles::tracks;

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
    /// The view is gone or going (`Player::close`): mpv was told to stop, and nothing more reaches
    /// the view. The event thread reads on until mpv says the playback ended.
    closing: AtomicBool,
    /// When the view let go: what the end is timed from.
    let_go: OnceLock<Instant>,
    /// mpv is idle (no file), as it last said (`idle-active`).
    idle: AtomicBool,
    /// The end was counted (`super::ending`), once.
    counted: AtomicBool,
    /// Milliseconds between `progress` events.
    interval_ms: AtomicU64,
    /// The end was reached (mpv keeps the last frame: `keep-open`).
    at_end: AtomicBool,
    /// A wait of the player's own is on (`Player::own_wait`), not the stream's.
    own_wait: std::sync::Mutex<OwnWait>,
    /// The hook the view holds mpv in (`Player::hold_in`).
    hooks: Arc<Hooks>,
}

/// What the view does while mpv waits in its hook: called on the player's event thread with the
/// hook held, which mpv waits for until it is dropped.
pub type OnHook = Box<dyn Fn(HeldHook) + Send + Sync>;

/// The hook mpv waits in for the view, and whether mpv is still there to be let go.
struct Hooks {
    lib: &'static Lib,
    raw: Raw,
    state: std::sync::Mutex<HookState>,
    on_hook: std::sync::OnceLock<OnHook>,
}

#[derive(Default)]
struct HookState {
    /// mpv is gone or going (`Player`'s drop): no hook is continued any more.
    closed: bool,
    /// The hook mpv waits in: its turn (ours, one per time it runs) and mpv's id (the handler's,
    /// the same every time).
    held: Option<(u64, u64)>,
    turns: u64,
}

/// mpv waits in a hook until this is dropped (on any thread): exactly once per time the hook
/// runs, and never after the player is gone.
pub struct HeldHook {
    hooks: Arc<Hooks>,
    turn: u64,
}

impl Hooks {
    /// mpv runs the hook (`id`): held until the `HeldHook` goes. None once the player goes.
    fn hold(self: &Arc<Self>, id: u64) -> Option<HeldHook> {
        let mut s = self.state.lock().unwrap();
        if s.closed {
            return None;
        }
        // mpv waits in one hook at a time; one still held is let go first.
        if let Some((_, old)) = s.held.take() {
            self.go_on(old);
        }
        s.turns += 1;
        s.held = Some((s.turns, id));
        Some(HeldHook { hooks: self.clone(), turn: s.turns })
    }

    /// Lets mpv go on from the hook's `turn`, if mpv still waits in it.
    fn release(&self, turn: u64) {
        let mut s = self.state.lock().unwrap();
        if let Some((t, id)) = s.held
            && t == turn
        {
            s.held = None;
            if !s.closed {
                self.go_on(id);
            }
        }
    }

    /// The player goes: a hook held is let go now, and none is held from now on.
    fn close(&self) {
        let mut s = self.state.lock().unwrap();
        if let Some((_, id)) = s.held.take() {
            self.go_on(id);
        }
        s.closed = true;
    }

    fn go_on(&self, id: u64) {
        let r = unsafe { (self.lib.hook_continue)(self.raw.0, id) };
        if r < 0 {
            tracing::warn!("reel mpv: hook_continue: {}", ffi::error_text(self.lib, r));
        }
    }
}

impl Drop for HeldHook {
    fn drop(&mut self) {
        self.hooks.release(self.turn);
    }
}

/// How long a wait of the player's own (its video back after the background) is not reported as
/// buffering: longer, it is reported after all.
const OWN_WAIT: Duration = Duration::from_secs(8);

/// A wait the player makes itself: mpv seeks to bring its video back (the video track after
/// the background) and decodes from a keyframe, with what plays
/// already in its cache or on the disk. That is no wait for the stream, which `buffer` says.
#[derive(Default)]
struct OwnWait {
    until: Option<Instant>,
    /// mpv began the wait (seeking or paused for its cache) since it was announced.
    began: bool,
}

impl OwnWait {
    fn start(&mut self, now: Instant) {
        *self = OwnWait { until: Some(now + OWN_WAIT), began: false };
    }

    /// Whether mpv's wait now (`waiting`) is the player's own: hidden from the view. It ends once
    /// mpv waited and stopped, at a seek of the viewer's, or after `OWN_WAIT`.
    fn hides(&mut self, waiting: bool, now: Instant) -> bool {
        let Some(until) = self.until else { return false };
        if now >= until || (self.began && !waiting) {
            self.until = None;
            return false;
        }
        self.began |= waiting;
        true
    }
}

pub struct Player {
    lib: &'static Lib,
    raw: Raw,
    shared: Arc<Shared>,
    thread: Option<JoinHandle<()>>,
    src: String,
    /// A view that draws through a render context it makes on its first draw (macOS, Windows,
    /// Linux) holds
    /// `loadfile` until then: a file that opens at once (a saved film on disk) found no video
    /// output yet, and mpv played its sound only. None: load at once.
    gate: Option<Arc<LoadGate>>,
    /// The view's events (`load`, `error`…), for the gate's failure.
    emit: Emit,
}

/// Holds the file to load until the view can draw (`Player::hold_until_drawn`).
pub struct LoadGate {
    /// Where the view is and the file held, under one lock: a file set while the view opens or
    /// fails is never left waiting.
    state: std::sync::Mutex<Gate>,
    emit: Emit,
}

#[derive(Default)]
struct Gate {
    drawn: bool,
    /// The view could not make mpv's render context: nothing will load.
    failed: bool,
    pending: Option<String>,
}

impl LoadGate {
    fn new(emit: Emit) -> LoadGate {
        LoadGate { state: Default::default(), emit }
    }

    /// The view draws now: the file held, if any, loads.
    pub fn open(&self, lib: &'static Lib, raw: Raw) {
        let mut g = self.state.lock().unwrap();
        g.drawn = true;
        if let Some(src) = g.pending.take() {
            command(lib, raw, &["loadfile", &src, "replace"]);
        }
    }

    /// The view cannot draw (no render context, no device): the file held, and any later one,
    /// will never load. The player says so (`error`, code `view`) instead of waiting for the
    /// picture for ever.
    #[cfg_attr(target_os = "ios", allow(dead_code))]
    pub fn fail(&self) {
        let held = {
            let mut g = self.state.lock().unwrap();
            g.failed = true;
            g.pending.take()
        };
        if held.is_some() {
            (self.emit)("error", view_failed());
        }
    }

    /// The file held, if any, is not to load any more (the player stops).
    fn forget(&self) {
        self.state.lock().unwrap().pending = None;
    }

    /// Plays `src` when the view can: at once once it drew, after its first draw before, never
    /// when it failed (an error instead).
    fn load(&self, lib: &'static Lib, raw: Raw, src: String) {
        let mut g = self.state.lock().unwrap();
        if g.failed {
            drop(g);
            (self.emit)("error", view_failed());
        } else if g.drawn {
            command(lib, raw, &["loadfile", &src, "replace"]);
        } else {
            g.pending = Some(src);
        }
    }
}

/// The error a view that cannot draw gives: a code the UI words (`player.errors.view`), and the
/// words for a log.
fn view_failed() -> Value {
    json!({ "code": "view", "message": "the video view could not start" })
}

/// What a request sent to mpv waits for: its answer.
enum Pending {
    /// What was asked, for the log if mpv could not do it.
    Asked(String),
    /// Runs once mpv has done this request and every one before it (`Player::after_requests`).
    Then(Box<dyn FnOnce() + Send>),
}

/// The requests mpv has not answered yet, every player's, by their reply id, with the player's
/// handle (what a player leaves unanswered goes with it: `Player::drop`).
fn pending() -> &'static Mutex<HashMap<u64, (usize, Pending)>> {
    static PENDING: OnceLock<Mutex<HashMap<u64, (usize, Pending)>>> = OnceLock::new();
    PENDING.get_or_init(Default::default)
}

/// `n` reply ids of mpv's asynchronous requests, in a row, unique across the players.
fn reply_ids(n: u64) -> u64 {
    static NEXT: AtomicU64 = AtomicU64::new(1);
    NEXT.fetch_add(n, Ordering::Relaxed)
}

/// Sends a request mpv does on its own thread (`send` with the reply id): queued in order, never
/// waited for. Its answer comes to the event thread (`answered`).
fn request(lib: &Lib, raw: Raw, what: Pending, send: impl FnOnce(u64) -> c_int) {
    let id = reply_ids(1);
    pending().lock().unwrap().insert(id, (raw.0 as usize, what));
    let r = send(id);
    if r < 0 {
        let mut all = pending().lock().unwrap();
        match all.remove(&id) {
            Some((_, Pending::Asked(what))) => tracing::warn!("reel mpv: {what}: {}", ffi::error_text(lib, r)),
            // Never run before mpv is done with what came before: it runs when the player goes.
            Some(then @ (_, Pending::Then(_))) => {
                tracing::warn!("reel mpv: a request was not queued: {}", ffi::error_text(lib, r));
                all.insert(id, then);
            }
            None => {}
        }
    }
}

/// mpv answered request `id` (`error` < 0: it failed).
fn answered(lib: &Lib, id: u64, error: c_int) {
    let done = pending().lock().unwrap().remove(&id).map(|(_, p)| p);
    match done {
        Some(Pending::Then(then)) => then(),
        Some(Pending::Asked(what)) if error < 0 => tracing::warn!("reel mpv: {what}: {}", ffi::error_text(lib, error)),
        _ => {}
    }
}

/// Runs an mpv command (`args`) on mpv's thread, logging a failure.
pub fn command(lib: &'static Lib, raw: Raw, args: &[&str]) {
    let owned: Vec<_> = args.iter().map(|a| cstr(a)).collect();
    let mut ptrs: Vec<*const c_char> = owned.iter().map(|c| c.as_ptr()).collect();
    ptrs.push(std::ptr::null());
    // mpv copies the arguments before it returns.
    request(lib, raw, Pending::Asked(args.join(" ")), |id| unsafe { (lib.command_async)(raw.0, id, ptrs.as_mut_ptr()) });
}

/// Sets property `name` to `value` (text) on mpv's thread, logging a failure.
fn set_property(lib: &Lib, raw: Raw, name: &str, value: &str) {
    let (n, v) = (cstr(name), cstr(value));
    let mut text = v.as_ptr();
    request(lib, raw, Pending::Asked(format!("{name}={value}")), |id| unsafe {
        (lib.set_property_async)(raw.0, id, n.as_ptr(), ffi::FORMAT_STRING, (&mut text as *mut *const c_char).cast::<c_void>())
    });
}

const OBSERVED: [(&str, c_int); 10] = [
    // The byte of the file mpv has read to: with demuxer-cache-time, where bytes are in time.
    ("stream-pos", ffi::FORMAT_INT64),
    ("time-pos", ffi::FORMAT_DOUBLE),
    // Seconds of the film mpv holds in memory ahead of the picture (the scrubber shows them).
    ("demuxer-cache-time", ffi::FORMAT_DOUBLE),
    ("duration", ffi::FORMAT_DOUBLE),
    ("paused-for-cache", ffi::FORMAT_FLAG),
    // A seek waits for data too: the UI shows it as buffering.
    ("seeking", ffi::FORMAT_FLAG),
    ("track-list", ffi::FORMAT_STRING),
    ("eof-reached", ffi::FORMAT_FLAG),
    // What decodes the video ("videotoolbox", "mediacodec", "no": the CPU), for the log.
    ("hwdec-current", ffi::FORMAT_STRING),
    // No file: once the view went, the playback has ended (`Player::close`).
    ("idle-active", ffi::FORMAT_FLAG),
];

impl Player {
    /// A player drawing with `vo` ("libmpv": through a render context the
    /// view makes; "null" in tests).
    /// `platform`: options of the platform, over the common ones (Android's GPU context,
    /// decoder and audio output).
    pub fn new(lib: &'static Lib, vo: &str, platform: &[(&str, &str)], emit: Emit) -> Result<Player, String> {
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
            // Embedded subtitles sized from the picture, as the overlay's (5 % of its height), not
            // from the window: an iPad held upright shows a frame less than half as tall.
            ("sub-scale-with-window", "no"),
            ("sub-font-size", SUB_FONT_SIZE),
            // No track turned on by its default flag at load: the core picks (`subtitleTrack`).
            ("subs-fallback", "no"),
            ("audio-file-auto", "no"),
            ("cache", "yes"),
            // The engine keeps this much behind where the player reads (reel_domain::play::PLAYER_CACHE).
            ("demuxer-max-bytes", PLAYER_CACHE_OPTION),
        ];
        for (name, value) in options.into_iter().chain(platform.iter().copied()) {
            let r = unsafe { (lib.set_option_string)(handle, cstr(name).as_ptr(), cstr(value).as_ptr()) };
            if r < 0 {
                tracing::warn!("reel mpv: option {name}={value}: {}", ffi::error_text(lib, r));
            }
        }
        let r = unsafe { (lib.initialize)(handle) };
        if r < 0 {
            unsafe { (lib.terminate_destroy)(handle) };
            return Err(format!("mpv_initialize: {}", ffi::error_text(lib, r)));
        }
        // mpv's own warnings and errors in reel's log (logcat on Android, through tracing).
        unsafe { (lib.request_log_messages)(handle, cstr(LOG_LEVEL).as_ptr()) };
        for (i, (name, format)) in OBSERVED.iter().enumerate() {
            unsafe { (lib.observe_property)(handle, i as u64 + 1, cstr(name).as_ptr(), *format) };
        }
        let shared = Arc::new(Shared {
            stop: AtomicBool::new(false),
            closing: AtomicBool::new(false),
            let_go: OnceLock::new(),
            idle: AtomicBool::new(false),
            counted: AtomicBool::new(false),
            interval_ms: AtomicU64::new(250),
            at_end: AtomicBool::new(false),
            own_wait: Default::default(),
            hooks: Arc::new(Hooks { lib, raw, state: Default::default(), on_hook: std::sync::OnceLock::new() }),
        });
        let thread = {
            let shared = shared.clone();
            std::thread::Builder::new()
                .name("reel-mpv-events".into())
                .spawn({
                    let emit = emit.clone();
                    move || events(lib, raw, &shared, &emit)
                })
                .map_err(|e| e.to_string())?
        };
        super::ending::started();
        Ok(Player { lib, raw, shared, thread: Some(thread), src: String::new(), gate: None, emit })
    }

    pub fn raw(&self) -> Raw {
        self.raw
    }

    #[cfg_attr(not(target_os = "android"), allow(dead_code))]
    /// The window mpv draws into (`wid`; Android: a global reference to a Surface, 0: none).
    pub fn set_window(&self, wid: i64) {
        let (lib, raw) = (self.lib, self.raw);
        let mut wid = wid;
        request(lib, raw, Pending::Asked(format!("wid={wid}")), |id| unsafe {
            (lib.set_property_async)(raw.0, id, cstr("wid").as_ptr(), ffi::FORMAT_INT64, (&mut wid as *mut i64).cast())
        });
    }

    /// Runs `then` (on the event thread) once mpv has done every request sent before this:
    /// Android lets go of a Surface only once mpv no longer draws into it. If mpv never answers,
    /// it runs when the player has gone (`Drop`).
    #[cfg_attr(not(target_os = "android"), allow(dead_code))]
    pub fn after_requests(&self, then: impl FnOnce() + Send + 'static) {
        let (lib, raw) = (self.lib, self.raw);
        let args = [cstr("ignore")];
        let mut ptrs = [args[0].as_ptr(), std::ptr::null()];
        request(lib, raw, Pending::Then(Box::new(then)), |id| unsafe { (lib.command_async)(raw.0, id, ptrs.as_mut_ptr()) });
    }

    /// Stops the player and lets it go without waiting for mpv: its sound and its events stop
    /// now, and mpv is torn down on a thread of its own (that waits for mpv's thread, which may
    /// be waiting for a stream). For a view whose window mpv no longer uses (Android: it holds
    /// its own reference to the Surface; the desktops: the render context is freed first), or
    /// keeps until mpv is gone (iOS: `close_in_background_then`).
    #[cfg_attr(not(any(target_os = "macos", target_os = "android", windows, all(target_os = "linux", not(target_arch = "arm")))), allow(dead_code))]
    pub fn close_in_background(self) {
        self.close_in_background_then(|| {});
    }

    /// As `close_in_background`, and `gone` runs on that thread once mpv is destroyed: iOS keeps
    /// the layer mpv draws into until then. If no thread can be made, the player goes here and
    /// `gone` with it, without running.
    #[cfg_attr(not(any(target_os = "macos", target_os = "ios", windows, all(target_os = "linux", not(target_arch = "arm")))), allow(dead_code))]
    pub fn close_in_background_then(self, gone: impl FnOnce() + Send + 'static) {
        self.close();
        self.shared.stop.store(true, Ordering::Relaxed);
        let closing = std::thread::Builder::new().name("reel-mpv-close".into()).spawn(move || {
            drop(self);
            gone();
        });
        if let Err(e) = closing {
            // The player came back with the error and went on this thread.
            tracing::warn!("reel mpv: no thread to close the player on: {e}");
        }
    }

    /// What mpv waits for next (its video back after the background) is the player's own,
    /// with the film at hand: not reported as buffering (`OWN_WAIT`).
    #[cfg_attr(not(target_os = "ios"), allow(dead_code))]
    pub fn own_wait(&self) {
        self.shared.own_wait.lock().unwrap().start(Instant::now());
    }

    /// mpv waits in its hook `name` (e.g. `on_preloaded`) each time it runs, until the view lets
    /// it go: `on_hook` is called on the player's event thread with the hook held, and mpv goes on
    /// once that is dropped (on any thread). Once, before a file loads. The player going lets a
    /// held hook go itself.
    #[cfg_attr(not(target_os = "ios"), allow(dead_code))]
    pub fn hold_in(&self, name: &str, on_hook: OnHook) {
        if self.shared.hooks.on_hook.set(on_hook).is_err() {
            return;
        }
        let r = unsafe { (self.lib.hook_add)(self.raw.0, 0, cstr(name).as_ptr(), 0) };
        if r < 0 {
            tracing::warn!("reel mpv: hook {name}: {}", ffi::error_text(self.lib, r));
        }
    }

    #[cfg_attr(not(target_os = "android"), allow(dead_code))]
    /// A property by name (for the platform's view: `vo`, the surface size).
    pub fn set_property(&self, name: &str, value: &str) {
        self.set(name, value);
    }

    fn set(&self, name: &str, value: &str) {
        set_property(self.lib, self.raw, name, value);
    }

    fn command(&self, args: &[&str]) {
        command(self.lib, self.raw, args);
    }

    /// Files load only once the view draws (`LoadGate::open`).
    /// Android draws through its Surface (`wid`), which is there before a file loads.
    #[cfg_attr(not(any(target_os = "macos", all(target_os = "linux", not(target_arch = "arm")), windows)), allow(dead_code))]
    pub fn hold_until_drawn(&mut self) -> Arc<LoadGate> {
        let gate = Arc::new(LoadGate::new(self.emit.clone()));
        self.gate = Some(gate.clone());
        gate
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
                    if let Some(g) = &self.gate {
                        g.forget();
                    }
                    self.command(&["stop"]);
                } else {
                    let src = self.src.clone();
                    match &self.gate {
                        Some(g) => g.load(self.lib, self.raw, src),
                        None => self.command(&["loadfile", &src, "replace"]),
                    }
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
            // The subtitles mpv draws itself (embedded in the film) stay above the player's controls
            // while they show: how far from the view's bottom, as a share of the picture's height
            // (0: mpv's own margin). libass scales mpv's margins with the picture (pixels of a
            // 720-high picture), and measures this one from the view's bottom.
            "subtitleLift" => {
                let lift = value.and_then(Value::as_f64).unwrap_or(0.0).clamp(0.0, 4.0);
                self.set("sub-margin-y", &format!("{}", margin(lift, SUB_MARGIN_Y)));
            }
            // Their room at each side, as our overlay's (a share of the picture's height).
            "subtitleSides" => {
                let sides = value.and_then(Value::as_f64).unwrap_or(0.0).clamp(0.0, 2.0);
                self.set("sub-margin-x", &format!("{}", margin(sides, SUB_MARGIN_X)));
            }
            // Larger than their size for the picture (5 % of its height) where that is too
            // small to read: a phone held upright.
            "subtitleScale" => {
                let scale = value.and_then(Value::as_f64).unwrap_or(1.0).clamp(1.0, 3.0);
                self.set("sub-scale", &format!("{scale}"));
            }
            "rate" => self.set("speed", &format!("{}", value.and_then(Value::as_f64).unwrap_or(1.0))),
            "progressUpdateInterval" => {
                let ms = value.and_then(Value::as_f64).unwrap_or(250.0).max(16.0);
                self.shared.interval_ms.store(ms as u64, Ordering::Relaxed);
            }
            // The languages to start in ("ru,rus", the core's): mpv's choice at load, before the
            // core picks the track (`audioTrack`). Before `src` in the view's props; and loadfile
            // runs on mpv's thread, which picks the tracks only once the stream has opened.
            "audioLanguages" => self.set("alang", value.and_then(Value::as_str).unwrap_or("")),
            "audioTrack" => self.set("aid", &track_value(value)),
            "subtitleTrack" => self.set("sid", &track_value(value)),
            _ => {}
        }
    }

    /// The view is going (unmounted: NSH lets go of the native view only once its node is
    /// released, seconds later): mpv stops now, and nothing more reaches the view. The playback
    /// has ended once mpv says so (`events`), or when the player goes (`Drop`). Once.
    pub fn close(&self) {
        if self.shared.closing.swap(true, Ordering::SeqCst) {
            return;
        }
        self.shared.let_go.get_or_init(Instant::now);
        if let Some(g) = &self.gate {
            g.forget();
        }
        self.command(&["stop"]);
        // Nothing played (no file): nothing to end.
        if self.shared.idle.load(Ordering::SeqCst) {
            ended(&self.shared, "nothing played");
        }
    }

    /// `ref.command(name, args)`: `seek` `{ seconds }`; `close` (`Player::close`).
    pub fn run(&mut self, name: &str, args: &Value) {
        if name == "close" {
            self.close();
        } else if name == "seek" {
            let s = args.get("seconds").and_then(Value::as_f64).or_else(|| args.as_f64()).unwrap_or(0.0).max(0.0);
            self.shared.at_end.store(false, Ordering::Relaxed);
            // The viewer's seek waits for the stream: it shows.
            self.shared.own_wait.lock().unwrap().until = None;
            self.command(&["seek", &format!("{s}"), "absolute"]);
        }
    }
}

/// mpv's subtitle size: in pixels of a 720-high picture (`sub-scale-with-window=no`), 5 % of it.
const SUB_FONT_SIZE: &str = "36";
/// mpv's own subtitle margins (pixels of a 720-high picture): the least they are.
const SUB_MARGIN_Y: f64 = 22.0;
const SUB_MARGIN_X: f64 = 25.0;

/// A margin of mpv's from a share of the picture's height, no less than `least`.
fn margin(share: f64, least: f64) -> f64 {
    (share * 720.0).max(least).round()
}

/// A track prop: a track id, `"no"` (none), or null (mpv's own choice).
fn track_value(value: Option<&Value>) -> String {
    match value {
        Some(Value::Number(n)) => n.to_string(),
        Some(Value::String(s)) if s == "no" => "no".into(),
        _ => "auto".into(),
    }
}

/// The least of mpv's messages that reach reel's log ("warn"; `REEL_MPV_LOG` for more, e.g. "v").
const LOG_LEVEL: &str = match option_env!("REEL_MPV_LOG") {
    Some(level) => level,
    None => "warn",
};

/// `reel_domain::play::PLAYER_CACHE` as mpv's option value.
const PLAYER_CACHE_OPTION: &str = "64MiB";
const _: () = assert!(reel_domain::play::PLAYER_CACHE == 64 * 1024 * 1024, "keep PLAYER_CACHE_OPTION in step");

/// How long a player let go waits for mpv to end its playback before mpv is destroyed anyway:
/// a mpv that does not end (stuck in a read) must not hold the next film for long.
const ENDING_WAIT: Duration = Duration::from_secs(2);

/// The id `idle-active` is observed with while the player ends (past `OBSERVED`'s).
const IDLE_ACTIVE: u64 = 100;

impl Drop for Player {
    /// Ends the playback, then destroys mpv, in this order (`close_in_background` does it on a
    /// thread of its own): `stop`, a held hook let go, mpv's own word that the playback ended
    /// (the file's end after the stop, or idle; at most `ENDING_WAIT` after the view let go),
    /// then mpv destroyed. The sound stops because mpv has stopped.
    fn drop(&mut self) {
        self.close();
        let let_go = *self.shared.let_go.get_or_init(Instant::now);
        self.shared.stop.store(true, Ordering::SeqCst);
        // mpv waits in a hook until it is let go, even to stop.
        self.shared.hooks.close();
        unsafe { (self.lib.wakeup)(self.raw.0) };
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
        // Ended already when the view went (`close`, and mpv said so): only mpv goes now.
        let counted = self.shared.counted.load(Ordering::SeqCst);
        if !counted {
            self.wait_until_ended(let_go);
        }
        // What mpv has not answered (no answer is read any more), taken while the handle is
        // still this player's (a new player may get its address once it is freed).
        let handle = self.raw.0 as usize;
        let left: Vec<Pending> = {
            let mut all = pending().lock().unwrap();
            let ids: Vec<u64> = all.iter().filter(|(_, (h, _))| *h == handle).map(|(id, _)| *id).collect();
            ids.into_iter().filter_map(|id| all.remove(&id)).map(|(_, p)| p).collect()
        };
        unsafe { (self.lib.terminate_destroy)(self.raw.0) };
        tracing::warn!("reel mpv: destroyed {} ms after the view let go", let_go.elapsed().as_millis());
        // The next film starts now (`VideoEngine.ended`).
        if !counted && !self.shared.counted.swap(true, Ordering::SeqCst) {
            super::ending::ended();
        }
        // What waited for mpv runs now that it has gone.
        for p in left {
            if let Pending::Then(then) = p {
                then();
            }
        }
    }
}

impl Player {
    /// Reads mpv's events here (the event thread has gone) until mpv says its playback ended:
    /// the file's end after `stop` (or `quit`), or idle (no file). Answers to requests are
    /// handled on the way, in order. At most until `ENDING_WAIT` after `let_go`.
    fn wait_until_ended(&self, let_go: Instant) {
        let (lib, raw) = (self.lib, self.raw);
        unsafe { (lib.observe_property)(raw.0, IDLE_ACTIVE, cstr("idle-active").as_ptr(), ffi::FORMAT_FLAG) };
        let deadline = let_go + ENDING_WAIT;
        loop {
            let left = deadline.saturating_duration_since(Instant::now());
            if left.is_zero() {
                tracing::warn!("reel mpv: the playback had not ended {} ms after the view let go; mpv is destroyed anyway", let_go.elapsed().as_millis());
                return;
            }
            let event = unsafe { &*(lib.wait_event)(raw.0, left.as_secs_f64()) };
            let ended = match event.event_id {
                ffi::EVENT_SHUTDOWN => true,
                ffi::EVENT_END_FILE if !event.data.is_null() => {
                    let reason = unsafe { &*(event.data as *const ffi::EventEndFile) }.reason;
                    reason == ffi::END_FILE_REASON_STOP || reason == ffi::END_FILE_REASON_QUIT
                }
                ffi::EVENT_PROPERTY_CHANGE if event.reply_userdata == IDLE_ACTIVE && !event.data.is_null() => {
                    let p = unsafe { &*(event.data as *const ffi::EventProperty) };
                    p.format == ffi::FORMAT_FLAG && !p.data.is_null() && unsafe { *(p.data as *const c_int) } != 0
                }
                ffi::EVENT_SET_PROPERTY_REPLY | ffi::EVENT_COMMAND_REPLY => {
                    answered(lib, event.reply_userdata, event.error);
                    false
                }
                _ => false,
            };
            if ended {
                tracing::warn!("reel mpv: the playback ended {} ms after the view let go", let_go.elapsed().as_millis());
                return;
            }
        }
    }
}

/// The view went and mpv says its playback ended (`why`): counted once, and the next film may
/// start (`VideoEngine.ended`). mpv itself is destroyed when the player goes.
fn ended(shared: &Shared, why: &str) {
    if shared.counted.swap(true, Ordering::SeqCst) {
        return;
    }
    let after = shared.let_go.get().map_or(0, |t| t.elapsed().as_millis());
    tracing::warn!("reel mpv: the playback ended {after} ms after the view let go ({why})");
    super::ending::ended();
}

/// The event thread: until the player is dropped.
fn events(lib: &'static Lib, raw: Raw, shared: &Shared, emit: &Emit) {
    // Nothing more for the view once the player is closing (it may be gone already).
    let emit = |name: &str, data: Value| {
        if !shared.stop.load(Ordering::Relaxed) && !shared.closing.load(Ordering::SeqCst) {
            emit(name, data);
        }
    };
    let mut time = 0.0;
    let mut duration = 0.0;
    let mut cached_until = 0.0;
    let mut read_at: i64 = 0;
    let mut last_progress: Option<Instant> = None;
    let (mut buffering, mut cache_wait, mut seeking) = (false, false, false);
    // The video output failed (said once): mpv plays the sound on without a picture then.
    let mut no_picture = false;
    // The file's facts `load` reports, asked for when it loaded and on their way.
    let mut loading: Option<Loading> = None;
    loop {
        if shared.stop.load(Ordering::Relaxed) {
            return;
        }
        // Waiting for data (or a seek), unless the wait is the player's own (`OwnWait`): looked
        // at after every event and twice a second, so an own wait that lasts is told in time.
        let waiting = cache_wait || seeking;
        let now = waiting && !shared.own_wait.lock().unwrap().hides(waiting, Instant::now());
        if now != buffering {
            buffering = now;
            emit("buffer", json!({ "isBuffering": now }));
        }
        let event = unsafe { &*(lib.wait_event)(raw.0, 0.5) };
        match event.event_id {
            ffi::EVENT_NONE => {}
            ffi::EVENT_SHUTDOWN => return,
            ffi::EVENT_SET_PROPERTY_REPLY | ffi::EVENT_COMMAND_REPLY => answered(lib, event.reply_userdata, event.error),
            ffi::EVENT_LOG_MESSAGE if !event.data.is_null() => {
                let m = unsafe { &*(event.data as *const ffi::EventLogMessage) };
                let text = |p: *const c_char| if p.is_null() { String::new() } else { unsafe { CStr::from_ptr(p) }.to_string_lossy().trim_end().to_owned() };
                let line = text(m.text);
                tracing::warn!("mpv [{}] {}: {}", text(m.prefix), text(m.level), line);
                // Its video output could not start (no GPU context: Metal, Vulkan, a driver):
                // the view cannot show the film, which is an error, not sound alone.
                if !no_picture && (line.starts_with("Error opening/initializing the selected video_out") || line.starts_with("Failed initializing any suitable GPU context")) {
                    no_picture = true;
                    emit("error", json!({ "message": line, "code": "view" }));
                }
            }
            // A hook the view holds mpv in (`Player::hold_in`): mpv waits until it is let go.
            ffi::EVENT_HOOK if !event.data.is_null() => {
                let id = unsafe { &*(event.data as *const ffi::EventHook) }.id;
                if let Some(on_hook) = shared.hooks.on_hook.get()
                    && let Some(held) = shared.hooks.hold(id)
                {
                    on_hook(held);
                }
            }
            // Read without waiting for mpv's thread: it may never answer (Android: stuck in
            // FFmpeg's MediaCodec decoder, which retries for ever when the codec takes no input
            // and gives no frame), and an event thread that waited for it kept the player from
            // going (`Drop` waits for this thread).
            ffi::EVENT_FILE_LOADED => loading = Loading::ask(lib, raw),
            ffi::EVENT_GET_PROPERTY_REPLY if !event.data.is_null() => {
                let p = unsafe { &*(event.data as *const ffi::EventProperty) };
                let value = (event.error >= 0 && p.format == ffi::FORMAT_STRING && !p.data.is_null())
                    .then(|| unsafe { CStr::from_ptr(*(p.data as *const *const c_char)) }.to_string_lossy().parse::<f64>().ok())
                    .flatten();
                if let Some(facts) = loading.as_mut().and_then(|l| l.answer(event.reply_userdata, value)) {
                    loading = None;
                    duration = facts.duration.unwrap_or(duration);
                    let (width, height) = facts.picture;
                    emit("load", json!({ "duration": duration, "width": width, "height": height }));
                }
            }
            ffi::EVENT_END_FILE if !event.data.is_null() => {
                let end = unsafe { &*(event.data as *const ffi::EventEndFile) };
                if shared.closing.load(Ordering::SeqCst) && (end.reason == ffi::END_FILE_REASON_STOP || end.reason == ffi::END_FILE_REASON_QUIT) {
                    ended(shared, "the file's end");
                }
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
                            emit("progress", json!({ "currentTime": time, "duration": duration, "cached": (cached_until - time).max(0.0), "readAt": read_at, "readTime": cached_until }));
                        }
                    }
                    (b"stream-pos", ffi::FORMAT_INT64) => {
                        read_at = unsafe { *(p.data as *const i64) };
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
                    }
                    (b"eof-reached", ffi::FORMAT_FLAG) => {
                        if unsafe { *(p.data as *const c_int) } != 0 && !shared.at_end.swap(true, Ordering::Relaxed) {
                            emit("end", json!({}));
                        }
                    }
                    (b"idle-active", ffi::FORMAT_FLAG) => {
                        let idle = unsafe { *(p.data as *const c_int) } != 0;
                        shared.idle.store(idle, Ordering::SeqCst);
                        if idle && shared.closing.load(Ordering::SeqCst) {
                            ended(shared, "idle");
                        }
                    }
                    (b"hwdec-current", ffi::FORMAT_STRING) => {
                        let how = unsafe { CStr::from_ptr(*(p.data as *const *const c_char)) }.to_string_lossy();
                        tracing::warn!("reel mpv: decoding with {}", if how.is_empty() || how == "no" { "the CPU" } else { &how });
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

/// What `load` reports of a file that loaded, asked for with `mpv_get_property_async` (in this
/// order): its duration, the decoder's picture, and what the container says of the video track.
const LOAD_FACTS: [&str; 7] = [
    "duration",
    "dwidth",
    "dheight",
    "current-tracks/video/demux-w",
    "current-tracks/video/demux-h",
    "current-tracks/video/demux-par",
    "current-tracks/video/demux-rotation",
];

/// The answers to `LOAD_FACTS` as they come (mpv answers in order, on the event thread).
struct Loading {
    /// The reply id of the first; the others follow it.
    first: u64,
    values: [Option<f64>; LOAD_FACTS.len()],
    left: usize,
}

struct LoadFacts {
    duration: Option<f64>,
    /// The picture's size as shown (pixels; 0 × 0 when there is no video track): the decoder's
    /// once it has one, else what the container says of the video track (just loaded, nothing
    /// decoded yet), its pixel aspect and rotation applied.
    picture: (f64, f64),
}

impl Loading {
    /// Asks for the facts; None when mpv took no request (it is going).
    fn ask(lib: &Lib, raw: Raw) -> Option<Loading> {
        let first = reply_ids(LOAD_FACTS.len() as u64);
        for (i, name) in LOAD_FACTS.iter().enumerate() {
            if unsafe { (lib.get_property_async)(raw.0, first + i as u64, cstr(name).as_ptr(), ffi::FORMAT_STRING) } < 0 {
                return None;
            }
        }
        Some(Loading { first, values: [None; LOAD_FACTS.len()], left: LOAD_FACTS.len() })
    }

    /// The answer to request `id` (None: the property is not there, or not a number); the facts
    /// once the last has come.
    fn answer(&mut self, id: u64, value: Option<f64>) -> Option<LoadFacts> {
        let i = id.checked_sub(self.first).filter(|i| (*i as usize) < LOAD_FACTS.len())? as usize;
        self.values[i] = value;
        self.left = self.left.saturating_sub(1);
        if self.left > 0 {
            return None;
        }
        let v = |i: usize| self.values[i];
        let picture = match (v(1), v(2)) {
            (Some(w), Some(h)) if w > 0.0 && h > 0.0 => (w, h),
            _ => reel_domain::play::shown_size(v(3).unwrap_or(0.0), v(4).unwrap_or(0.0), v(5).unwrap_or(0.0), v(6).unwrap_or(0.0)),
        };
        Some(LoadFacts { duration: v(0), picture })
    }
}

/// A property's value as text (None: unavailable; a list or map is JSON), from any thread: the
/// view reads the tracks while mpv waits in its hook. It waits for mpv's thread: never on the
/// event thread outside a hook (`Loading`).
#[cfg_attr(not(target_os = "ios"), allow(dead_code))]
pub fn property(lib: &Lib, raw: Raw, name: &str) -> Option<String> {
    let p = unsafe { (lib.get_property_string)(raw.0, cstr(name).as_ptr()) };
    if p.is_null() {
        return None;
    }
    let v = unsafe { CStr::from_ptr(p) }.to_string_lossy().into_owned();
    unsafe { (lib.free)(p.cast()) };
    Some(v)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_own_wait_is_hidden_until_it_is_over() {
        let now = Instant::now();
        let mut w = OwnWait::default();
        assert!(!w.hides(true, now), "no own wait: mpv's waits show");
        w.start(now);
        assert!(w.hides(false, now), "announced, before mpv waits");
        assert!(w.hides(true, now + Duration::from_secs(1)), "mpv seeks to bring its video back");
        assert!(!w.hides(false, now + Duration::from_secs(2)), "the wait is over");
        assert!(!w.hides(true, now + Duration::from_secs(3)), "a later wait is the stream's");
    }

    #[test]
    fn a_loaded_files_facts_come_once_all_are_answered() {
        let mut l = Loading { first: 40, values: [None; LOAD_FACTS.len()], left: LOAD_FACTS.len() };
        assert!(l.answer(39, Some(1.0)).is_none(), "another request's answer");
        // Nothing decoded yet: the container's 1920×800, square pixels, not rotated.
        let answers = [Some(5400.0), None, None, Some(1920.0), Some(800.0), Some(1.0), Some(0.0)];
        for (i, v) in answers.iter().enumerate().take(6) {
            assert!(l.answer(40 + i as u64, *v).is_none(), "{} answered, not all", i + 1);
        }
        let facts = l.answer(46, answers[6]).expect("all answered");
        assert_eq!(facts.duration, Some(5400.0));
        assert_eq!(facts.picture, (1920.0, 800.0));
        // The decoder's picture wins once it has one.
        let mut l = Loading { first: 1, values: [None; LOAD_FACTS.len()], left: LOAD_FACTS.len() };
        let answers = [None, Some(1280.0), Some(720.0), Some(1920.0), Some(1080.0), Some(1.0), Some(0.0)];
        let facts = answers.iter().enumerate().filter_map(|(i, v)| l.answer(1 + i as u64, *v)).last().unwrap();
        assert_eq!((facts.duration, facts.picture), (None, (1280.0, 720.0)));
    }

    #[test]
    fn an_own_wait_that_lasts_is_told_after_all() {
        let now = Instant::now();
        let mut w = OwnWait::default();
        w.start(now);
        assert!(w.hides(true, now + Duration::from_secs(1)));
        assert!(!w.hides(true, now + OWN_WAIT), "still waiting after OWN_WAIT: buffering after all");
    }
}
