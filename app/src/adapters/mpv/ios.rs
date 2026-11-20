//! The mpv video view on iOS and iPadOS: a `UIView` holding a `CAMetalLayer` that mpv draws into
//! itself (`vo=gpu-next` over Vulkan through MoltenVK, `wid` the layer, decoding with
//! VideoToolbox), as MPVKit's own iOS demo does. iOS has no desktop OpenGL, so the macOS view's
//! render API path (`view.rs`) does not apply.
//!
//! The layer is a fixed canvas (design/player-rendering.md). mpv reads the layer's size only when
//! its output is set up for a file, and MoltenVK makes a new swapchain as soon as the layer's
//! size in pixels changes, which mpv does not follow. So the layer's size in pixels is set once
//! per file, in mpv's `on_preloaded` hook before its output starts, from the picture's aspect
//! (`canvas::for_picture`). A turn, a split view or a resize only moves and scales the layer into
//! the view (`position`, `transform`): mpv's output is never started again for a size (that lost
//! the picture on a device). Files load once the view has a size (`LoadGate`): the canvas falls
//! back to it.

use std::{
    cell::{Cell, RefCell},
    ffi::c_void,
    rc::{Rc, Weak},
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
};

use nsh_platform_ios::{ComponentContext, NativeComponent};
use objc2::{
    DefinedClass, MainThreadMarker, MainThreadOnly, define_class, msg_send,
    rc::{Allocated, Retained},
    runtime::{AnyClass, AnyObject},
};
use objc2_core_foundation::{CGAffineTransform, CGPoint, CGRect, CGSize};
use objc2_foundation::{NSNotification, NSNotificationCenter, NSObject, NSObjectProtocol};
use objc2_quartz_core::{CALayer, CATransaction};
use objc2_ui_kit::{UIApplicationDidEnterBackgroundNotification, UIApplicationWillEnterForegroundNotification, UIResponder, UIView};
use serde_json::{Value, json};

use super::{
    canvas::{self, Fit, Size},
    ffi::Lib,
    player::{self, HeldHook, LoadGate, Player},
};

/// mpv's options on iOS (over the common ones): MoltenVK's Vulkan into the layer, VideoToolbox.
const PLATFORM: [(&str, &str); 3] = [("gpu-api", "vulkan"), ("gpu-context", "moltenvk"), ("hwdec", "videotoolbox")];

/// The video output once the layer has a size (`vo=null` until then).
const VO: &str = "gpu-next";

/// What the view tells its component: laid out (its bounds may have changed).
type OnLayout = Box<dyn Fn()>;

pub struct ViewIvars {
    layer: Retained<CALayer>,
    on_layout: RefCell<Option<OnLayout>>,
}

define_class!(
    /// Holds the Metal layer and follows its own size; touches pass through to the node's view.
    #[unsafe(super(UIView, UIResponder, NSObject))]
    #[thread_kind = MainThreadOnly]
    #[name = "ReelMpvView"]
    #[ivars = ViewIvars]
    pub struct MpvView;

    unsafe impl NSObjectProtocol for MpvView {}

    impl MpvView {
        #[unsafe(method(layoutSubviews))]
        fn layout_subviews(&self) {
            let _: () = unsafe { msg_send![super(self), layoutSubviews] };
            if let Some(f) = self.ivars().on_layout.borrow().as_ref() {
                f();
            }
        }

        /// In a window now: lay out again with the screen's scale.
        #[unsafe(method(didMoveToWindow))]
        fn did_move_to_window(&self) {
            let _: () = unsafe { msg_send![super(self), didMoveToWindow] };
            self.setNeedsLayout();
        }

        #[unsafe(method_id(hitTest:withEvent:))]
        fn hit_test(&self, _point: CGPoint, _event: *mut NSObject) -> Option<Retained<UIView>> {
            None
        }
    }
);

impl MpvView {
    fn new(mtm: MainThreadMarker) -> Option<Retained<MpvView>> {
        let class = AnyClass::get(c"CAMetalLayer")?;
        let layer: Retained<CALayer> = unsafe { msg_send![class, new] };
        let this: Allocated<MpvView> = MpvView::alloc(mtm);
        let this = this.set_ivars(ViewIvars { layer: layer.clone(), on_layout: RefCell::new(None) });
        let this: Retained<MpvView> = unsafe { msg_send![super(this), init] };
        // Black around the canvas, as mpv's own bars in it, and nothing of it outside the view.
        let black: Retained<AnyObject> = unsafe { msg_send![objc2::class!(UIColor), blackColor] };
        let _: () = unsafe { msg_send![&*this, setBackgroundColor: &*black] };
        let _: () = unsafe { msg_send![&*this, setClipsToBounds: true] };
        this.layer().addSublayer(&layer);
        Some(this)
    }
}

