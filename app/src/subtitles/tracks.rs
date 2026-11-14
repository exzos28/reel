//! The audio and subtitle tracks inside the video, as the video view reports
//! them. mpv's `track-list` is read here (`from_mpv`), on every platform, so
//! the view only passes it on; the UI hands the result back to `menu`.

use serde::{Deserialize, Serialize};

use super::files;

/// A track of the video's container.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Track {
    /// mpv's track id (per type).
    pub id: i64,
    /// ISO 639-1 when known ("en"), else what the file says, else null.
    pub language: Option<String>,
    pub title: Option<String>,
    pub codec: Option<String>,
    /// Audio: "5.1", "stereo"…
    pub channels: Option<String>,
    pub default: bool,
    pub forced: bool,
    /// Loaded by the player from a file next to the video (not ours to list).
    pub external: bool,
    /// The player uses it now.
    pub selected: bool,
}

/// The tracks the view reports: the `tracks` event's payload.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Embedded {
    pub audio: Vec<Track>,
    pub subtitles: Vec<Track>,
}

/// One entry of mpv's `track-list` property.
#[derive(Deserialize)]
struct MpvTrack {
    id: i64,
    #[serde(rename = "type")]
    kind: String,
    #[serde(default)]
    lang: Option<String>,
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    codec: Option<String>,
    #[serde(default, rename = "demux-channels")]
    channels: Option<String>,
    #[serde(default)]
    default: bool,
    #[serde(default)]
    forced: bool,
    #[serde(default)]
    external: bool,
    #[serde(default)]
    selected: bool,
}

/// A codec as people know it: "ac3" → "AC3", "eac3" → "E-AC3", "subrip" → "SRT".
pub fn codec_name(codec: &str) -> String {
    match codec.to_ascii_lowercase().as_str() {
        "ac3" => "AC3".into(),
        "eac3" => "E-AC3".into(),
        "dts" | "dca" => "DTS".into(),
        "truehd" => "TrueHD".into(),
        "aac" => "AAC".into(),
        "mp3" => "MP3".into(),
        "opus" => "Opus".into(),
        "vorbis" => "Vorbis".into(),
        "flac" => "FLAC".into(),
        "pcm_s16le" | "pcm_s24le" | "pcm_s32le" | "pcm" => "PCM".into(),
        "subrip" | "srt" => "SRT".into(),
        "ass" | "ssa" => "ASS".into(),
        "webvtt" | "vtt" => "VTT".into(),
        "hdmv_pgs_subtitle" | "pgs" => "PGS".into(),
        "dvd_subtitle" | "dvdsub" => "VobSub".into(),
        "mov_text" => "Text".into(),
        other => other.to_ascii_uppercase(),
    }
}

/// mpv's channel layout as people say it: "stereo" → "2.0", "5.1(side)" → "5.1",
/// "unknown6" → "5.1". None for nothing worth showing.
pub fn channels_name(raw: &str) -> Option<String> {
    let raw = raw.trim();
    let by_count = |n: u32| match n {
        1 => "1.0".to_owned(),
        2 => "2.0".to_owned(),
        6 => "5.1".to_owned(),
        8 => "7.1".to_owned(),
        n => format!("{n} ch"),
    };
    if raw.is_empty() {
        return None;
    }
    if let Some(n) = raw.strip_prefix("unknown").and_then(|n| n.parse().ok()) {
        return Some(by_count(n));
    }
    Some(match raw {
        "mono" => "1.0".into(),
        "stereo" | "downmix" => "2.0".into(),
        "quad" => "4.0".into(),
        // "5.1(side)", "7.1(wide)", "5.1" …: the numbers are what matters.
        other => other.split('(').next().unwrap_or(other).to_owned(),
    })
}

/// The technical part of a track's note: "AC3 5.1", "SRT".
pub fn detail(t: &Track) -> Option<String> {
    let parts: Vec<String> = [t.codec.as_deref().map(codec_name), t.channels.as_deref().and_then(channels_name)]
        .into_iter()
        .flatten()
        .collect();
    (!parts.is_empty()).then(|| parts.join(" "))
}

/// mpv's `track-list` (as JSON) as audio and subtitle tracks; None when it is not one.
pub fn from_mpv(track_list: &str) -> Option<Embedded> {
    let list: Vec<MpvTrack> = serde_json::from_str(track_list).ok()?;
    let mut out = Embedded::default();
    for t in list {
        let track = Track {
            id: t.id,
            language: t.lang.as_deref().map(|l| files::language(l).map_or_else(|| l.to_owned(), str::to_owned)),
            title: t.title.filter(|s| !s.trim().is_empty()),
            codec: t.codec,
            channels: t.channels,
            default: t.default,
            forced: t.forced,
            external: t.external,
            selected: t.selected,
        };
        match t.kind.as_str() {
            "audio" => out.audio.push(track),
            "sub" => out.subtitles.push(track),
            _ => {}
        }
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_mpvs_track_list() {
        let list = r#"[
            {"id":1,"type":"video","codec":"h264","selected":true},
            {"id":1,"type":"audio","lang":"eng","codec":"aac","demux-channels":"stereo","default":true,"selected":true},
            {"id":2,"type":"audio","lang":"rus","title":"Dub","codec":"ac3","demux-channels":"5.1(side)"},
            {"id":1,"type":"sub","lang":"eng","codec":"subrip","forced":true,"title":" "},
            {"id":2,"type":"sub","lang":"tlh","codec":"ass","external":true}
        ]"#;
        let e = from_mpv(list).unwrap();
        assert_eq!(e.audio.len(), 2);
        assert_eq!(e.audio[0].language.as_deref(), Some("en"));
        assert!(e.audio[0].selected && e.audio[0].default);
        assert_eq!(e.audio[1].language.as_deref(), Some("ru"));
        assert_eq!(e.audio[1].title.as_deref(), Some("Dub"));
        assert_eq!(e.audio[1].channels.as_deref(), Some("5.1(side)"));
        assert_eq!(detail(&e.audio[1]).as_deref(), Some("AC3 5.1"));
        assert_eq!(detail(&e.audio[0]).as_deref(), Some("AAC 2.0"));
        assert_eq!(channels_name("unknown2").as_deref(), Some("2.0"));
        assert_eq!(channels_name("unknown6").as_deref(), Some("5.1"));
        assert_eq!(channels_name("7.1(wide)").as_deref(), Some("7.1"));
        assert_eq!(codec_name("hdmv_pgs_subtitle"), "PGS");
        assert_eq!(e.subtitles[0].title, None, "a blank title is none");
        assert!(e.subtitles[0].forced);
        assert_eq!(e.subtitles[1].language.as_deref(), Some("tlh"), "unknown codes stay as they are");
        assert!(from_mpv("not json").is_none());
    }
}
