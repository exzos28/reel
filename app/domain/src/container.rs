//! A film file's own index: where its keyframes are, so the engine knows which bytes a seek
//! will read before the player asks for them. Every player (AVPlay, mpv, ExoPlayer, AVPlayer)
//! looks the same index up and reads from the keyframe at or before the time; the engine gets
//! that place first (`Engine.seek`).
//!
//! Matroska (MKV, WebM): its `Cues`, found through the `SeekHead`. MP4 (and MOV): the `moov`
//! box's sample tables (`mp4`). Anything else (AVI, fragmented MP4, an MKV without Cues) has
//! no index here, and a seek in it is not prepared.
//!
//! No I/O: the bytes come through `Source`, which the engine implements over a torrent stream.

use std::future::Future;

mod mp4;

/// Bytes of the file, as the engine fetches them.
pub trait Source {
    /// `len` bytes from `at` (fewer only at the end of the file).
    fn read(&mut self, at: u64, len: u64) -> impl Future<Output = std::io::Result<Vec<u8>>> + Send;
}

/// The keyframes of the film's video, `(seconds, byte in the file)`, in time order.
#[derive(Debug, Clone, PartialEq)]
pub struct Index {
    pub keyframes: Vec<(f64, u64)>,
}

impl Index {
    /// The bytes a seek to `seconds` reads: from the keyframe at or before it to the first
    /// keyframe more than `after` seconds past it (exclusive; the end of the file, `len`, when
    /// there is none). None for an index without keyframes.
    pub fn place(&self, seconds: f64, after: f64, len: u64) -> Option<(u64, u64)> {
        let k = &self.keyframes;
        let first = k.first()?;
        let at = k.partition_point(|&(t, _)| t <= seconds);
        let from = if at == 0 { first.1 } else { k[at - 1].1 };
        let end = k[at..].iter().find(|&&(t, _)| t > seconds + after).map_or(len, |&(_, b)| b);
        Some((from, end.max(from + 1)))
    }
}

impl Index {
    /// The moment of the film at byte `byte` of the file (`len` bytes, `duration` seconds):
    /// between the keyframes around it, in proportion (from the file's start to the first one,
    /// from the last one to the end). For drawing what is downloaded on the scrubber.
    pub fn time_at(&self, byte: u64, duration: f64, len: u64) -> f64 {
        let k = &self.keyframes;
        let i = k.partition_point(|&(_, b)| b <= byte);
        let (t0, b0) = if i == 0 { (0.0, 0) } else { k[i - 1] };
        let (t1, b1) = if i < k.len() { k[i] } else { (duration.max(t0), len.max(b0)) };
        let t = if b1 > b0 { t0 + (t1 - t0) * (byte.saturating_sub(b0)) as f64 / (b1 - b0) as f64 } else { t0 };
        t.clamp(0.0, duration.max(0.0))
    }
}

