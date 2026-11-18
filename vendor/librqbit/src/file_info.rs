use std::path::PathBuf;

use librqbit_core::torrent_metainfo::FileDetailsAttrs;

#[derive(Debug, Clone)]
pub struct FileInfo {
    pub relative_filename: PathBuf,
    pub offset_in_torrent: u64,
    pub piece_range: std::ops::Range<u32>,
    pub attrs: FileDetailsAttrs,
    pub len: u64,
}

/// reel: a torrent's file name (its path components) as a path under the torrent's folder. On
/// Windows each component is made one Windows takes (`windows_name`): as it is, a component
/// `C:x` makes `PathBuf::push` replace the whole path (a file outside the folder), `a:b` writes
/// the stream `b` of file `a`, and a trailing dot or a device name (`CON`) is not the file asked.
pub(crate) fn local_path<'a>(components: impl Iterator<Item = std::borrow::Cow<'a, str>>) -> PathBuf {
    let mut path = PathBuf::new();
    for c in components {
        if cfg!(windows) {
            path.push(windows_name(&c));
        } else {
            path.push(&*c);
        }
    }
    path
}

/// reel: `name` as Windows takes it: `<>:"/\|?*` and control characters become `_`, no dot or
/// space at the end, `_` after the stem of a device name (`CON`, `nul.txt`, `COM1`, `LPT9`…).
/// The same on every system, so it is tested anywhere.
pub(crate) fn windows_name(name: &str) -> String {
    let clean: String = name
        .chars()
        .map(|c| if c.is_control() || r#"<>:"/\|?*"#.contains(c) { '_' } else { c })
        .collect();
    let clean = clean.trim_end_matches(['.', ' ']);
    let clean = if clean.is_empty() { "_" } else { clean };
    let stem_len = clean.find('.').unwrap_or(clean.len());
    let stem = clean[..stem_len].trim_end_matches(' ').to_ascii_uppercase();
    let mut chars = stem.chars();
    let head: String = chars.by_ref().take(3).collect();
    let tail: Vec<char> = chars.collect();
    let device = match (head.as_str(), tail.as_slice()) {
        ("CON" | "PRN" | "AUX" | "NUL", []) => true,
        ("COM" | "LPT", [d]) => d.is_ascii_digit() || "¹²³".contains(*d),
        _ => false,
    };
    if device {
        format!("{}_{}", &clean[..stem_len], &clean[stem_len..])
    } else {
        clean.to_owned()
    }
}

// Iterate file pieces in the following order: first, last, everything else from start to end.
fn iter_piece_priorities(range: std::ops::Range<usize>) -> impl Iterator<Item = usize> {
    // First and last of each file first, then the rest of pieces in that file.
    let r = range;
    use std::iter::once;

    let first = once(r.start);
    let last = once(r.start + r.len().overflowing_sub(1).0); // it's ok if it repeats, doesn't matter
    let mid = r.clone().skip(1).take(r.len().overflowing_sub(2).0);

    // The take(r.len()) is to not yield start/end pieces in case of 0 and 1 lengths.
    first.chain(last).chain(mid).take(r.len())
}

impl FileInfo {
    pub fn piece_range_usize(&self) -> std::ops::Range<usize> {
        self.piece_range.start as usize..self.piece_range.end as usize
    }

    pub fn iter_piece_priorities(&self) -> impl Iterator<Item = usize> {
        iter_piece_priorities(self.piece_range_usize())
    }
}

#[cfg(test)]
mod tests {
    use super::{iter_piece_priorities, windows_name};

    #[test]
    fn test_windows_name() {
        assert_eq!(windows_name("Film.2001.mkv"), "Film.2001.mkv");
        assert_eq!(windows_name("C:x"), "C_x");
        assert_eq!(windows_name("Title: Part 2?.mkv"), "Title_ Part 2_.mkv");
        assert_eq!(windows_name("Extras. "), "Extras");
        assert_eq!(windows_name("."), "_");
        assert_eq!(windows_name("CON"), "CON_");
        assert_eq!(windows_name("nul.txt"), "nul_.txt");
        assert_eq!(windows_name("com1.srt"), "com1_.srt");
        assert_eq!(windows_name("Console.mkv"), "Console.mkv");
        assert_eq!(windows_name("COM10"), "COM10");
    }

    #[test]
    fn test_iter_piece_priorities() {
        let it = |r: std::ops::Range<usize>| -> Vec<usize> { iter_piece_priorities(r).collect() };
        assert_eq!(it(0..0), Vec::<usize>::new());

        assert_eq!(it(0..1), vec![0]);
        assert_eq!(it(0..2), vec![0, 1]);
        assert_eq!(it(0..3), vec![0, 2, 1]);
        assert_eq!(it(0..4), vec![0, 3, 1, 2]);
    }
}
