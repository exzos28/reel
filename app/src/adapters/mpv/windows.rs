//! The mpv video view on Windows. NSH draws a component with Direct2D in its view (`draw`), or
//! hosts a child window of its own; a child window sits above everything NSH draws (Win32's
//! "airspace"), which would cover the player's controls, so mpv draws into a texture instead:
//! through its Direct3D 11 render API, on the device NSH's Direct2D context draws with (found
//! from the context's target), and the texture is drawn as a Direct2D bitmap in the view, under
//! the controls like any content. mpv says a frame is ready from its own thread; the view
//! asks NSH for a frame then.

use std::{
    cell::RefCell,
    ffi::c_void,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
};

use nsh_platform_windows::{ComponentContext, NativeComponent};
use serde_json::Value;
use windows::{
    Win32::Graphics::{
        Direct2D::{
            Common::{D2D_RECT_F, D2D1_ALPHA_MODE_PREMULTIPLIED, D2D1_PIXEL_FORMAT},
            D2D1_BITMAP_OPTIONS_NONE, D2D1_BITMAP_PROPERTIES1, D2D1_INTERPOLATION_MODE_LINEAR, ID2D1Bitmap1, ID2D1DeviceContext,
        },
        Direct3D11::{D3D11_BIND_RENDER_TARGET, D3D11_BIND_SHADER_RESOURCE, D3D11_TEXTURE2D_DESC, D3D11_USAGE_DEFAULT, ID3D11Device, ID3D11Texture2D},
        Dxgi::{Common::{DXGI_FORMAT_B8G8R8A8_UNORM, DXGI_SAMPLE_DESC}, IDXGISurface},
    },
    core::Interface,
};

use super::{
    ffi::{self, Lib},
    player::{Player, Raw},
};

/// What mpv drew into and the bitmap Direct2D draws it with, at a size in pixels.
struct Target {
    texture: ID3D11Texture2D,
    bitmap: ID2D1Bitmap1,
    size: (u32, u32),
}

struct Drawing {
    /// mpv's render context, made on NSH's device at the first draw.
    render: Option<ffi::RenderContext>,
    target: Option<Target>,
    /// Making the render context failed: nothing more is tried.
    failed: bool,
}

/// mpv's thread: a frame is ready; NSH draws the view again.
unsafe extern "C" fn on_update(arg: *mut c_void) {
    let shared = unsafe { &*(arg as *const Shared) };
    shared.dirty.store(true, Ordering::Release);
    shared.cx.redraw();
}

/// What mpv's update callback reaches (boxed: its address is the callback's argument).
struct Shared {
    cx: ComponentContext,
    dirty: AtomicBool,
}

/// The `reel/mpv` native component.
pub struct MpvComponent {
    lib: &'static Lib,
    raw: Raw,
    shared: Box<Shared>,
    drawing: RefCell<Drawing>,
    player: Option<Player>,
}

impl MpvComponent {
    pub fn new(cx: ComponentContext, lib: &'static Lib) -> MpvComponent {
        let emit_cx = cx.clone();
        let player = match Player::new(lib, "libmpv", &[], Arc::new(move |name, data| emit_cx.emit(name, data))) {
            Ok(p) => Some(p),
            Err(e) => {
                cx.emit("error", serde_json::json!({ "message": e }));
                None
            }
        };
        MpvComponent {
            lib,
            raw: player.as_ref().map(Player::raw).unwrap_or(Raw(std::ptr::null_mut())),
            shared: Box::new(Shared { cx, dirty: AtomicBool::new(true) }),
            drawing: RefCell::new(Drawing { render: None, target: None, failed: player.is_none() }),
            player,
        }
    }

    /// The Direct3D 11 device NSH's Direct2D context draws with: its target's DXGI surface's.
    fn device(dc: &ID2D1DeviceContext) -> windows::core::Result<ID3D11Device> {
        let target = unsafe { dc.GetTarget()? };
        let bitmap: ID2D1Bitmap1 = target.cast()?;
        let surface: IDXGISurface = unsafe { bitmap.GetSurface()? };
        unsafe { surface.GetDevice::<ID3D11Device>() }
    }

    fn make_render(&self, device: &ID3D11Device) -> Option<ffi::RenderContext> {
        let mut init = ffi::D3d11InitParams { device: device.as_raw() };
        let api = ffi::cstr("d3d11");
        let mut params = [
            ffi::RenderParam { kind: ffi::RENDER_PARAM_API_TYPE, data: api.as_ptr() as *mut c_void },
            ffi::RenderParam { kind: ffi::RENDER_PARAM_D3D11_INIT_PARAMS, data: (&mut init as *mut ffi::D3d11InitParams).cast() },
            ffi::RenderParam { kind: ffi::RENDER_PARAM_INVALID, data: std::ptr::null_mut() },
        ];
        let mut made: ffi::RenderContext = std::ptr::null_mut();
        let r = unsafe { (self.lib.render_context_create)(&mut made, self.raw.0, params.as_mut_ptr()) };
        if r < 0 {
            tracing::warn!("reel mpv: render context: {}", ffi::error_text(self.lib, r));
            return None;
        }
        let arg = &*self.shared as *const Shared as *mut c_void;
        unsafe { (self.lib.render_context_set_update_callback)(made, Some(on_update), arg) };
        Some(made)
    }

