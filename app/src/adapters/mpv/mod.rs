//! reel's own video view, backed by libmpv: plays every container and codec FFmpeg does
//! (MKV, DTS, TrueHD…) and reports and switches the audio and subtitle tracks. The native
//! component `reel/mpv` (`ui/VideoSurface.tsx` uses it where `VideoEngine.kind()` says
//! "mpv"): on macOS an NSView drawn through mpv's render API (`view`), on Linux a GTK GLArea
//! drawn the same way (`linux`), on Windows a Direct2D drawing of mpv's Direct3D 11 frames
//! (`windows`), on Android a TextureView (`app/android`, Java) driving the
//! same player (`android`), on iOS a Metal layer mpv draws into itself (`ios`). Without libmpv the
//! app keeps NSH's `<Video>`.

#[cfg(target_os = "android")]
mod android;
#[cfg(target_os = "ios")]
mod ios;
#[cfg(all(target_os = "linux", not(target_arch = "arm")))]
mod linux;
#[cfg(windows)]
mod windows;
pub mod ffi;
pub mod player;
#[cfg(target_os = "macos")]
mod view;

#[cfg(any(target_os = "macos", target_os = "ios", all(target_os = "linux", not(target_arch = "arm")), windows))]
use std::rc::Rc;

/// Whether libmpv was found (and loaded).
pub fn available() -> bool {
    ffi::lib().is_some()
}

/// Registers `reel/mpv` when libmpv is there (Windows: drawn with Direct2D in the view).
#[cfg(windows)]
pub fn register_windows(components: &nsh_platform_windows::Components) {
    let Some(lib) = ffi::lib() else { return };
    components.register("reel/mpv", Rc::new(move |cx| Box::new(windows::MpvComponent::new(cx, lib))));
}

/// Registers `reel/mpv` when libmpv is there (Linux desktops: a GLArea).
#[cfg(all(target_os = "linux", not(target_arch = "arm")))]
pub fn register_linux(components: &nsh_platform_linux::Components) {
    let Some(lib) = ffi::lib() else { return };
    components.register("reel/mpv", Rc::new(move |cx| Box::new(linux::MpvComponent::new(cx, lib))));
}

/// Registers `reel/mpv` when libmpv is there (iOS: a Metal layer mpv draws into).
#[cfg(target_os = "ios")]
pub fn register_ios(components: &nsh_platform_ios::Components) {
    let Some(lib) = ffi::lib() else { return };
    components.register("reel/mpv", Rc::new(move |cx| Box::new(ios::MpvComponent::new(cx, lib))));
}

/// Registers `reel/mpv` when libmpv is there.
#[cfg(target_os = "macos")]
pub fn register(components: &nsh_platform_macos::Components) {
    let Some(lib) = ffi::lib() else { return };
    components.register("reel/mpv", Rc::new(move |cx| Box::new(view::MpvComponent::new(cx, lib))));
}

#[cfg(test)]
mod tests {
    use std::{
        sync::{Arc, Mutex},
        time::{Duration, Instant},
    };

    use serde_json::{Value, json};

    use super::player::Player;

    /// Plays a real file headless (no picture: `vo=null`) and checks the
    /// events and the track switching. Needs libmpv and a file with tracks:
    /// `REEL_LIBMPV=…/libmpv.2.dylib REEL_MPV_SAMPLE=…/sample.mkv cargo test -- --ignored mpv_plays`
    /// (`dev/mpv-sample.sh` makes the sample with ffmpeg).
    #[test]
    #[ignore]
    fn mpv_plays_a_file_and_switches_tracks() {
        let lib = super::ffi::lib().expect("libmpv (REEL_LIBMPV)");
        let sample = std::env::var("REEL_MPV_SAMPLE").expect("REEL_MPV_SAMPLE");
        let events: Arc<Mutex<Vec<(String, Value)>>> = Default::default();
        let sink = events.clone();
        let mut p = Player::new(lib, "null", &[], Arc::new(move |name, data| sink.lock().unwrap().push((name.into(), data)))).unwrap();
        p.set_prop("volume", Some(&json!(0.0)));
        p.set_prop("progressUpdateInterval", Some(&json!(100)));
        p.set_prop("src", Some(&json!(sample)));
        let wait = |what: &dyn Fn(&[(String, Value)]) -> bool| {
            let started = Instant::now();
            while started.elapsed() < Duration::from_secs(20) {
                if what(&events.lock().unwrap()) {
                    return true;
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            false
        };
        assert!(wait(&|e| e.iter().any(|(n, _)| n == "load")), "loads: {:?}", events.lock().unwrap());
        assert!(wait(&|e| e.iter().any(|(n, d)| n == "tracks" && d["audio"].as_array().is_some_and(|a| a.len() == 2))));
        let tracks = events.lock().unwrap().iter().rev().find(|(n, _)| n == "tracks").unwrap().1.clone();
        println!("tracks: {tracks}");
        assert_eq!(tracks["audio"][1]["language"], "ru");
        assert_eq!(tracks["subtitles"][0]["language"], "en");

        p.set_prop("audioTrack", Some(&json!(2)));
        p.set_prop("subtitleTrack", Some(&json!(1)));
        assert!(wait(&|e| e.iter().any(|(n, d)| n == "tracks" && d["audio"][1]["selected"] == true && d["subtitles"][0]["selected"] == true)));
        p.set_prop("subtitleTrack", Some(&json!("no")));
        assert!(wait(&|e| e.iter().rev().find(|(n, _)| n == "tracks").is_some_and(|(_, d)| d["subtitles"][0]["selected"] == false)));

        assert!(wait(&|e| e.iter().any(|(n, d)| n == "progress" && d["currentTime"].as_f64().unwrap_or(0.0) > 0.3)));
        p.run("seek", &json!({ "seconds": 4.5 }));
        assert!(wait(&|e| e.iter().any(|(n, _)| n == "end")), "ends");
        drop(p);
    }

    /// A view that cannot make mpv's render context fails its gate: the file it held, and any
    /// later one, end in `error` (the player says so) instead of waiting for a picture for
    /// ever. Needs libmpv: `REEL_LIBMPV=… cargo test -- --ignored gate_failure` (on Windows,
    /// `libmpv-2.dll`'s folder on the `PATH`).
    #[test]
    #[ignore]
    fn gate_failure_is_an_error_not_a_wait() {
        let lib = super::ffi::lib().expect("libmpv (REEL_LIBMPV)");
        let events: Arc<Mutex<Vec<(String, Value)>>> = Default::default();
        let sink = events.clone();
        let mut p = Player::new(lib, "null", &[], Arc::new(move |name, data| sink.lock().unwrap().push((name.into(), data)))).unwrap();
        let gate = p.hold_until_drawn();
        p.set_prop("src", Some(&json!("file:///nowhere/held.mkv")));
        assert!(events.lock().unwrap().is_empty(), "held until the view draws");
        gate.fail();
        let errors = |e: &[(String, Value)]| e.iter().filter(|(n, d)| n == "error" && d["code"] == "view").count();
        assert_eq!(errors(&events.lock().unwrap()), 1, "{:?}", events.lock().unwrap());
        p.set_prop("src", Some(&json!("file:///nowhere/next.mkv")));
        assert_eq!(errors(&events.lock().unwrap()), 2, "a later file fails too");
        std::thread::sleep(Duration::from_millis(500));
        assert!(!events.lock().unwrap().iter().any(|(n, _)| n == "load"), "nothing loads");
        drop(p);
    }
}
