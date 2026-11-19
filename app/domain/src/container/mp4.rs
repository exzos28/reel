//! MP4 (ISO BMFF, MOV): the index is the `moov` box's sample tables. For each sync sample
//! (keyframe) of the video: its presentation time (`stts` + `ctts`, shifted by the edit list)
//! and the lowest byte any track's data at that time starts from (audio chunks may sit before
//! the video's: a player reads from there).

use super::{NoIndex, Source};

/// A box: its type, where its body starts (from the start of `b`) and the body's length.
fn boxes(b: &[u8]) -> impl Iterator<Item = ([u8; 4], &[u8])> {
    let mut at = 0usize;
    std::iter::from_fn(move || {
        let (kind, body) = box_at(b.get(at..)?)?;
        at += body.1;
        Some((kind, &b[at - body.1 + body.0..at]))
    })
}

/// The box at `b[0..]`: its type and (header length, total length).
fn box_at(b: &[u8]) -> Option<([u8; 4], (usize, usize))> {
    let size = u32::from_be_bytes(b.get(0..4)?.try_into().ok()?) as u64;
    let kind: [u8; 4] = b.get(4..8)?.try_into().ok()?;
    let (head, total) = match size {
        0 => (8, b.len() as u64),
        1 => (16, u64::from_be_bytes(b.get(8..16)?.try_into().ok()?)),
        n => (8, n),
    };
    if total < head as u64 || total > b.len() as u64 {
        return None;
    }
    Some((kind, (head, total as usize)))
}

fn child<'a>(b: &'a [u8], kind: &[u8; 4]) -> Option<&'a [u8]> {
    boxes(b).find(|(k, _)| k == kind).map(|(_, body)| body)
}

fn path<'a>(b: &'a [u8], kinds: &[&[u8; 4]]) -> Option<&'a [u8]> {
    kinds.iter().try_fold(b, |b, k| child(b, k))
}

fn u32_at(b: &[u8], at: usize) -> Option<u32> {
    Some(u32::from_be_bytes(b.get(at..at + 4)?.try_into().ok()?))
}

fn u64_at(b: &[u8], at: usize) -> Option<u64> {
    Some(u64::from_be_bytes(b.get(at..at + 8)?.try_into().ok()?))
}

/// A full box's version, and its entries' count at byte 4.
fn version(b: &[u8]) -> Option<u8> {
    b.first().copied()
}

/// The timescale of `mvhd` or `mdhd` (version 0 or 1).
fn timescale(b: &[u8]) -> Option<u32> {
    u32_at(b, if version(b)? == 1 { 20 } else { 12 })
}

/// One track's samples: presentation times in its timescale's units (as f64 seconds once
/// scaled), byte offsets, and which are sync samples.
struct Track {
    video: bool,
    /// Seconds of each sample, as it shows (decode time + composition offset, edits applied).
    times: Vec<f64>,
    offsets: Vec<u64>,
    /// 0-based indices of the sync samples; None: every sample is one.
    sync: Option<Vec<u32>>,
}

/// Seconds of the film the edit list shifts this track by (`movie`: mvhd's timescale for the
/// edits' durations, `media`: mdhd's for their media times): an empty edit delays it, the
/// first edit's media time is where it starts.
fn edit_shift(trak: &[u8], movie: u32, media: u32) -> f64 {
    let Some(elst) = path(trak, &[b"edts", b"elst"]) else { return 0.0 };
    let Some(v) = version(elst) else { return 0.0 };
    let n = u32_at(elst, 4).unwrap_or(0) as usize;
    let (entry, wide) = if v == 1 { (20, true) } else { (12, false) };
    let mut delay = 0.0;
    for i in 0..n {
        let at = 8 + i * entry;
        let (duration, media_time) = if wide {
            (u64_at(elst, at).unwrap_or(0) as f64, u64_at(elst, at + 8).map_or(-1, |x| x as i64))
        } else {
            (u32_at(elst, at).unwrap_or(0) as f64, u32_at(elst, at + 4).map_or(-1, |x| x as i32 as i64))
        };
        if media_time == -1 {
            delay += duration / movie.max(1) as f64;
        } else {
            return delay - media_time as f64 / media.max(1) as f64;
        }
    }
    delay
}

