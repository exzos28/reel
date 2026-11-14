//! The mpv video view on macOS: an `NSView` (the pointer passes through to
//! the node's view, as with NSH's own video) backed by a `CAOpenGLLayer`
//! that mpv's render API draws into. The layer is asynchronous: Core
//! Animation asks it every frame whether it has something new
//! (`canDrawInCGLContext:`), which is when mpv said a frame is ready or the
//! size changed.

#![allow(deprecated)] // OpenGL: what libmpv's render API draws with on macOS.

use std::{
    ffi::{c_int, c_void},
    sync::{
        Arc, Mutex, OnceLock,
        atomic::{AtomicBool, Ordering},
    },
};

use nsh_platform_macos::{ComponentContext, NativeComponent};
use objc2::{
    AllocAnyThread, DefinedClass, MainThreadMarker, MainThreadOnly, define_class, msg_send,
    rc::{Allocated, Retained},
};
use objc2_app_kit::{NSResponder, NSView};
use objc2_core_foundation::CFTimeInterval;
use objc2_core_video::CVTimeStamp;
use objc2_foundation::{NSObject, NSObjectProtocol, NSPoint};
use objc2_open_gl::{CGLContextObj, CGLPixelFormatObj};
use objc2_quartz_core::{CALayer, CAOpenGLLayer};
use serde_json::Value;

use super::{
    ffi::{self, Lib},
    player::{Player, Raw},
};

/// OpenGL, for mpv's `get_proc_address` and the few calls the layer makes.
fn gl() -> *mut c_void {
    struct Handle(*mut c_void);
    unsafe impl Send for Handle {}
    unsafe impl Sync for Handle {}
    static GL: OnceLock<Handle> = OnceLock::new();
    GL.get_or_init(|| {
        Handle(unsafe { libc::dlopen(c"/System/Library/Frameworks/OpenGL.framework/OpenGL".as_ptr(), libc::RTLD_LAZY) })
    })
    .0
}

unsafe extern "C" fn get_proc_address(_ctx: *mut c_void, name: *const std::ffi::c_char) -> *mut c_void {
    unsafe { libc::dlsym(gl(), name) }
}

type GetIntegerv = unsafe extern "C" fn(u32, *mut c_int);
const GL_VIEWPORT: u32 = 0x0BA2;
const GL_DRAW_FRAMEBUFFER_BINDING: u32 = 0x8CA6;

unsafe extern "C" {
    fn CGLChoosePixelFormat(attribs: *const u32, pix: *mut CGLPixelFormatObj, npix: *mut c_int) -> c_int;
    fn CGLSetCurrentContext(ctx: CGLContextObj) -> c_int;
}

/// mpv's render context and the GL context it was made in.
struct Render {
    ctx: ffi::RenderContext,
    gl: CGLContextObj,
}
unsafe impl Send for Render {}

pub struct LayerIvars {
    lib: &'static Lib,
    raw: Raw,
    /// None until the first draw (it needs the layer's GL context), and after `close`.
    render: Mutex<Option<Render>>,
    closed: AtomicBool,
    /// mpv has a new frame (its update callback); boxed so the callback's pointer stays put.
    dirty: Arc<AtomicBool>,
    /// The size last drawn, pixels.
    drawn: Mutex<(c_int, c_int)>,
}

unsafe extern "C" fn on_update(flag: *mut c_void) {
    // mpv's thread: only note it; the layer asks on its next frame.
    unsafe { (*(flag as *const AtomicBool)).store(true, Ordering::Release) };
}

