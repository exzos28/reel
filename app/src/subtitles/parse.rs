//! Subtitle files as cues: SubRip (.srt), WebVTT (.vtt) and the dialogue of
//! SubStation Alpha (.ass/.ssa). Only the text and the timing are kept: tags,
//! override blocks and styles are dropped (our overlay has one style).

use serde::Serialize;

/// A subtitle file format.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Format {
    Srt,
    Vtt,
    Ass,
}

impl Format {
    /// By the file's extension (`.ssa` is read as ASS).
    pub fn of(name: &str) -> Option<Format> {
        let (_, ext) = name.rsplit_once('.')?;
        Some(match ext.to_ascii_lowercase().as_str() {
            "srt" => Format::Srt,
            "vtt" => Format::Vtt,
            "ass" | "ssa" => Format::Ass,
            _ => return None,
        })
    }
}

/// One subtitle on screen from `start` to `end` (seconds); lines split by `\n`.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Cue {
    pub start: f64,
    pub end: f64,
    pub text: String,
}

/// The file's bytes as text: UTF-8 (with or without a BOM), UTF-16 with a
/// BOM, else the legacy code page usual for the language (Windows-1251 for
/// Cyrillic, Windows-1252 otherwise).
pub fn decode(bytes: &[u8], language: Option<&str>) -> String {
    if let Some((encoding, bom)) = encoding_rs::Encoding::for_bom(bytes) {
        return encoding.decode_without_bom_handling(&bytes[bom..]).0.into_owned();
    }
    if let Ok(text) = std::str::from_utf8(bytes) {
        return text.to_owned();
    }
    let cyrillic = matches!(language, Some("ru" | "uk" | "be" | "bg" | "sr" | "mk" | "kk"));
    let legacy = if cyrillic { encoding_rs::WINDOWS_1251 } else { encoding_rs::WINDOWS_1252 };
    legacy.decode_without_bom_handling(bytes).0.into_owned()
}

/// The cues of a file, ordered by start; empty ones and broken blocks are skipped.
pub fn parse(format: Format, text: &str) -> Vec<Cue> {
    let text = text.replace("\r\n", "\n").replace('\r', "\n");
    let mut cues = match format {
        Format::Srt | Format::Vtt => parse_blocks(&text),
        Format::Ass => parse_ass(&text),
    };
    cues.retain(|c| !c.text.is_empty() && c.end > c.start);
    cues.sort_by(|a, b| a.start.total_cmp(&b.start));
    cues
}

/// The cues on screen at some moment of `from..=to` (seconds): those that
/// start by `to` and end after `from`. `cues` are ordered by start.
pub fn window(cues: &[Cue], from: f64, to: f64) -> Vec<&Cue> {
    let started = cues.partition_point(|c| c.start <= to);
    cues[..started].iter().filter(|c| c.end > from).collect()
}

/// SRT and VTT: blocks split by blank lines, each with a `-->` timing line
/// followed by the text. A VTT header, NOTE, STYLE and REGION blocks have no
/// timing line and so are skipped.
fn parse_blocks(text: &str) -> Vec<Cue> {
    let mut cues = Vec::new();
    for block in text.split("\n\n") {
        let mut lines = block.lines().skip_while(|l| !l.contains("-->"));
        let Some(timing) = lines.next() else { continue };
        let Some((start, end)) = timing.split_once("-->") else { continue };
        // VTT settings follow the end time ("00:04.000 align:start").
        let end = end.split_whitespace().next().unwrap_or("");
        let (Some(start), Some(end)) = (time(start.trim()), time(end)) else { continue };
        let lines: Vec<String> = lines.map(clean_markup).filter(|l| !l.is_empty()).collect();
        cues.push(Cue { start, end, text: lines.join("\n") });
    }
    cues
}

/// `hh:mm:ss,mmm`, `hh:mm:ss.mmm`, `mm:ss.mmm` (VTT) or `h:mm:ss.cc` (ASS) as seconds.
fn time(s: &str) -> Option<f64> {
    let s = s.trim();
    let parts: Vec<&str> = s.split(':').collect();
    let (h, m, sec) = match parts.as_slice() {
        [h, m, s] => (h.trim().parse::<f64>().ok()?, m.parse::<f64>().ok()?, *s),
        [m, s] => (0.0, m.trim().parse::<f64>().ok()?, *s),
        _ => return None,
    };
    let sec: f64 = sec.replace(',', ".").parse().ok()?;
    (m < 60.0 && sec < 60.0 && h >= 0.0).then_some(h * 3600.0 + m * 60.0 + sec)
}

/// A line of SRT or VTT without its markup: `<i>`, `<font …>`, `<c.x>`,
/// `<v Name>`, inline timestamps, `{\an8}`-style overrides and entities.
fn clean_markup(line: &str) -> String {
    let mut out = String::with_capacity(line.len());
    let mut in_tag = false;
    let mut in_override = false;
    for ch in line.chars() {
        match ch {
            '<' if !in_override => in_tag = true,
            '>' if in_tag => in_tag = false,
            '{' if !in_tag => in_override = true,
            '}' if in_override => in_override = false,
            _ if in_tag || in_override => {}
            _ => out.push(ch),
        }
    }
    out.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&nbsp;", " ")
        .replace("&lrm;", "")
        .replace("&rlm;", "")
        .trim()
        .to_owned()
}