fn track(trak: &[u8], movie: u32) -> Option<Track> {
    let mdia = child(trak, b"mdia")?;
    let media = timescale(child(mdia, b"mdhd")?)?.max(1);
    let handler: [u8; 4] = child(mdia, b"hdlr")?.get(8..12)?.try_into().ok()?;
    let stbl = path(mdia, &[b"minf", b"stbl"])?;
    // Decode times.
    let stts = child(stbl, b"stts")?;
    let mut dts: Vec<u64> = Vec::new();
    let mut t = 0u64;
    for i in 0..u32_at(stts, 4)? as usize {
        let (count, delta) = (u32_at(stts, 8 + i * 8)?, u32_at(stts, 12 + i * 8)? as u64);
        for _ in 0..count {
            dts.push(t);
            t += delta;
        }
    }
    // Composition offsets (signed in version 1; version 0's are signed in practice too).
    let mut cts = vec![0i64; dts.len()];
    if let Some(ctts) = child(stbl, b"ctts") {
        let mut s = 0usize;
        for i in 0..u32_at(ctts, 4)? as usize {
            let (count, off) = (u32_at(ctts, 8 + i * 8)?, u32_at(ctts, 12 + i * 8)? as i32 as i64);
            for _ in 0..count {
                if let Some(c) = cts.get_mut(s) {
                    *c = off;
                }
                s += 1;
            }
        }
    }
    let shift = edit_shift(trak, movie, media);
    let times = dts.iter().zip(&cts).map(|(&d, &c)| (d as i64 + c) as f64 / media as f64 + shift).collect::<Vec<_>>();
    // Sizes.
    let stsz = child(stbl, b"stsz")?;
    let fixed = u32_at(stsz, 4)?;
    let count = u32_at(stsz, 8)? as usize;
    let size = |i: usize| if fixed != 0 { Some(fixed as u64) } else { u32_at(stsz, 12 + i * 4).map(u64::from) };
    // Chunk offsets.
    let chunks: Vec<u64> = if let Some(stco) = child(stbl, b"stco") {
        (0..u32_at(stco, 4)? as usize).map(|i| u32_at(stco, 8 + i * 4).map(u64::from)).collect::<Option<_>>()?
    } else {
        let co64 = child(stbl, b"co64")?;
        (0..u32_at(co64, 4)? as usize).map(|i| u64_at(co64, 8 + i * 8)).collect::<Option<_>>()?
    };
    // Samples per chunk → each sample's offset.
    let stsc = child(stbl, b"stsc")?;
    let runs: Vec<(u32, u32)> = (0..u32_at(stsc, 4)? as usize).map(|i| Some((u32_at(stsc, 8 + i * 12)?, u32_at(stsc, 12 + i * 12)?))).collect::<Option<_>>()?;
    let mut offsets = Vec::with_capacity(count);
    let mut s = 0usize;
    for (c, &start) in chunks.iter().enumerate() {
        let chunk = c as u32 + 1;
        let per = runs.iter().rev().find(|&&(first, _)| first <= chunk).map_or(0, |&(_, n)| n);
        let mut at = start;
        for _ in 0..per {
            if s >= count {
                break;
            }
            offsets.push(at);
            at += size(s)?;
            s += 1;
        }
    }
    let n = offsets.len().min(times.len());
    let sync = child(stbl, b"stss").map(|stss| {
        (0..u32_at(stss, 4).unwrap_or(0) as usize).filter_map(|i| u32_at(stss, 8 + i * 4)).filter(|&s| s >= 1).map(|s| s - 1).collect()
    });
    Some(Track { video: &handler == b"vide", times: times[..n].to_vec(), offsets: offsets[..n].to_vec(), sync })
}

