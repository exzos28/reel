//! The mpv video view on iOS and iPadOS: a `UIView` holding a `CAMetalLayer` that mpv draws into
//! itself (`vo=gpu-next` over Vulkan through MoltenVK, `wid` the layer, decoding with
//! VideoToolbox), as MPVKit's own iOS demo does. iOS has no desktop OpenGL, so the macOS view's
//! render API path (`view.rs`) does not apply.
//!
//! mpv reads the layer's size only when its video output is set up for a video (MPVKit's
//! MoltenVK context reports no resize), so a new size while a picture shows starts the output
//! again: a rotation or a split-view change blinks once. Files load once the layer has a size (`LoadGate`), else mpv
//! would start its output at 0×0.

use std::{
    cell::{Cell, RefCell},
    ffi::c_void,
    sync::Arc,
};

use nsh_platform_ios::{ComponentContext, NativeComponent};
use objc2::{
    DefinedClass, MainThreadMarker, MainThreadOnly, define_class, msg_send,
    rc::{Allocated, Retained},
    runtime::AnyClass,
};
use objc2_core_foundation::CGSize;
use objc2_foundation::{NSNotification, NSNotificationCenter, NSObject, NSObjectProtocol};
use objc2_quartz_core::{CALayer, CATransaction};
use objc2_ui_kit::{UIApplicationDidEnterBackgroundNotification, UIApplicationWillEnterForegroundNotification, UIResponder, UIView};
use serde_json::Value;

use super::{
    ffi::Lib,
    player::{LoadGate, Player},
};

/// mpv's options on iOS (over the common ones): MoltenVK's Vulkan into the layer, VideoToolbox.
const PLATFORM: [(&str, &str); 3] = [("gpu-api", "vulkan"), ("gpu-context", "moltenvk"), ("hwdec", "videotoolbox")];

/// The video output once the layer has a size (`vo=null` until then).
const VO: &str = "gpu-next";

/// What the view tells its component: laid out at a size (pixels).
type OnLayout = Box<dyn Fn(f64, f64)>;

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
            let bounds = self.bounds();
            // The screen's scale (3 on most iPhones): a view's own is 1 until it is in a window.
            let Some(window) = self.window() else { return };
            let scale = window.screen().scale();
            // No implicit animation of the layer's frame.
            CATransaction::begin();
            CATransaction::setDisableActions(true);
            self.ivars().layer.setFrame(bounds);
            self.ivars().layer.setContentsScale(scale);
            CATransaction::commit();
            let (w, h) = ((bounds.size.width * scale).round(), (bounds.size.height * scale).round());
            if let Some(f) = self.ivars().on_layout.borrow().as_ref() {
                f(w, h);
            }
        }

        /// In a window now: lay out again with the screen's scale.
        #[unsafe(method(didMoveToWindow))]
        fn did_move_to_window(&self) {
            let _: () = unsafe { msg_send![super(self), didMoveToWindow] };
            self.setNeedsLayout();
        }

        #[unsafe(method_id(hitTest:withEvent:))]
        fn hit_test(&self, _point: objc2_core_foundation::CGPoint, _event: *mut NSObject) -> Option<Retained<UIView>> {
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
                inner.player.borrow().set_property("vid", "auto");
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

/// The player and what its output knows of the layer.
pub struct Inner {
    player: RefCell<Player>,
    layer: Retained<CALayer>,
    /// The size the output was started at (pixels); 0×0 before.
    size: Cell<(f64, f64)>,
    /// Files wait for the first size.
    gate: RefCell<Option<Arc<LoadGate>>>,
    lib: &'static Lib,
}

impl Inner {
    /// The layer is laid out at `w`×`h` pixels: start the output there, or restart it at a new size.
    fn laid_out(&self, w: f64, h: f64) {
        // A 1×1 layer is UIKit's placeholder before the real layout (MPVKit's demo skips it too).
        if w < 2.0 || h < 2.0 || self.size.get() == (w, h) {
            return;
        }
        let first = self.size.get() == (0.0, 0.0);
        self.size.set((w, h));
        let _: () = unsafe { msg_send![&*self.layer, setDrawableSize: CGSize { width: w, height: h }] };
        let player = self.player.borrow();
        tracing::warn!("reel mpv: layer {w}x{h}{}", if first { ", output starts" } else { ", resized" });
        if first {
            player.set_window(Retained::as_ptr(&self.layer) as *const c_void as i64);
            player.set_property("vo", VO);
            if let Some(gate) = self.gate.borrow_mut().take() {
                gate.open(self.lib, player.raw());
            }
        } else if player.property("vo-configured").as_deref() == Some("yes") {
            // A picture shows: mpv sized its swapchain when its output started, and only a new
            // output makes another (a video reload keeps it), so the output starts again here.
            player.set_property("vo", "null");
            player.set_property("vo", VO);
            // VideoToolbox decodes on from where it was without its reference frames then
            // ("output image buffer is null", no picture on a device): start decoding again from
            // the keyframe at or before here (what plays is in mpv's cache already).
            if let Some(at) = player.property("time-pos").and_then(|t| t.parse::<f64>().ok()) {
                player.command_args(&["seek", &format!("{at}"), "absolute+keyframes"]);
            }
        }
        // No picture yet: the output starts at the layer's size when the video starts. Starting
        // it again now, while the file opens, left the film without a picture.
    }
}

/// The `reel/mpv` native component.
pub struct MpvComponent {
    view: Retained<UIView>,
    inner: Option<std::rc::Rc<Inner>>,
    lifecycle: Option<Retained<Lifecycle>>,
}

impl MpvComponent {
    pub fn new(cx: ComponentContext, lib: &'static Lib) -> MpvComponent {
        let mtm = MainThreadMarker::new().expect("components are made on the main thread");
        let Some(view) = MpvView::new(mtm) else {
            cx.emit("error", serde_json::json!({ "message": "no Metal layer", "code": "view" }));
            return MpvComponent { view: UIView::new(mtm), inner: None, lifecycle: None };
        };
        let emit_cx = cx.clone();
        let inner = match Player::new(lib, "null", &PLATFORM, Arc::new(move |name, data| emit_cx.emit(name, data))) {
            Ok(mut player) => {
                let gate = player.hold_until_drawn();
                Some(std::rc::Rc::new(Inner {
                    player: RefCell::new(player),
                    layer: view.ivars().layer.clone(),
                    size: Cell::new((0.0, 0.0)),
                    gate: RefCell::new(Some(gate)),
                    lib,
                }))
            }
            Err(e) => {
                cx.emit("error", serde_json::json!({ "message": e }));
                None
            }
        };
        if let Some(inner) = &inner {
            let weak = std::rc::Rc::downgrade(inner);
            *view.ivars().on_layout.borrow_mut() = Some(Box::new(move |w, h| {
                if let Some(inner) = weak.upgrade() {
                    inner.laid_out(w, h);
                }
            }));
        }
        let lifecycle = inner.as_ref().map(|i| Lifecycle::new(mtm, std::rc::Rc::downgrade(i)));
        crate::adapters::ios_awake::playing(true);
        MpvComponent { view: Retained::into_super(view), inner, lifecycle }
    }

}

impl NativeComponent for MpvComponent {
    fn view(&self) -> &UIView {
        &self.view
    }

    fn set_prop(&mut self, name: &str, value: Option<&Value>) {
        if let Some(inner) = &self.inner {
            inner.player.borrow_mut().set_prop(name, value);
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
        // mpv holds the layer without retaining it: the player goes first, while the view (and
        // its layer) still exist.
        self.inner = None;
        crate::adapters::ios_awake::playing(false);
    }
}