/// ASS/SSA: the `Dialogue:` lines of `[Events]`, read with its `Format:`
/// line (Start, End and Text; Text is the last field and may hold commas).
fn parse_ass(text: &str) -> Vec<Cue> {
    let mut cues = Vec::new();
    let mut in_events = false;
    let mut fields: Vec<String> = Vec::new();
    for line in text.lines() {
        let line = line.trim();
        if line.starts_with('[') {
            in_events = line.eq_ignore_ascii_case("[events]");
            continue;
        }
        if !in_events {
            continue;
        }
        if let Some(format) = line.strip_prefix("Format:") {
            fields = format.split(',').map(|f| f.trim().to_ascii_lowercase()).collect();
            continue;
        }
        let Some(dialogue) = line.strip_prefix("Dialogue:") else { continue };
        if fields.is_empty() {
            // The usual v4+ order when a file leaves out its Format line.
            fields = ["layer", "start", "end", "style", "name", "marginl", "marginr", "marginv", "effect", "text"]
                .map(String::from)
                .to_vec();
        }
        let values: Vec<&str> = dialogue.splitn(fields.len(), ',').collect();
        let get = |name: &str| fields.iter().position(|f| f == name).and_then(|i| values.get(i)).map(|v| v.trim());
        let (Some(start), Some(end), Some(raw)) = (get("start").and_then(time), get("end").and_then(time), get("text")) else {
            continue;
        };
        // Vector drawings ({\p1}…) are shapes, not text.
        if raw.contains("\\p1") || raw.contains("\\p2") || raw.contains("\\p4") {
            continue;
        }
        let text = ass_text(raw);
        if !text.is_empty() {
            cues.push(Cue { start, end, text });
        }
    }
    cues
}

/// ASS dialogue text: override blocks dropped, `\N` and `\n` as line breaks, `\h` as a space.
fn ass_text(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    let mut depth = 0;
    for ch in raw.chars() {
        match ch {
            '{' => depth += 1,
            '}' if depth > 0 => depth -= 1,
            _ if depth > 0 => {}
            _ => out.push(ch),
        }
    }
    out.replace("\\N", "\n")
        .replace("\\n", "\n")
        .replace("\\h", " ")
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn srt_with_tags_and_windows_line_ends() {
        let cues = parse(Format::Srt, include_str!("fixtures/sample.srt"));
        assert_eq!(cues.len(), 3);
        assert_eq!(cues[0], Cue { start: 1.0, end: 3.5, text: "The lighthouse keeper\nwaves from the rock.".into() });
        assert_eq!(cues[1].text, "Is anyone out there?");
        assert_eq!(cues[1].start, 61.25);
        assert_eq!(cues[2].text, "Lights & bells.");
        assert_eq!(cues[2].start, 3600.0 + 2.0);
    }

    #[test]
    fn vtt_skips_header_notes_and_settings() {
        let cues = parse(Format::Vtt, include_str!("fixtures/sample.vtt"));
        let texts: Vec<_> = cues.iter().map(|c| c.text.as_str()).collect();
        assert_eq!(texts, ["Morning on the pier.", "Gulls circle\nover the boats.", "Tide's coming in."]);
        assert_eq!(cues[0].start, 2.0);
        assert_eq!(cues[1].end, 9.0);
        // Hours are optional in VTT.
        assert_eq!(cues[2].start, 75.5);
    }

    #[test]
    fn ass_dialogue_without_styling() {
        let cues = parse(Format::Ass, include_str!("fixtures/sample.ass"));
        let texts: Vec<_> = cues.iter().map(|c| c.text.as_str()).collect();
        // Ordered by start; the comment and the drawing are not dialogue.
        assert_eq!(texts, ["First line,\nwith a comma", "Second line", "Bold words here"]);
        assert_eq!(cues[0].start, 1.5);
        assert_eq!(cues[0].end, 4.0);
        assert_eq!(cues[2].start, 3661.25);
    }

    #[test]
    fn window_finds_what_is_on_screen() {
        let cues = parse(Format::Srt, include_str!("fixtures/sample.srt"));
        assert_eq!(window(&cues, 2.0, 2.0).len(), 1);
        assert!(window(&cues, 3.5, 3.5).is_empty(), "a cue is gone at its end");
        assert!(window(&cues, 10.0, 10.0).is_empty());
        assert_eq!(window(&cues, 0.0, 3700.0).len(), 3);
    }

    #[test]
    fn decoding_legacy_code_pages_and_boms() {
        // "Привет" in Windows-1251.
        let cp1251 = [0xCF, 0xF0, 0xE8, 0xE2, 0xE5, 0xF2];
        assert_eq!(decode(&cp1251, Some("ru")), "Привет");
        // "café" in Windows-1252.
        assert_eq!(decode(&[0x63, 0x61, 0x66, 0xE9], Some("fr")), "café");
        assert_eq!(decode("\u{feff}hello".as_bytes(), None), "hello");
        let utf16: Vec<u8> = [0xFF, 0xFE].into_iter().chain("hi".encode_utf16().flat_map(|u| u.to_le_bytes())).collect();
        assert_eq!(decode(&utf16, None), "hi");
    }

    #[test]
    fn formats_by_extension() {
        assert_eq!(Format::of("a/Film.EN.srt"), Some(Format::Srt));
        assert_eq!(Format::of("x.SSA"), Some(Format::Ass));
        assert_eq!(Format::of("x.vtt"), Some(Format::Vtt));
        assert_eq!(Format::of("x.sub"), None);
        assert_eq!(Format::of("x.mkv"), None);
    }
}