/// The keyframes from a `moov` body: (seconds, the lowest byte any track's data at that time
/// starts from).
pub(super) fn keyframes(moov: &[u8]) -> Result<Vec<(f64, u64)>, NoIndex> {
    if child(moov, b"mvex").is_some() {
        return Err(NoIndex::Fragmented);
    }
    let movie = child(moov, b"mvhd").and_then(timescale).ok_or(NoIndex::Broken("no mvhd"))?;
    let tracks: Vec<Track> = boxes(moov).filter(|(k, _)| k == b"trak").filter_map(|(_, t)| track(t, movie)).filter(|t| !t.offsets.is_empty()).collect();
    let video = tracks.iter().find(|t| t.video).ok_or(NoIndex::Broken("no video track"))?;
    let sync: Vec<u32> = video.sync.clone().unwrap_or_else(|| (0..video.offsets.len() as u32).collect());
    // Each other track's sample showing at `t` (the last one starting at or before it): its byte.
    let others: Vec<(&Track, Vec<(f64, u64)>)> = tracks
        .iter()
        .filter(|t| !std::ptr::eq(*t, video))
        .map(|t| {
            let mut by_time: Vec<(f64, u64)> = t.times.iter().copied().zip(t.offsets.iter().copied()).collect();
            by_time.sort_by(|a, b| a.0.total_cmp(&b.0));
            (t, by_time)
        })
        .collect();
    let mut points: Vec<(f64, u64)> = sync
        .iter()
        .filter_map(|&s| {
            let (t, mut byte) = (*video.times.get(s as usize)?, *video.offsets.get(s as usize)?);
            for (_, by_time) in &others {
                let i = by_time.partition_point(|&(x, _)| x <= t);
                if let Some(&(_, b)) = by_time.get(i.saturating_sub(1)) {
                    byte = byte.min(b);
                }
            }
            Some((t, byte))
        })
        .collect();
    points.sort_by(|a, b| a.0.total_cmp(&b.0));
    if points.is_empty() {
        return Err(NoIndex::NoCues);
    }
    Ok(points)
}

/// The most top-level boxes looked at before giving up on finding `moov`.
const MOST_BOXES: usize = 64;