    /// A texture mpv can draw into and Direct2D can draw, `size` pixels.
    fn make_target(dc: &ID2D1DeviceContext, device: &ID3D11Device, size: (u32, u32)) -> windows::core::Result<Target> {
        let desc = D3D11_TEXTURE2D_DESC {
            Width: size.0,
            Height: size.1,
            MipLevels: 1,
            ArraySize: 1,
            Format: DXGI_FORMAT_B8G8R8A8_UNORM,
            SampleDesc: DXGI_SAMPLE_DESC { Count: 1, Quality: 0 },
            Usage: D3D11_USAGE_DEFAULT,
            BindFlags: (D3D11_BIND_RENDER_TARGET.0 | D3D11_BIND_SHADER_RESOURCE.0) as u32,
            CPUAccessFlags: 0,
            MiscFlags: 0,
        };
        let mut texture = None;
        unsafe { device.CreateTexture2D(&desc, None, Some(&mut texture))? };
        let texture = texture.ok_or_else(|| windows::core::Error::from(windows::Win32::Foundation::E_FAIL))?;
        let surface: IDXGISurface = texture.cast()?;
        let (mut dpi_x, mut dpi_y) = (96.0, 96.0);
        unsafe { dc.GetDpi(&mut dpi_x, &mut dpi_y) };
        let props = D2D1_BITMAP_PROPERTIES1 {
            pixelFormat: D2D1_PIXEL_FORMAT { format: DXGI_FORMAT_B8G8R8A8_UNORM, alphaMode: D2D1_ALPHA_MODE_PREMULTIPLIED },
            dpiX: dpi_x,
            dpiY: dpi_y,
            bitmapOptions: D2D1_BITMAP_OPTIONS_NONE,
            colorContext: std::mem::ManuallyDrop::new(None),
        };
        let bitmap = unsafe { dc.CreateBitmapFromDxgiSurface(&surface, Some(&props))? };
        Ok(Target { texture, bitmap, size })
    }
}

impl NativeComponent for MpvComponent {
    fn draw(&self, dc: &ID2D1DeviceContext, size: (f32, f32)) {
        let mut d = self.drawing.borrow_mut();
        if d.failed {
            return;
        }
        let device = match Self::device(dc) {
            Ok(device) => device,
            Err(e) => {
                tracing::warn!("reel mpv: no Direct3D device to draw the video with: {e}");
                d.failed = true;
                return;
            }
        };
        if d.render.is_none() {
            d.render = self.make_render(&device);
            if d.render.is_none() {
                d.failed = true;
                return;
            }
        }
        let (mut dpi_x, mut dpi_y) = (96.0, 96.0);
        unsafe { dc.GetDpi(&mut dpi_x, &mut dpi_y) };
        let pixels = (((size.0 * dpi_x / 96.0).round() as u32).max(1), ((size.1 * dpi_y / 96.0).round() as u32).max(1));
        let resized = d.target.as_ref().is_none_or(|t| t.size != pixels);
        if resized {
            match Self::make_target(dc, &device, pixels) {
                Ok(t) => d.target = Some(t),
                Err(e) => {
                    tracing::warn!("reel mpv: video texture: {e}");
                    return;
                }
            }
        }
        let Some(render) = d.render else { return };
        let Some(target) = d.target.as_ref() else { return };
        // A new frame from mpv (or a new texture to fill): mpv draws on the device's immediate
        // context, after what Direct2D has queued so far.
        let fresh = self.shared.dirty.swap(false, Ordering::AcqRel) && unsafe { (self.lib.render_context_update)(render) } & 1 != 0;
        if fresh || resized {
            unsafe {
                let _ = dc.Flush(None, None);
            }
            let mut fbo = ffi::D3d11Fbo { tex: target.texture.as_raw() };
            let mut params = [
                ffi::RenderParam { kind: ffi::RENDER_PARAM_D3D11_FBO, data: (&mut fbo as *mut ffi::D3d11Fbo).cast() },
                ffi::RenderParam { kind: ffi::RENDER_PARAM_INVALID, data: std::ptr::null_mut() },
            ];
            unsafe { (self.lib.render_context_render)(render, params.as_mut_ptr()) };
        }
        let rect = D2D_RECT_F { left: 0.0, top: 0.0, right: size.0, bottom: size.1 };
        unsafe {
            dc.DrawBitmap(&target.bitmap, Some(&rect), 1.0, D2D1_INTERPOLATION_MODE_LINEAR, None, None);
            (self.lib.render_context_report_swap)(render);
        }
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
        // The render context goes before the player it draws, and before the update callback's
        // argument (`shared`).
        let mut d = self.drawing.borrow_mut();
        if let Some(render) = d.render.take() {
            unsafe {
                (self.lib.render_context_set_update_callback)(render, None, std::ptr::null_mut());
                (self.lib.render_context_free)(render);
            }
        }
        d.target = None;
        drop(d);
        self.player = None;
    }
}
