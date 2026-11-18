//! The mpv video view on Linux: a `gtk::GLArea` (NSH's Linux platform is GTK 4, which embeds no
//! foreign X11 window, so mpv cannot draw on its own through `wid`). mpv draws each frame into
//! the area's framebuffer through its render API, as on macOS; this works under X11 and
//! Wayland alike. mpv says a frame is ready from its own thread; the area redraws on GTK's.

use std::{
    cell::{Cell, RefCell},
    ffi::{c_int, c_void},
    rc::Rc,
    sync::{Arc, OnceLock},
};

use gtk4::{GLArea, glib, prelude::*};
use nsh_platform_linux::{ComponentContext, NativeComponent};
use serde_json::Value;

use super::{
    ffi::{self, Lib},
    player::{FAILED_VIEW, LoadGate, Player, Raw},
};

/// GL's functions for mpv: EGL's lookup (GTK 4 draws with EGL on X11 and Wayland), else GLX's.
fn lookup() -> Option<unsafe extern "C" fn(*const std::ffi::c_char) -> *mut c_void> {
    struct Found(Option<unsafe extern "C" fn(*const std::ffi::c_char) -> *mut c_void>);
    unsafe impl Send for Found {}
    unsafe impl Sync for Found {}
    static FOUND: OnceLock<Found> = OnceLock::new();
    FOUND
        .get_or_init(|| unsafe {
            for (lib, name) in [(c"libEGL.so.1", c"eglGetProcAddress"), (c"libGL.so.1", c"glXGetProcAddressARB")] {
                let handle = libc::dlopen(lib.as_ptr(), libc::RTLD_NOW | libc::RTLD_GLOBAL);
                if handle.is_null() {
                    continue;
                }
                let sym = libc::dlsym(handle, name.as_ptr());
                if !sym.is_null() {
                    return Found(Some(std::mem::transmute::<*mut c_void, _>(sym)));
                }
            }
            Found(None)
        })
        .0
}

unsafe extern "C" fn get_proc_address(_ctx: *mut c_void, name: *const std::ffi::c_char) -> *mut c_void {
    match lookup() {
        Some(get) => unsafe { get(name) },
        None => std::ptr::null_mut(),
    }
}

type GetIntegerv = unsafe extern "C" fn(u32, *mut c_int);
const GL_DRAW_FRAMEBUFFER_BINDING: u32 = 0x8CA6;

/// What the area's signals share.
struct State {
    lib: &'static Lib,
    raw: Raw,
    /// mpv's render context, made in the area's GL context once it is realized.
    render: RefCell<Option<ffi::RenderContext>>,
    closed: Cell<bool>,
    /// The player's file waits for the render context (made once the area is realized).
    gate: RefCell<Option<Arc<LoadGate>>>,
    /// For mpv's update callback: the area, reachable from mpv's thread. Boxed so its address
    /// (the callback's argument) stays put.
    area: Box<glib::SendWeakRef<GLArea>>,
}

/// mpv's thread: a frame is ready; the area redraws on GTK's thread.
unsafe extern "C" fn on_update(area: *mut c_void) {
    let area = unsafe { &*(area as *const glib::SendWeakRef<GLArea>) }.clone();
    glib::idle_add_once(move || {
        if let Some(a) = area.upgrade() {
            a.queue_render();
        }
    });
}

impl State {
    /// The area's GL context is there: mpv's render context in it.
    fn realize(&self, area: &GLArea) {
        if self.closed.get() || self.render.borrow().is_some() {
            return;
        }
        area.make_current();
        if area.error().is_some() {
            tracing::warn!("reel mpv: no GL context for the video");
            if let Some(gate) = self.gate.borrow_mut().take() {
                gate.fail(FAILED_VIEW);
            }
            return;
        }
        let mut init = ffi::OpenGlInitParams { get_proc_address, get_proc_address_ctx: std::ptr::null_mut() };
        let api = ffi::cstr("opengl");
        let mut params = [
            ffi::RenderParam { kind: ffi::RENDER_PARAM_API_TYPE, data: api.as_ptr() as *mut c_void },
            ffi::RenderParam { kind: ffi::RENDER_PARAM_OPENGL_INIT_PARAMS, data: (&mut init as *mut ffi::OpenGlInitParams).cast() },
            ffi::RenderParam { kind: ffi::RENDER_PARAM_INVALID, data: std::ptr::null_mut() },
        ];
        let mut made: ffi::RenderContext = std::ptr::null_mut();
        let r = unsafe { (self.lib.render_context_create)(&mut made, self.raw.0, params.as_mut_ptr()) };
        if r < 0 {
            tracing::warn!("reel mpv: render context: {}", ffi::error_text(self.lib, r));
            if let Some(gate) = self.gate.borrow_mut().take() {
                gate.fail(FAILED_VIEW);
            }
            return;
        }
        let arg = &*self.area as *const glib::SendWeakRef<GLArea> as *mut c_void;
        unsafe { (self.lib.render_context_set_update_callback)(made, Some(on_update), arg) };
        *self.render.borrow_mut() = Some(made);
        // mpv has a video output now: the file held until this loads.
        if let Some(gate) = self.gate.borrow_mut().take() {
            gate.open(self.lib, self.raw);
        }
    }