define_class!(
    #[unsafe(super(CAOpenGLLayer, CALayer, NSObject))]
    #[name = "ReelMpvLayer"]
    #[ivars = LayerIvars]
    pub struct MpvLayer;

    unsafe impl NSObjectProtocol for MpvLayer {}

    impl MpvLayer {
        #[unsafe(method(copyCGLPixelFormatForDisplayMask:))]
        fn pixel_format(&self, mask: u32) -> CGLPixelFormatObj {
            const PROFILE: u32 = 99; // kCGLPFAOpenGLProfile
            const CORE_3_2: u32 = 0x3200;
            const ACCELERATED: u32 = 73;
            const DOUBLE_BUFFER: u32 = 5;
            const OFFLINE: u32 = 96; // kCGLPFAAllowOfflineRenderers
            const DISPLAY_MASK: u32 = 84;
            let tries: [&[u32]; 2] = [
                &[PROFILE, CORE_3_2, ACCELERATED, DOUBLE_BUFFER, OFFLINE, DISPLAY_MASK, mask, 0],
                &[ACCELERATED, DOUBLE_BUFFER, OFFLINE, 0],
            ];
            for attrs in tries {
                let mut pf: CGLPixelFormatObj = std::ptr::null_mut();
                let mut n = 0;
                if unsafe { CGLChoosePixelFormat(attrs.as_ptr(), &mut pf, &mut n) } == 0 && !pf.is_null() {
                    return pf;
                }
            }
            unsafe { msg_send![super(self), copyCGLPixelFormatForDisplayMask: mask] }
        }

        #[unsafe(method(canDrawInCGLContext:pixelFormat:forLayerTime:displayTime:))]
        fn can_draw(&self, _ctx: CGLContextObj, _pf: CGLPixelFormatObj, _t: CFTimeInterval, _ts: *const CVTimeStamp) -> bool {
            self.has_frame()
        }

        #[unsafe(method(drawInCGLContext:pixelFormat:forLayerTime:displayTime:))]
        fn draw(&self, ctx: CGLContextObj, pf: CGLPixelFormatObj, t: CFTimeInterval, ts: *const CVTimeStamp) {
            self.render_frame(ctx);
            // CAOpenGLLayer's own: flushes the frame.
            unsafe { msg_send![super(self), drawInCGLContext: ctx, pixelFormat: pf, forLayerTime: t, displayTime: ts] }
        }
    }
);

impl MpvLayer {
    /// A new frame from mpv, or a new size. Before the first draw: yes (it makes the render context).
fn has_frame(&self) -> bool {
        let ivars = self.ivars();
        if ivars.closed.load(Ordering::Acquire) {
            return false;
        }
        let render = ivars.render.lock().unwrap();
        let Some(render) = render.as_ref() else { return true };
        let bounds = self.bounds();
        let scale = self.contentsScale();
        let size = ((bounds.size.width * scale).round() as c_int, (bounds.size.height * scale).round() as c_int);
        let resized = *ivars.drawn.lock().unwrap() != size;
        // MPV_RENDER_UPDATE_FRAME: a new frame to draw.
        let frame = ivars.dirty.swap(false, Ordering::AcqRel) && unsafe { (ivars.lib.render_context_update)(render.ctx) } & 1 != 0;
        frame || resized
    }

    fn new(lib: &'static Lib, raw: Raw) -> Retained<MpvLayer> {
        let this = MpvLayer::alloc().set_ivars(LayerIvars {
            lib,
            raw,
            render: Mutex::new(None),
            closed: AtomicBool::new(false),
            dirty: Arc::new(AtomicBool::new(true)),
            drawn: Mutex::new((0, 0)),
        });
        let this: Retained<MpvLayer> = unsafe { msg_send![super(this), init] };
        this.setAsynchronous(true);
        this.setNeedsDisplayOnBoundsChange(true);
        this
    }

    fn render_frame(&self, ctx: CGLContextObj) {
        let ivars = self.ivars();
        if ivars.closed.load(Ordering::Acquire) {
            return;
        }
        unsafe { CGLSetCurrentContext(ctx) };
        let mut render = ivars.render.lock().unwrap();
        if render.is_none() {
            let mut init = ffi::OpenGlInitParams { get_proc_address, get_proc_address_ctx: std::ptr::null_mut() };
            let api = ffi::cstr("opengl");
            let mut params = [
                ffi::RenderParam { kind: ffi::RENDER_PARAM_API_TYPE, data: api.as_ptr() as *mut c_void },
                ffi::RenderParam { kind: ffi::RENDER_PARAM_OPENGL_INIT_PARAMS, data: (&mut init as *mut ffi::OpenGlInitParams).cast() },
                ffi::RenderParam { kind: ffi::RENDER_PARAM_INVALID, data: std::ptr::null_mut() },
            ];
            let mut made: ffi::RenderContext = std::ptr::null_mut();
            let r = unsafe { (ivars.lib.render_context_create)(&mut made, ivars.raw.0, params.as_mut_ptr()) };
            if r < 0 {
                eprintln!("reel mpv: render context: {}", ffi::error_text(ivars.lib, r));
                ivars.closed.store(true, Ordering::Release);
                return;
            }
            let flag = Arc::as_ptr(&ivars.dirty) as *mut c_void;
            unsafe { (ivars.lib.render_context_set_update_callback)(made, Some(on_update), flag) };
            *render = Some(Render { ctx: made, gl: ctx });
        }
        let Some(r) = render.as_ref() else { return };
        let get: GetIntegerv = unsafe { std::mem::transmute(libc::dlsym(gl(), c"glGetIntegerv".as_ptr())) };
        let (mut fbo, mut viewport) = (0, [0; 4]);
        unsafe {
            get(GL_DRAW_FRAMEBUFFER_BINDING, &mut fbo);
            get(GL_VIEWPORT, viewport.as_mut_ptr());
        }
        *ivars.drawn.lock().unwrap() = (viewport[2], viewport[3]);
        let mut target = ffi::OpenGlFbo { fbo, w: viewport[2], h: viewport[3], internal_format: 0 };
        let mut flip: c_int = 1;
        let mut params = [
            ffi::RenderParam { kind: ffi::RENDER_PARAM_OPENGL_FBO, data: (&mut target as *mut ffi::OpenGlFbo).cast() },
            ffi::RenderParam { kind: ffi::RENDER_PARAM_FLIP_Y, data: (&mut flip as *mut c_int).cast() },
            ffi::RenderParam { kind: ffi::RENDER_PARAM_INVALID, data: std::ptr::null_mut() },
        ];
        unsafe {
            (ivars.lib.render_context_render)(r.ctx, params.as_mut_ptr());
            (ivars.lib.render_context_report_swap)(r.ctx);
        }
    }