define_class!(
    /// Follows the app going to the background and back: iOS stops an app that draws with the
    /// GPU in the background, so mpv's video stops there (`vid=no`) and comes back after.
    #[unsafe(super(NSObject))]
    #[thread_kind = MainThreadOnly]
    #[name = "ReelMpvLifecycle"]
    #[ivars = std::rc::Weak<Inner>]
    pub struct Lifecycle;

    unsafe impl NSObjectProtocol for Lifecycle {}

    impl Lifecycle {
        #[unsafe(method(background:))]
        fn background(&self, _n: &NSNotification) {
            if let Some(inner) = self.ivars().upgrade() {
                inner.player.borrow().set_property("vid", "no");
            }
        }

        #[unsafe(method(foreground:))]
        fn foreground(&self, _n: &NSNotification) {
            if let Some(inner) = self.ivars().upgrade() {
                let player = inner.player.borrow();
                // Its video comes back from what plays (a seek in its cache), not the stream:
                // no "waiting for the stream" for it.
                player.own_wait();
                player.set_property("vid", "auto");
            }
        }
    }
);

impl Lifecycle {
    fn new(mtm: MainThreadMarker, inner: std::rc::Weak<Inner>) -> Retained<Lifecycle> {
        let this = Lifecycle::alloc(mtm).set_ivars(inner);
        let this: Retained<Lifecycle> = unsafe { msg_send![super(this), init] };
        let center = NSNotificationCenter::defaultCenter();
        unsafe {
            center.addObserver_selector_name_object(&this, objc2::sel!(background:), Some(UIApplicationDidEnterBackgroundNotification), None);
            center.addObserver_selector_name_object(&this, objc2::sel!(foreground:), Some(UIApplicationWillEnterForegroundNotification), None);
        }
        this
    }
}

/// The film's own subtitles as the UI places them (`subtitleLift`, `subtitleSides`: shares of the
/// picture's height from the view's edges; `subtitleScale`), mapped into the canvas for mpv.
#[derive(Clone, Copy, PartialEq)]
struct Subtitles {
    lift: f64,
    sides: f64,
    scale: f64,
}

/// The player, its layer and the canvas mpv draws at.
pub struct Inner {
    // First: mpv holds the layer without retaining it, so the player goes before the layer.
    player: RefCell<Player>,
    view: Retained<MpvView>,
    layer: Retained<CALayer>,
    /// The canvas mpv draws at (pixels): set at the first layout, then by each file's hook before
    /// its output starts. Never changed otherwise.
    canvas: Cell<Option<Size>>,
    /// The screen's scale the canvas is laid at: its size in points is its pixels over it.
    scale: Cell<f64>,
    /// Files wait for the first size.
    gate: RefCell<Option<Arc<LoadGate>>>,
    subtitles: Cell<Subtitles>,
    /// The margins mpv was given last (in the canvas): only a change goes to it.
    sent: Cell<Option<(f64, f64)>>,
    lib: &'static Lib,
}

impl Inner {
    /// The view is laid out: the canvas fits it again. The first time, it is the canvas until the
    /// file's picture is known, and mpv may start: files load from now on.
    fn laid_out(&self) {
        let Some(window) = self.view.window() else { return };
        let bounds = self.view.bounds();
        // A 1×1 view is UIKit's placeholder before the real layout (MPVKit's demo skips it too).
        if bounds.size.width < 2.0 || bounds.size.height < 2.0 {
            return;
        }
        if self.canvas.get().is_some() {
            self.fit();
            return;
        }
        // The screen's scale (3 on most iPhones): a view's own is 1 until it is in a window.
        let scale = window.screen().scale();
        self.scale.set(scale);
        self.set_canvas(((bounds.size.width * scale).round(), (bounds.size.height * scale).round()), "the view's size until the picture's is known");
        let player = self.player.borrow();
        player.set_window(Retained::as_ptr(&self.layer) as *const c_void as i64);
        player.set_property("vo", VO);
        if let Some(gate) = self.gate.borrow_mut().take() {
            gate.open(self.lib, player.raw());
        }
    }

    /// mpv's hook found the file's picture (None: not known), before mpv starts its output for
    /// it: the canvas for its aspect. mpv reads the layer's size only when it sets its output up
    /// for new frames, which a picture of another aspect always has (its size, pixel aspect or
    /// rotation differ); one of the same aspect gets the same canvas. An unknown one keeps the
    /// canvas there is: mpv may keep its output as it is, and draws the picture inside the canvas.
    fn file_picture(&self, picture: Option<Size>) {
        let Some(now) = self.canvas.get() else { return };
        let Some(window) = self.view.window() else { return };
        let screen = window.screen();
        let size = screen.bounds().size;
        let s = screen.scale();
        let screen = (size.width * s, size.height * s);
        match picture.and_then(|p| canvas::for_picture(p, screen).map(|c| (p, c))) {
            Some((_, c)) if c == now => tracing::warn!("reel mpv: canvas {}x{} kept: the picture's", now.0, now.1),
            Some((p, c)) => self.set_canvas(c, &format!("for a {}x{} picture", p.0, p.1)),
            None => tracing::warn!("reel mpv: canvas {}x{} kept: the picture's size is not known", now.0, now.1),
        }
    }

