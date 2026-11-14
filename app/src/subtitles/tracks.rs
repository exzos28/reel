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
        assert_eq!(e.subtitles[0].title, None, "a blank title is none");
        assert!(e.subtitles[0].forced);
        assert_eq!(e.subtitles[1].language.as_deref(), Some("tlh"), "unknown codes stay as they are");
        assert!(from_mpv("not json").is_none());
    }
}