    /// Frees the render context (before the player goes); the layer draws nothing after.
    fn close(&self) {
        let ivars = self.ivars();
        ivars.closed.store(true, Ordering::Release);
        self.setAsynchronous(false);
        if let Some(r) = ivars.render.lock().unwrap().take() {
            unsafe {
                CGLSetCurrentContext(r.gl);
                (ivars.lib.render_context_set_update_callback)(r.ctx, None, std::ptr::null_mut());
                (ivars.lib.render_context_free)(r.ctx);
                CGLSetCurrentContext(std::ptr::null_mut());
            }
        }
    }
}

pub struct ViewIvars {
    layer: Retained<MpvLayer>,
}

define_class!(
    /// Shows the mpv layer; the pointer passes through to the node's view.
    #[unsafe(super(NSView, NSResponder, NSObject))]
    #[thread_kind = MainThreadOnly]
    #[name = "ReelMpvView"]
    #[ivars = ViewIvars]
    pub struct MpvView;

    unsafe impl NSObjectProtocol for MpvView {}

    impl MpvView {
        #[unsafe(method_id(hitTest:))]
        fn hit_test(&self, _point: NSPoint) -> Option<Retained<NSView>> {
            None
        }

        #[unsafe(method_id(makeBackingLayer))]
        fn make_backing_layer(&self) -> Retained<CALayer> {
            Retained::into_super(Retained::into_super(self.ivars().layer.clone()))
        }

        #[unsafe(method(viewDidChangeBackingProperties))]
        fn backing_changed(&self) {
            if let Some(window) = self.window() {
                self.ivars().layer.setContentsScale(window.backingScaleFactor());
            }
        }
    }
);

impl MpvView {
    fn new(mtm: MainThreadMarker, layer: Retained<MpvLayer>) -> Retained<MpvView> {
        let this: Allocated<MpvView> = MpvView::alloc(mtm);
        let this = this.set_ivars(ViewIvars { layer });
        let this: Retained<MpvView> = unsafe { msg_send![super(this), init] };
        this.setWantsLayer(true);
        this
    }
}

/// The `reel/mpv` native component.
pub struct MpvComponent {
    view: Retained<MpvView>,
    layer: Retained<MpvLayer>,
    player: Option<Player>,
}

impl MpvComponent {
    pub fn new(cx: ComponentContext, lib: &'static Lib) -> MpvComponent {
        let mtm = MainThreadMarker::new().expect("components are made on the main thread");
        let emit_cx = cx.clone();
        let player = Player::new(lib, "libmpv", Arc::new(move |name, data| emit_cx.emit(name, data)));
        let player = match player {
            Ok(p) => Some(p),
            Err(e) => {
                cx.emit("error", serde_json::json!({ "message": e }));
                None
            }
        };
        // Without a player the layer never draws (closed below).
        let raw = player.as_ref().map(Player::raw).unwrap_or(Raw(std::ptr::null_mut()));
        let layer = MpvLayer::new(lib, raw);
        if player.is_none() {
            layer.close();
        }
        let view = MpvView::new(mtm, layer.clone());
        MpvComponent { view, layer, player }
    }
}

impl NativeComponent for MpvComponent {
    fn view(&self) -> Retained<NSView> {
        Retained::into_super(self.view.clone())
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
        self.layer.close();
        self.player = None;
    }
}