/// Finds `moov` among the top-level boxes (at the start, or after `mdat` at the end) and reads
/// it: each box's header only, the others skipped by their size.
pub(super) async fn read_moov<S: Source + Send>(src: &mut S, len: u64, start: &[u8]) -> Result<Vec<u8>, NoIndex> {
    let read = |e: std::io::Error| NoIndex::Read(e.to_string());
    let mut at = 0u64;
    for _ in 0..MOST_BOXES {
        if at + 8 > len {
            break;
        }
        let head = match start.get(at as usize..(at as usize + 16).min(start.len())) {
            Some(h) if h.len() >= 16 || at as usize + h.len() == len as usize => h.to_vec(),
            _ => src.read(at, 16).await.map_err(read)?,
        };
        let size = u32_at(&head, 0).ok_or(NoIndex::Broken("box header"))? as u64;
        let kind = head.get(4..8).ok_or(NoIndex::Broken("box header"))?;
        let (hlen, total) = match size {
            0 => (8, len - at),
            1 => (16, u64_at(&head, 8).ok_or(NoIndex::Broken("box size"))?),
            n => (8, n),
        };
        if total < hlen {
            return Err(NoIndex::Broken("box size"));
        }
        if kind == b"moov" {
            if total > super::MOST {
                return Err(NoIndex::Broken("moov too large"));
            }
            let body = (at + hlen)..(at + total);
            return match start.get(body.start as usize..body.end as usize) {
                Some(b) => Ok(b.to_vec()),
                None => src.read(body.start, total - hlen).await.map_err(read),
            };
        }
        at += total;
    }
    Err(NoIndex::NoCues)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bx(kind: &[u8; 4], body: &[u8]) -> Vec<u8> {
        let mut v = ((body.len() + 8) as u32).to_be_bytes().to_vec();
        v.extend_from_slice(kind);
        v.extend_from_slice(body);
        v
    }
    /// A full box: version 0, no flags.
    fn fb(kind: &[u8; 4], body: &[u8]) -> Vec<u8> {
        bx(kind, &[&[0u8, 0, 0, 0][..], body].concat())
    }
    fn u32s(xs: &[u32]) -> Vec<u8> {
        xs.iter().flat_map(|x| x.to_be_bytes()).collect()
    }

    /// A track of `n` samples of 1 s (timescale 1000), `per` a chunk at `chunks`, each sample
    /// `size` bytes; `sync`: its sync samples (1-based).
    fn trak(handler: &[u8; 4], n: u32, per: u32, chunks: &[u32], size: u32, sync: Option<&[u32]>, elst: Option<(u32, i32)>) -> Vec<u8> {
        let mut stbl = vec![
            fb(b"stts", &u32s(&[1, n, 1000])),
            fb(b"stsc", &u32s(&[1, 1, per, 1])),
            fb(b"stsz", &u32s(&[size, n])),
            fb(b"stco", &[u32s(&[chunks.len() as u32]), u32s(chunks)].concat()),
        ];
        if let Some(s) = sync {
            stbl.push(fb(b"stss", &[u32s(&[s.len() as u32]), u32s(s)].concat()));
        }
        let mdhd = fb(b"mdhd", &u32s(&[0, 0, 1000, n * 1000, 0]));
        let hdlr = fb(b"hdlr", &[&u32s(&[0])[..], handler, &[0; 12]].concat());
        let minf = bx(b"minf", &bx(b"stbl", &stbl.concat()));
        let mut t = vec![bx(b"mdia", &[mdhd, hdlr, minf].concat())];
        if let Some((d, m)) = elst {
            t.push(bx(b"edts", &fb(b"elst", &[u32s(&[1, d, m as u32]), vec![0, 1, 0, 0]].concat())));
        }
        bx(b"trak", &t.concat())
    }

    fn moov(traks: &[Vec<u8>]) -> Vec<u8> {
        [fb(b"mvhd", &u32s(&[0, 0, 1000, 0, 0])), traks.concat()].concat()
    }

    #[test]
    fn keyframes_of_the_video_from_the_lowest_byte_of_any_track() {
        // Video: 6 samples of 100 bytes, 3 a chunk at 1000 and 2000, keyframes 1 and 4.
        // Audio: 6 samples of 10 bytes, 3 a chunk at 900 and 1900 (before the video's chunks).
        let m = moov(&[
            trak(b"vide", 6, 3, &[1000, 2000], 100, Some(&[1, 4]), None),
            trak(b"soun", 6, 3, &[900, 1900], 10, None, None),
        ]);
        assert_eq!(keyframes(&m), Ok(vec![(0.0, 900), (3.0, 1900)]));
    }

    #[test]
    fn an_edit_list_shifts_the_times() {
        // The first edit starts the media at 1 s: every time 1 s earlier.
        let m = moov(&[trak(b"vide", 4, 2, &[100, 300], 100, Some(&[2, 4]), Some((3000, 1000)))]);
        assert_eq!(keyframes(&m), Ok(vec![(0.0, 200), (2.0, 400)]));
    }

    #[test]
    fn every_sample_is_a_keyframe_without_stss_and_fragmented_is_no_index() {
        let m = moov(&[trak(b"vide", 2, 1, &[10, 20], 10, None, None)]);
        assert_eq!(keyframes(&m), Ok(vec![(0.0, 10), (1.0, 20)]));
        let frag = [moov(&[]), bx(b"mvex", &[])].concat();
        assert_eq!(keyframes(&frag), Err(NoIndex::Fragmented));
    }
}