/// Why a file has no index here.
#[derive(Debug, Clone, PartialEq)]
pub enum NoIndex {
    /// Neither Matroska nor MP4.
    Unsupported,
    /// A fragmented MP4 (its index is spread over the fragments).
    Fragmented,
    /// No Cues (none for the video track), or no keyframes in an MP4's tables.
    NoCues,
    /// The file's structure is broken or not what Matroska says (`what`).
    Broken(&'static str),
    /// Reading the file failed.
    Read(String),
}

/// The largest element read whole (a corrupt size must not make the engine fetch gigabytes).
const MOST: u64 = 32 * 1024 * 1024;
/// What is read from the start first: the EBML header, the Segment's start, its first SeekHead
/// (and often Info and Tracks).
const HEAD: u64 = 64 * 1024;

mod id {
    pub const EBML: u32 = 0x1A45_DFA3;
    pub const DOC_TYPE: u32 = 0x4282;
    pub const SEGMENT: u32 = 0x1853_8067;
    pub const SEEK_HEAD: u32 = 0x114D_9B74;
    pub const SEEK: u32 = 0x4DBB;
    pub const SEEK_ID: u32 = 0x53AB;
    pub const SEEK_POSITION: u32 = 0x53AC;
    pub const INFO: u32 = 0x1549_A966;
    pub const TIMESTAMP_SCALE: u32 = 0x2A_D7B1;
    pub const TRACKS: u32 = 0x1654_AE6B;
    pub const TRACK_ENTRY: u32 = 0xAE;
    pub const TRACK_NUMBER: u32 = 0xD7;
    pub const TRACK_TYPE: u32 = 0x83;
    pub const CUES: u32 = 0x1C53_BB6B;
    pub const CUE_POINT: u32 = 0xBB;
    pub const CUE_TIME: u32 = 0xB3;
    pub const CUE_TRACK_POSITIONS: u32 = 0xB7;
    pub const CUE_TRACK: u32 = 0xF7;
    pub const CUE_CLUSTER_POSITION: u32 = 0xF1;
    pub const CLUSTER: u32 = 0x1F43_B675;
}

/// An element's header: its id, the header's length and the body's size (None: unknown).
#[derive(Debug, Clone, Copy, PartialEq)]
struct Header {
    id: u32,
    len: usize,
    size: Option<u64>,
}

/// A variable-length integer at `b[0..]`: (value with the marker kept, length), for ids.
fn vint_id(b: &[u8]) -> Option<(u32, usize)> {
    let first = *b.first()?;
    let len = first.leading_zeros() as usize + 1;
    if len > 4 || b.len() < len {
        return None;
    }
    Some((b[..len].iter().fold(0u32, |v, &x| (v << 8) | x as u32), len))
}

/// A variable-length size at `b[0..]`: (value, None when all ones = unknown; length).
fn vint_size(b: &[u8]) -> Option<(Option<u64>, usize)> {
    let first = *b.first()?;
    let len = first.leading_zeros() as usize + 1;
    if len > 8 || b.len() < len {
        return None;
    }
    let mask = if len == 8 { 0 } else { 0xFFu8 >> len };
    let mut v = (first & mask) as u64;
    for &x in &b[1..len] {
        v = (v << 8) | x as u64;
    }
    let all_ones = v == (1u64 << (7 * len)) - 1;
    Some((if all_ones { None } else { Some(v) }, len))
}

fn header(b: &[u8]) -> Option<Header> {
    let (id, a) = vint_id(b)?;
    let (size, c) = vint_size(&b[a..])?;
    Some(Header { id, len: a + c, size })
}

fn uint(b: &[u8]) -> u64 {
    b.iter().take(8).fold(0u64, |v, &x| (v << 8) | x as u64)
}

/// The children of a body with known sizes: (id, its body).
fn children(mut b: &[u8]) -> impl Iterator<Item = (u32, &[u8])> {
    std::iter::from_fn(move || {
        let h = header(b)?;
        let size = h.size? as usize;
        let body = b.get(h.len..h.len + size)?;
        b = &b[h.len + size..];
        Some((h.id, body))
    })
}

/// What the start of the file says: where the Segment's data starts, the SeekHead's entries
/// (id, position from the Segment's data) and what Info and Tracks were found in it.
#[derive(Debug, Default)]
struct Head {
    segment: u64,
    seeks: Vec<(u32, u64)>,
    scale: Option<u64>,
    video: Option<u64>,
}

fn seek_entries(body: &[u8]) -> Vec<(u32, u64)> {
    children(body)
        .filter(|(i, _)| *i == id::SEEK)
        .filter_map(|(_, seek)| {
            let mut sid = None;
            let mut pos = None;
            for (i, v) in children(seek) {
                match i {
                    id::SEEK_ID => sid = vint_id(v).map(|x| x.0),
                    id::SEEK_POSITION => pos = Some(uint(v)),
                    _ => {}
                }
            }
            Some((sid?, pos?))
        })
        .collect()
}

fn timestamp_scale(info: &[u8]) -> u64 {
    children(info).find(|(i, _)| *i == id::TIMESTAMP_SCALE).map_or(1_000_000, |(_, v)| uint(v))
}

/// The number of the first video track.
fn video_track(tracks: &[u8]) -> Option<u64> {
    children(tracks).filter(|(i, _)| *i == id::TRACK_ENTRY).find_map(|(_, e)| {
        let mut number = None;
        let mut kind = None;
        for (i, v) in children(e) {
            match i {
                id::TRACK_NUMBER => number = Some(uint(v)),
                id::TRACK_TYPE => kind = Some(uint(v)),
                _ => {}
            }
        }
        (kind == Some(1)).then_some(number).flatten()
    })
}

/// The video track's cue points: (seconds, byte in the file), in time order.
fn cue_points(cues: &[u8], track: u64, scale: u64, segment: u64) -> Vec<(f64, u64)> {
    let mut points: Vec<(f64, u64)> = children(cues)
        .filter(|(i, _)| *i == id::CUE_POINT)
        .filter_map(|(_, p)| {
            let mut time = None;
            let mut at = None;
            for (i, v) in children(p) {
                match i {
                    id::CUE_TIME => time = Some(uint(v)),
                    id::CUE_TRACK_POSITIONS => {
                        let mut t = None;
                        let mut c = None;
                        for (j, w) in children(v) {
                            match j {
                                id::CUE_TRACK => t = Some(uint(w)),
                                id::CUE_CLUSTER_POSITION => c = Some(uint(w)),
                                _ => {}
                            }
                        }
                        if t == Some(track) && at.is_none() {
                            at = c;
                        }
                    }
                    _ => {}
                }
            }
            Some((time? as f64 * scale as f64 / 1e9, segment + at?))
        })
        .collect();
    points.sort_by(|a, b| a.0.total_cmp(&b.0));
    points
}

/// Reads the head: the EBML header (a Matroska or WebM DocType), the Segment's header, and its
/// children in `b` up to the first Cluster.
fn head(b: &[u8]) -> Result<Head, NoIndex> {
    let ebml = header(b).ok_or(NoIndex::Unsupported)?;
    if ebml.id != id::EBML {
        return Err(NoIndex::Unsupported);
    }
    let body = b.get(ebml.len..ebml.len + ebml.size.ok_or(NoIndex::Broken("EBML header size"))? as usize).ok_or(NoIndex::Broken("EBML header"))?;
    let doc = children(body).find(|(i, _)| *i == id::DOC_TYPE).map(|(_, v)| v);
    if !matches!(doc, Some(b"matroska") | Some(b"webm")) {
        return Err(NoIndex::Unsupported);
    }
    let mut at = ebml.len + body.len();
    let seg = header(&b[at..]).ok_or(NoIndex::Broken("Segment header"))?;
    if seg.id != id::SEGMENT {
        return Err(NoIndex::Broken("no Segment"));
    }
    at += seg.len;
    let mut h = Head { segment: at as u64, ..Head::default() };
    // The Segment's children within these bytes (the Segment itself may be of unknown size).
    while let Some(c) = header(&b[at..]) {
        if c.id == id::CLUSTER {
            break;
        }
        let Some(size) = c.size else { break };
        let Some(body) = b.get(at + c.len..at + c.len + size as usize) else { break };
        match c.id {
            id::SEEK_HEAD => h.seeks.extend(seek_entries(body)),
            id::INFO => h.scale = Some(timestamp_scale(body)),
            id::TRACKS => h.video = video_track(body),
            _ => {}
        }
        at += c.len + size as usize;
    }
    Ok(h)
}

/// The body of the element at `at` whose id must be `want`.
async fn element<S: Source + Send>(src: &mut S, at: u64, want: u32) -> Result<Vec<u8>, NoIndex> {
    let read = |e: std::io::Error| NoIndex::Read(e.to_string());
    let top = src.read(at, 12).await.map_err(read)?;
    let h = header(&top).ok_or(NoIndex::Broken("element header"))?;
    if h.id != want {
        return Err(NoIndex::Broken("the SeekHead points at another element"));
    }
    let size = h.size.ok_or(NoIndex::Broken("element of unknown size"))?;
    if size > MOST {
        return Err(NoIndex::Broken("element too large"));
    }
    src.read(at + h.len as u64, size).await.map_err(read)
}

/// The film's index from its file (`len` bytes): the head, then what the SeekHead points at
/// (a second SeekHead, Info and Tracks when they were not in the head, the Cues).
pub async fn read_index<S: Source + Send>(src: &mut S, len: u64) -> Result<Index, NoIndex> {
    let start = src.read(0, HEAD.min(len)).await.map_err(|e| NoIndex::Read(e.to_string()))?;
    if start.get(4..8) == Some(b"ftyp") {
        let moov = mp4::read_moov(src, len, &start).await?;
        return Ok(Index { keyframes: mp4::keyframes(&moov)? });
    }
    mkv_index(src, &start).await
}

/// A Matroska file's index (`start`: its first bytes).
async fn mkv_index<S: Source + Send>(src: &mut S, start: &[u8]) -> Result<Index, NoIndex> {
    let mut h = head(start)?;
    let seg = h.segment;
    let find = |seeks: &[(u32, u64)], want: u32| seeks.iter().find(|(i, _)| *i == want).map(|&(_, p)| seg + p);
    // A SeekHead that points at another (often at the end of the file).
    if let Some(more) = h.seeks.iter().filter(|(i, _)| *i == id::SEEK_HEAD).map(|&(_, p)| seg + p).find(|&p| p >= start.len() as u64) {
        let body = element(src, more, id::SEEK_HEAD).await?;
        h.seeks.extend(seek_entries(&body));
    }
    if h.scale.is_none()
        && let Some(at) = find(&h.seeks, id::INFO)
    {
        h.scale = Some(timestamp_scale(&element(src, at, id::INFO).await?));
    }
    if h.video.is_none()
        && let Some(at) = find(&h.seeks, id::TRACKS)
    {
        h.video = video_track(&element(src, at, id::TRACKS).await?);
    }
    let track = h.video.ok_or(NoIndex::Broken("no video track"))?;
    let at = find(&h.seeks, id::CUES).ok_or(NoIndex::NoCues)?;
    let cues = element(src, at, id::CUES).await?;
    let keyframes = cue_points(&cues, track, h.scale.unwrap_or(1_000_000), seg);
    if keyframes.is_empty() {
        return Err(NoIndex::NoCues);
    }
    Ok(Index { keyframes })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// An element: its id's bytes, an 8-byte size and the body.
    fn el(id: u32, body: &[u8]) -> Vec<u8> {
        let mut v: Vec<u8> = id.to_be_bytes().iter().copied().skip_while(|&b| b == 0).collect();
        v.push(0x01);
        v.extend_from_slice(&(body.len() as u64).to_be_bytes()[1..]);
        v.extend_from_slice(body);
        v
    }
    fn u(id: u32, value: u64) -> Vec<u8> {
        el(id, &value.to_be_bytes())
    }
    fn cat(parts: &[Vec<u8>]) -> Vec<u8> {
        parts.concat()
    }

    struct Mem(Vec<u8>, Vec<(u64, u64)>);
    impl Source for Mem {
        fn read(&mut self, at: u64, len: u64) -> impl Future<Output = std::io::Result<Vec<u8>>> + Send {
            self.1.push((at, len));
            let end = (at + len).min(self.0.len() as u64) as usize;
            let out = self.0.get(at as usize..end).map(<[u8]>::to_vec).unwrap_or_default();
            async move { Ok(out) }
        }
    }

    fn block_on<F: Future>(f: F) -> F::Output {
        use std::task::{Context, Poll, Waker};
        let mut f = std::pin::pin!(f);
        let mut cx = Context::from_waker(Waker::noop());
        loop {
            if let Poll::Ready(v) = f.as_mut().poll(&mut cx) {
                return v;
            }
        }
    }

    /// A Matroska file: header, Segment (unknown size) with a SeekHead pointing at Info,
    /// Tracks and the Cues; `filler` bytes of clusters; the Cues at the end.
    fn film(cues_track: u64, filler: usize) -> Vec<u8> {
        let ebml = el(id::EBML, &el(id::DOC_TYPE, b"matroska"));
        let info = el(id::INFO, &u(id::TIMESTAMP_SCALE, 1_000_000));
        let tracks = el(
            id::TRACKS,
            &cat(&[
                el(id::TRACK_ENTRY, &cat(&[u(id::TRACK_NUMBER, 2), u(id::TRACK_TYPE, 2)])), // audio
                el(id::TRACK_ENTRY, &cat(&[u(id::TRACK_NUMBER, 1), u(id::TRACK_TYPE, 1)])), // video
            ]),
        );
        let point = |ms: u64, cluster: u64| {
            el(id::CUE_POINT, &cat(&[u(id::CUE_TIME, ms), el(id::CUE_TRACK_POSITIONS, &cat(&[u(id::CUE_TRACK, cues_track), u(id::CUE_CLUSTER_POSITION, cluster)]))]))
        };
        let cues = el(id::CUES, &cat(&[point(10_000, 5_000), point(0, 1_000), point(20_000, 9_000)]));
        let seek = |which: u32, pos: u64| el(id::SEEK, &cat(&[el(id::SEEK_ID, &which.to_be_bytes()), u(id::SEEK_POSITION, pos)]));
        // Positions from the Segment's data: SeekHead (its size fixed below), Info, Tracks, clusters, Cues.
        let head_len = el(id::SEEK_HEAD, &cat(&[seek(id::INFO, 0), seek(id::TRACKS, 0), seek(id::CUES, 0)])).len() as u64;
        let info_at = head_len;
        let tracks_at = info_at + info.len() as u64;
        let cues_at = tracks_at + tracks.len() as u64 + filler as u64;
        let seek_head = el(id::SEEK_HEAD, &cat(&[seek(id::INFO, info_at), seek(id::TRACKS, tracks_at), seek(id::CUES, cues_at)]));
        let mut seg = vec![0x18, 0x53, 0x80, 0x67, 0x01, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF]; // unknown size
        seg.extend(seek_head);
        seg.extend(info);
        seg.extend(tracks);
        let mut cluster = el(id::CLUSTER, &vec![0u8; filler.saturating_sub(13)]);
        cluster.resize(filler, 0);
        seg.extend(cluster);
        seg.extend(cues);
        cat(&[ebml, seg])
    }

    #[test]
    fn the_cues_of_the_video_track_through_the_seek_head() {
        let f = film(1, 200_000);
        let segment = (el(id::EBML, &el(id::DOC_TYPE, b"matroska")).len() + 12) as u64;
        let len = f.len() as u64;
        let mut src = Mem(f, vec![]);
        let index = block_on(read_index(&mut src, len)).unwrap();
        // Sorted by time, cluster positions from the Segment's data start.
        assert_eq!(index.keyframes, vec![(0.0, segment + 1_000), (10.0, segment + 5_000), (20.0, segment + 9_000)]);
        // The head, then the Cues' header and body: never the clusters in between.
        assert_eq!(src.1.len(), 3);
        assert!(src.1.iter().all(|&(at, n)| at + n <= HEAD || at >= 200_000), "read {:?}", src.1);
    }

    #[test]
    fn cues_of_another_track_only_are_no_index() {
        let f = film(2, 1_000);
        let len = f.len() as u64;
        assert_eq!(block_on(read_index(&mut Mem(f, vec![]), len)), Err(NoIndex::NoCues));
    }

    #[test]
    fn neither_matroska_nor_mp4_is_no_index() {
        let avi = b"RIFF\0\0\0\0AVI LIST".to_vec();
        let len = avi.len() as u64;
        assert_eq!(block_on(read_index(&mut Mem(avi, vec![]), len)), Err(NoIndex::Unsupported));
    }

    #[test]
    fn a_seeks_place_runs_from_the_keyframe_before_to_the_one_after() {
        let index = Index { keyframes: vec![(0.0, 100), (10.0, 500), (20.0, 900), (30.0, 1300)] };
        // 12 s: from the 10 s keyframe to the first one past 16 s (20 s).
        assert_eq!(index.place(12.0, 4.0, 2000), Some((500, 900)));
        // On a keyframe: from it; 4 s after 10 s is 14 s, so to 20 s.
        assert_eq!(index.place(10.0, 4.0, 2000), Some((500, 900)));
        // Past the last keyframe: to the end of the file.
        assert_eq!(index.place(29.0, 4.0, 2000), Some((900, 2000)));
        // Before the first one: from the first.
        assert_eq!(index.place(-1.0, 4.0, 2000), Some((100, 500)));
        assert_eq!(Index { keyframes: vec![] }.place(1.0, 4.0, 10), None);
    }

    /// A real file against what ffprobe says (a dev check): `REEL_FILM=<file> cargo test -p
    /// reel-domain -- --ignored real_file`; prints the keyframes to compare with
    /// `ffprobe -select_streams v -skip_frame nokey -show_entries frame=pts_time,pkt_pos`.
    #[test]
    #[ignore]
    fn real_file() {
        struct File(std::fs::File);
        impl Source for File {
            fn read(&mut self, at: u64, len: u64) -> impl Future<Output = std::io::Result<Vec<u8>>> + Send {
                use std::io::{Read, Seek, SeekFrom};
                let mut out = Vec::new();
                let r = self.0.seek(SeekFrom::Start(at)).and_then(|_| (&self.0).take(len).read_to_end(&mut out)).map(|_| out);
                async move { r }
            }
        }
        let path = std::env::var("REEL_FILM").expect("REEL_FILM=<file.mkv or .mp4>");
        let f = std::fs::File::open(&path).unwrap();
        let len = f.metadata().unwrap().len();
        let index = block_on(read_index(&mut File(f), len)).unwrap();
        for (t, b) in &index.keyframes {
            println!("{t:.3},{b}");
        }
    }

    #[test]
    fn a_byte_maps_to_the_time_between_its_keyframes() {
        let index = Index { keyframes: vec![(0.0, 100), (10.0, 500), (20.0, 1300)] };
        assert_eq!(index.time_at(500, 40.0, 2100), 10.0);
        assert_eq!(index.time_at(900, 40.0, 2100), 15.0);
        // Before the first keyframe, from the start; after the last, to the end.
        assert_eq!(index.time_at(50, 40.0, 2100), 0.0);
        assert_eq!(index.time_at(1700, 40.0, 2100), 30.0);
        assert_eq!(index.time_at(5000, 40.0, 2100), 40.0);
    }

    #[test]
    fn sizes_and_ids() {
        assert_eq!(vint_size(&[0x81]), Some((Some(1), 1)));
        assert_eq!(vint_size(&[0x40, 0x02]), Some((Some(2), 2)));
        assert_eq!(vint_size(&[0xFF]), Some((None, 1)));
        assert_eq!(vint_size(&[0x01, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF]), Some((None, 8)));
        assert_eq!(vint_id(&[0x1A, 0x45, 0xDF, 0xA3]), Some((id::EBML, 4)));
    }
}