    /// Draws mpv's frame into the area's framebuffer (bound by GTK for the `render` signal).
    fn draw(&self, area: &GLArea) {
        let Some(ctx) = *self.render.borrow() else { return };
        let p = unsafe { get_proc_address(std::ptr::null_mut(), c"glGetIntegerv".as_ptr()) };
        if p.is_null() {
            return;
        }
        let get: GetIntegerv = unsafe { std::mem::transmute(p) };
        let mut fbo = 0;
        unsafe { get(GL_DRAW_FRAMEBUFFER_BINDING, &mut fbo) };
        let scale = area.scale_factor();
        let mut target = ffi::OpenGlFbo { fbo, w: area.width() * scale, h: area.height() * scale, internal_format: 0 };
        let mut flip: c_int = 1;
        let mut params = [
            ffi::RenderParam { kind: ffi::RENDER_PARAM_OPENGL_FBO, data: (&mut target as *mut ffi::OpenGlFbo).cast() },
            ffi::RenderParam { kind: ffi::RENDER_PARAM_FLIP_Y, data: (&mut flip as *mut c_int).cast() },
            ffi::RenderParam { kind: ffi::RENDER_PARAM_INVALID, data: std::ptr::null_mut() },
        ];
        unsafe {
            (self.lib.render_context_render)(ctx, params.as_mut_ptr());
            (self.lib.render_context_report_swap)(ctx);
        }
    }

    /// Frees the render context, in its GL context (before the player goes).
    fn free(&self, area: &GLArea) {
        if let Some(ctx) = self.render.borrow_mut().take() {
            area.make_current();
            unsafe {
                (self.lib.render_context_set_update_callback)(ctx, None, std::ptr::null_mut());
                (self.lib.render_context_free)(ctx);
            }
        }
    }
}

/// The `reel/mpv` native component.
pub struct MpvComponent {
    area: GLArea,
    state: Rc<State>,
    player: Option<Player>,
}

impl MpvComponent {
    pub fn new(cx: ComponentContext, lib: &'static Lib) -> MpvComponent {
        let emit_cx = cx.clone();
        let mut gate = None;
        let player = match Player::new(lib, "libmpv", &[], Arc::new(move |name, data| emit_cx.emit(name, data))) {
            Ok(mut p) => {
                // A file that opens at once (a saved film on disk) would find no video output yet.
                gate = Some(p.hold_until_drawn());
                Some(p)
            }
            Err(e) => {
                cx.emit("error", serde_json::json!({ "message": e }));
                None
            }
        };
        let area = GLArea::new();
        area.set_has_depth_buffer(false);
        area.set_has_stencil_buffer(false);
        // The pointer passes through to the node's view (the player's taps and clicks).
        area.set_can_target(false);
        area.set_hexpand(true);
        area.set_vexpand(true);
        let state = Rc::new(State {
            lib,
            raw: player.as_ref().map(Player::raw).unwrap_or(Raw(std::ptr::null_mut())),
            render: RefCell::new(None),
            closed: Cell::new(player.is_none()),
            gate: RefCell::new(gate),
            area: Box::new(glib::SendWeakRef::from(area.downgrade())),
        });
        {
            let s = state.clone();
            area.connect_realize(move |a| s.realize(a));
        }
        {
            let s = state.clone();
            area.connect_render(move |a, _| {
                s.draw(a);
                glib::Propagation::Stop
            });
        }
        {
            let s = state.clone();
            area.connect_unrealize(move |a| s.free(a));
        }
        MpvComponent { area, state, player }
    }
}

impl NativeComponent for MpvComponent {
    fn widget(&self) -> gtk4::Widget {
        self.area.clone().upcast()
    }

    fn set_prop(&mut self, name: &str, value: Option<&Value>) {
        if let Some(p) = self.player.as_mut() {
            p.set_prop(name, value);
        }
    }

    fn command(&mut self, name: &str, args: &Value) {
        if let Some(p) = self.player.as_mut() {
            p.run(name, args);
        }
    }
}

impl Drop for MpvComponent {
    fn drop(&mut self) {
        // The render context goes before the player it draws.
        self.state.closed.set(true);
        self.state.free(&self.area);
        self.player = None;
    }
}
