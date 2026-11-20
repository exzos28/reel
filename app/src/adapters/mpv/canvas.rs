//! The iOS view's canvas (`ios.rs`, design/player-rendering.md): the fixed size in pixels mpv
//! draws a file at, chosen from the picture's aspect before mpv's output starts, and how it fits
//! into the view as the view turns or resizes. Plain arithmetic, so it is tested on any host.

use serde_json::Value;

/// A size in pixels or points: width, height.
pub type Size = (f64, f64);

/// The canvas for a picture shown at `picture` (any unit: only its aspect counts) on a screen of
/// `screen` pixels, in either orientation: the largest box of the picture's aspect that fits the
/// screen held one way or the other, in whole pixels. The picture is then 1:1 in its best
/// orientation and scaled down in the other. None when the picture's size is not known.
pub fn for_picture(picture: Size, screen: Size) -> Option<Size> {
    let (w, h) = picture;
    if !(w > 0.0 && h > 0.0 && w.is_finite() && h.is_finite()) {
        return None;
    }
    let (long, short) = (screen.0.max(screen.1), screen.0.min(screen.1));
    if !(short >= 2.0) {
        return None;
    }
    let aspect = w / h;
    let fit = |(bw, bh): Size| if bw / bh > aspect { (bh * aspect, bh) } else { (bw, bw / aspect) };
    let (sideways, upright) = (fit((long, short)), fit((short, long)));
    let (cw, ch) = if sideways.0 * sideways.1 >= upright.0 * upright.1 { sideways } else { upright };
    Some((cw.round().max(2.0), ch.round().max(2.0)))
}

/// Where the canvas shows in the view: its size in points scaled by `scale` (uniform), centred,
/// and the bars left between the view's edges and it (points, at each side).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Fit {
    pub scale: f64,
    /// The canvas as shown (points).
    pub shown: Size,
    /// The room at the left and at the right (`.0`), above and below (`.1`), points.
    pub bars: Size,
}

/// The canvas of `canvas` points (its pixels over the screen's scale) fitted into a view of
/// `view` points: as large as fits, its aspect kept, centred. None for a view with no size yet.
pub fn fit(canvas: Size, view: Size) -> Option<Fit> {
    let (cw, ch) = canvas;
    let (vw, vh) = view;
    if !(cw > 0.0 && ch > 0.0 && vw > 0.0 && vh > 0.0) {
        return None;
    }
    let scale = (vw / cw).min(vh / ch);
    let shown = (cw * scale, ch * scale);
    Some(Fit { scale, shown, bars: (((vw - shown.0) / 2.0).max(0.0), ((vh - shown.1) / 2.0).max(0.0)) })
}

/// A subtitle margin of the film's own subtitles (mpv draws them into the canvas) from the one
/// the UI gives on every platform. The UI measures from the view's edge, as a share of the
/// picture's height times `subtitleScale` (`filmSubtitles` in Player.tsx). mpv measures from
/// the canvas's edge, which sits `bar` points in. `picture`: the canvas's height as shown,
/// points; `sub_scale`: the subtitles' scale (`sub-scale`).
pub fn margin_in_canvas(share: f64, bar: f64, picture: f64, sub_scale: f64) -> f64 {
    if !(picture > 0.0) {
        return share.max(0.0);
    }
    (share - bar / (picture * sub_scale.max(1.0))).max(0.0)
}