    /// The canvas at `c` pixels: what mpv's output starts at, and the size MoltenVK sees
    /// (`bounds` × `contentsScale` = `drawableSize`), whatever the view does after.
    fn set_canvas(&self, c: Size, why: &str) {
        let s = self.scale.get();
        self.canvas.set(Some(c));
        // No implicit animation of the layer.
        CATransaction::begin();
        CATransaction::setDisableActions(true);
        self.layer.setBounds(CGRect::new(CGPoint::new(0.0, 0.0), CGSize::new(c.0 / s, c.1 / s)));
        self.layer.setContentsScale(s);
        let _: () = unsafe { msg_send![&*self.layer, setDrawableSize: CGSize { width: c.0, height: c.1 }] };
        CATransaction::commit();
        tracing::warn!("reel mpv: canvas {}x{}, {why}", c.0, c.1);
        self.fit();
    }

    /// Where the canvas shows in the view now: as large as fits, centred.
    fn fitted(&self) -> Option<Fit> {
        let c = self.canvas.get()?;
        let s = self.scale.get();
        let b = self.view.bounds();
        canvas::fit((c.0 / s, c.1 / s), (b.size.width, b.size.height))
    }

    /// Moves and scales the canvas into the view: only its position and transform change, never
    /// its size, so mpv and MoltenVK see nothing of a turn.
    fn fit(&self) {
        let Some(f) = self.fitted() else { return };
        let b = self.view.bounds();
        CATransaction::begin();
        CATransaction::setDisableActions(true);
        self.layer.setPosition(CGPoint::new(b.origin.x + b.size.width / 2.0, b.origin.y + b.size.height / 2.0));
        self.layer.setAffineTransform(CGAffineTransform { a: f.scale, b: 0.0, c: 0.0, d: f.scale, tx: 0.0, ty: 0.0 });
        CATransaction::commit();
        self.place_subtitles();
    }

    /// A subtitle prop of the UI's: kept, and the film's subtitles placed again.
    fn subtitle_prop(&self, name: &str, value: Option<&Value>) {
        let v = value.and_then(Value::as_f64);
        let mut s = self.subtitles.get();
        match name {
            "subtitleLift" => s.lift = v.unwrap_or(0.0),
            "subtitleSides" => s.sides = v.unwrap_or(0.0),
            _ => {
                s.scale = v.unwrap_or(1.0).clamp(1.0, 3.0);
                self.player.borrow_mut().set_prop(name, value);
            }
        }
        self.subtitles.set(s);
        self.place_subtitles();
    }

    /// The film's own subtitles where the UI puts them: it measures from the view's edges, mpv
    /// from the canvas's, which sits inside them (upright: the picture's bottom is far above the
    /// view's).
    fn place_subtitles(&self) {
        let s = self.subtitles.get();
        let margins = match self.fitted() {
            Some(f) => (canvas::margin_in_canvas(s.lift, f.bars.1, f.shown.1, s.scale), canvas::margin_in_canvas(s.sides, f.bars.0, f.shown.1, s.scale)),
            None => (s.lift, s.sides),
        };
        if self.sent.get() == Some(margins) {
            return;
        }
        self.sent.set(Some(margins));
        let mut player = self.player.borrow_mut();
        player.set_prop("subtitleLift", Some(&json!(margins.0)));
        player.set_prop("subtitleSides", Some(&json!(margins.1)));
    }
}

/// The views on screen by number, on the main thread: mpv's hook reaches a view through it
/// (`file_picture_on_main`), and a view gone by then is not found.
static NEXT_VIEW: AtomicUsize = AtomicUsize::new(1);
thread_local! {
    static VIEWS: RefCell<Vec<(usize, Weak<Inner>)>> = const { RefCell::new(Vec::new()) };
}

/// What mpv's `on_preloaded` hook found of a file, for the view it plays in; mpv waits in the
/// hook until this goes.
struct FilePicture {
    view: usize,
    picture: Option<Size>,
    hook: HeldHook,
}

/// On the main thread: the file's canvas is set, then mpv goes on (the hook drops) and starts
/// the file's output at it. A view gone by then only lets mpv go on.
extern "C" fn file_picture_on_main(context: *mut c_void) {
    // SAFETY: made by `Box::into_raw` in the hook, and run once.
    let file = unsafe { Box::from_raw(context as *mut FilePicture) };
    let inner = VIEWS.with(|v| v.borrow().iter().find(|(n, _)| *n == file.view).and_then(|(_, w)| w.upgrade()));
    if let Some(inner) = inner {
        inner.file_picture(file.picture);
    }
    drop(file.hook);
}

/// The `reel/mpv` native component.
pub struct MpvComponent {
    view: Retained<UIView>,
    inner: Option<Rc<Inner>>,
    /// Its number in `VIEWS`.
    id: usize,
    lifecycle: Option<Retained<Lifecycle>>,
}

impl MpvComponent {
    pub fn new(cx: ComponentContext, lib: &'static Lib) -> MpvComponent {
        let mtm = MainThreadMarker::new().expect("components are made on the main thread");
        let Some(view) = MpvView::new(mtm) else {
            cx.emit("error", serde_json::json!({ "message": "no Metal layer", "code": "view" }));
            return MpvComponent { view: UIView::new(mtm), inner: None, id: 0, lifecycle: None };
        };
        let emit_cx = cx.clone();
        let made = std::time::Instant::now();
        let inner = match Player::new(lib, "null", &PLATFORM, Arc::new(move |name, data| emit_cx.emit(name, data))) {
            Ok(mut player) => {
                let gate = player.hold_until_drawn();
                Some(Rc::new(Inner {
                    player: RefCell::new(player),
                    view: view.clone(),
                    layer: view.ivars().layer.clone(),
                    canvas: Cell::new(None),
                    scale: Cell::new(1.0),
                    gate: RefCell::new(Some(gate)),
                    subtitles: Cell::new(Subtitles { lift: 0.0, sides: 0.0, scale: 1.0 }),
                    sent: Cell::new(None),
                    lib,
                }))
            }
            Err(e) => {
                cx.emit("error", serde_json::json!({ "message": e }));
                None
            }
        };
        let id = NEXT_VIEW.fetch_add(1, Ordering::Relaxed);
        if let Some(inner) = &inner {
            let weak = Rc::downgrade(inner);
            *view.ivars().on_layout.borrow_mut() = Some(Box::new(move || {
                if let Some(inner) = weak.upgrade() {
                    inner.laid_out();
                }
            }));
            VIEWS.with(|v| v.borrow_mut().push((id, Rc::downgrade(inner))));
            // Each file: mpv waits after reading its tracks, before its video output starts,
            // while the main thread sets the canvas for its picture. Read here, on the player's
            // event thread (mpv answers while it waits); the main thread is only posted to.
            let raw = inner.player.borrow().raw();
            inner.player.borrow().hold_in(
                "on_preloaded",
                Box::new(move |hook| {
                    let vid = player::property(lib, raw, "vid").and_then(|v| v.parse::<i64>().ok());
                    let picture = player::property(lib, raw, "track-list").and_then(|l| canvas::picture_of_tracks(&l, vid));
                    let file = Box::into_raw(Box::new(FilePicture { view: id, picture, hook }));
                    crate::adapters::ios_awake::on_main(file as usize, file_picture_on_main);
                }),
            );
        }
        tracing::warn!("reel mpv: the player made in {} ms", made.elapsed().as_millis());
        let lifecycle = inner.as_ref().map(|i| Lifecycle::new(mtm, Rc::downgrade(i)));
        crate::adapters::ios_awake::playing(true);
        MpvComponent { view: Retained::into_super(view), inner, id, lifecycle }
    }
}

impl NativeComponent for MpvComponent {
    fn view(&self) -> &UIView {
        &self.view
    }

    fn set_prop(&mut self, name: &str, value: Option<&Value>) {
        if let Some(inner) = &self.inner {
            match name {
                "subtitleLift" | "subtitleSides" | "subtitleScale" => inner.subtitle_prop(name, value),
                _ => inner.player.borrow_mut().set_prop(name, value),
            }
        }
    }

    fn command(&mut self, name: &str, args: &Value) {
        if let Some(inner) = &self.inner {
            inner.player.borrow_mut().run(name, args);
        }
    }
}

impl Drop for MpvComponent {
    fn drop(&mut self) {
        if let Some(l) = self.lifecycle.take() {
            unsafe { NSNotificationCenter::defaultCenter().removeObserver(&l) };
        }
        VIEWS.with(|v| v.borrow_mut().retain(|(n, _)| *n != self.id));
        // mpv holds the layer without retaining it: the player goes first, while the view (and
        // its layer) still exist.
        self.inner = None;
        crate::adapters::ios_awake::playing(false);
    }
}