/// The size the picture of the video track mpv will play shows at, from what its container says
/// (`track-list` as JSON, read in mpv's `on_preloaded` hook, before mpv picks the track): track
/// `vid` when the player chose one, else as mpv picks (the default one, then one that is not
/// cover art or a still image, then the first). None: no video track, or its size is not known.
pub fn picture_of_tracks(track_list: &str, vid: Option<i64>) -> Option<Size> {
    let list: Value = serde_json::from_str(track_list).ok()?;
    let flag = |t: &Value, name: &str| t.get(name).and_then(Value::as_bool).unwrap_or(false);
    let num = |t: &Value, name: &str| t.get(name).and_then(Value::as_f64).unwrap_or(0.0);
    let videos: Vec<&Value> = list.as_array()?.iter().filter(|t| t.get("type").and_then(Value::as_str) == Some("video")).collect();
    let track = match vid {
        Some(id) => videos.iter().copied().find(|t| t.get("id").and_then(Value::as_i64) == Some(id)),
        None => videos.iter().copied().min_by_key(|t| (!flag(t, "default"), flag(t, "albumart"), flag(t, "image"), t.get("id").and_then(Value::as_i64).unwrap_or(i64::MAX))),
    }?;
    let (w, h) = reel_domain::play::shown_size(num(track, "demux-w"), num(track, "demux-h"), num(track, "demux-par"), num(track, "demux-rotation"));
    (w > 0.0 && h > 0.0).then_some((w, h))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// An iPhone 17 Pro Max: 440×956 points at 3.
    const PHONE: Size = (1320.0, 2868.0);

    #[test]
    fn a_wide_picture_gets_the_screen_held_sideways() {
        // 16:9 on a 2.17:1 screen: as high as the screen sideways, 1:1 there.
        assert_eq!(for_picture((1920.0, 1080.0), PHONE), Some((2347.0, 1320.0)));
        // Wider than the screen: as wide as it.
        assert_eq!(for_picture((1920.0, 800.0), PHONE), Some((2868.0, 1195.0)));
        // 4:3 too.
        assert_eq!(for_picture((1440.0, 1080.0), PHONE), Some((1760.0, 1320.0)));
        // Either way the screen is given.
        assert_eq!(for_picture((1920.0, 1080.0), (2868.0, 1320.0)), Some((2347.0, 1320.0)));
    }

    #[test]
    fn a_tall_picture_gets_the_screen_held_upright() {
        assert_eq!(for_picture((1080.0, 1920.0), PHONE), Some((1320.0, 2347.0)));
        assert_eq!(for_picture((1080.0, 1080.0), PHONE), Some((1320.0, 1320.0)));
    }

    #[test]
    fn pixel_aspect_and_rotation_come_from_the_shown_size() {
        // Anamorphic PAL 16:9 (720×576, pixels 64:45 wide) is a 16:9 canvas.
        let pal = reel_domain::play::shown_size(720.0, 576.0, 64.0 / 45.0, 0.0);
        assert_eq!(for_picture(pal, PHONE), Some((2347.0, 1320.0)));
        // A phone's clip stored sideways and turned a quarter is upright.
        let clip = reel_domain::play::shown_size(1920.0, 1080.0, 1.0, 90.0);
        assert_eq!(for_picture(clip, PHONE), Some((1320.0, 2347.0)));
    }

    #[test]
    fn an_unknown_picture_has_no_canvas() {
        assert_eq!(for_picture((0.0, 0.0), PHONE), None);
        assert_eq!(for_picture((1920.0, 0.0), PHONE), None);
        assert_eq!(for_picture((f64::NAN, 1080.0), PHONE), None);
        assert_eq!(for_picture((1920.0, 1080.0), (0.0, 0.0)), None);
    }

    #[test]
    fn the_canvas_fits_the_view_either_way() {
        // 2347×1320 pixels at 3: 782.3×440 points.
        let canvas = (2347.0 / 3.0, 1320.0 / 3.0);
        let sideways = fit(canvas, (956.0, 440.0)).unwrap();
        assert!((sideways.scale - 1.0).abs() < 1e-9, "1:1 sideways");
        assert!((sideways.bars.0 - (956.0 - 2347.0 / 3.0) / 2.0).abs() < 1e-9);
        assert_eq!(sideways.bars.1, 0.0);
        let upright = fit(canvas, (440.0, 956.0)).unwrap();
        assert!((upright.shown.0 - 440.0).abs() < 1e-9, "as wide as the view upright");
        assert!((upright.shown.1 - 440.0 * 1320.0 / 2347.0).abs() < 1e-9);
        assert!((upright.bars.1 - (956.0 - upright.shown.1) / 2.0).abs() < 1e-9);
        assert_eq!(fit(canvas, (0.0, 0.0)), None);
    }

    #[test]
    fn subtitle_margins_move_from_the_view_into_the_canvas() {
        // Upright: the picture 247.5 points high, 354 below it. The UI puts the subtitles at the
        // picture's bottom plus mpv's own margin: in the canvas that is mpv's own margin.
        let (picture, bar) = (247.5, 354.25);
        let share = (bar + picture * 22.0 / 720.0) / picture;
        assert!((margin_in_canvas(share, bar, picture, 1.0) - 22.0 / 720.0).abs() < 1e-9);
        // Controls below the picture: nothing left to lift.
        assert_eq!(margin_in_canvas(150.0 / picture, bar, picture, 1.0), 0.0);
        // Scaled subtitles: the UI's share is of the picture times the scale.
        let scale = 1.2;
        let share = (bar + 30.0) / (picture * scale);
        assert!((margin_in_canvas(share, bar, picture, scale) - 30.0 / (picture * scale)).abs() < 1e-9);
        // Sideways and filling the height: as the UI says.
        assert_eq!(margin_in_canvas(0.3, 0.0, 440.0, 1.0), 0.3);
    }

    #[test]
    fn the_picture_is_the_track_mpv_will_play() {
        let list = r#"[
            {"id":1,"type":"video","albumart":true,"demux-w":600,"demux-h":600},
            {"id":2,"type":"video","demux-w":1920,"demux-h":800},
            {"id":3,"type":"video","default":true,"demux-w":1440,"demux-h":1080},
            {"id":1,"type":"audio","default":true}
        ]"#;
        assert_eq!(picture_of_tracks(list, None), Some((1440.0, 1080.0)), "the default one");
        assert_eq!(picture_of_tracks(list, Some(2)), Some((1920.0, 800.0)), "the one chosen");
        let no_default = r#"[{"id":1,"type":"video","albumart":true,"demux-w":600,"demux-h":600},{"id":2,"type":"video","demux-w":1920,"demux-h":1080,"demux-par":1.0,"demux-rotation":90}]"#;
        assert_eq!(picture_of_tracks(no_default, None), Some((1080.0, 1920.0)), "not the cover, turned");
        assert_eq!(picture_of_tracks(r#"[{"id":1,"type":"audio"}]"#, None), None);
        assert_eq!(picture_of_tracks(r#"[{"id":1,"type":"video"}]"#, None), None, "no size known");
        assert_eq!(picture_of_tracks("not json", None), None);
    }
}
