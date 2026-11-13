//! Which file of a multi-file torrent is a given episode.

use super::release;

const VIDEO: [&str; 8] = ["mp4", "m4v", "mov", "mkv", "webm", "avi", "ts", "m2ts"];

pub fn is_video(name: &str) -> bool {
    name.rsplit_once('.').is_some_and(|(_, ext)| VIDEO.iter().any(|v| ext.eq_ignore_ascii_case(v)))
}

/// The file (index into the torrent) to play: for an episode, the video whose
/// name says that season and episode; failing that, in a season pack whose
/// names carry no numbers we can read, the `episode`-th video in name order;
/// for a film, the largest video. `files` are (index, path, length).
pub fn pick(files: &[(usize, String, u64)], episode: Option<(u16, u16)>) -> Option<usize> {
    let videos: Vec<&(usize, String, u64)> = files.iter().filter(|(_, n, _)| is_video(n)).collect();
    let Some((season, ep)) = episode else {
        return videos.iter().max_by_key(|(_, _, len)| *len).map(|(i, _, _)| *i);
    };

    // A file named for exactly this episode (the season may only be in a folder name).
    let named = videos.iter().find(|(_, path, _)| {
        let file = path.rsplit(['/', '\\']).next().unwrap_or(path);
        let info = release::parse(file);
        let folder = release::parse(path);
        let season_ok = info.season.or(folder.season).is_none_or(|s| s == season);
        season_ok && info.episodes.contains(&ep)
    });
    if let Some((i, _, _)) = named {
        return Some(*i);
    }

    // Episodes numbered without SxxEyy: "03 - Title.mkv", "[03].mkv", "E03.mkv".
    let by_number = videos.iter().find(|(_, path, _)| {
        let file = path.rsplit(['/', '\\']).next().unwrap_or(path);
        leading_number(file) == Some(ep)
    });
    if let Some((i, _, _)) = by_number {
        return Some(*i);
    }

    // Last resort: the n-th video in name order, only when no name carries
    // episode numbers (otherwise a missing episode would pick a wrong one).
    let numbered = videos.iter().any(|(_, path, _)| !release::parse(path).episodes.is_empty());
    if numbered {
        return None;
    }
    let mut sorted: Vec<_> = videos.into_iter().collect();
    sorted.sort_by(|a, b| a.1.cmp(&b.1));
    sorted.get(ep.checked_sub(1)? as usize).map(|(i, _, _)| *i)
}

/// A number the file name starts with, after brackets or an E: "03 - …", "[03] …", "E03 …".
fn leading_number(file: &str) -> Option<u16> {
    let s = file.trim_start_matches(['[', '(', ' ', '_', '-']);
    let s = s.strip_prefix(['E', 'e']).unwrap_or(s);
    let digits: String = s.chars().take_while(|c| c.is_ascii_digit()).collect();
    if digits.is_empty() || digits.len() > 3 {
        return None;
    }
    // Not a year or a resolution.
    let next = s[digits.len()..].chars().next();
    if matches!(next, Some('p' | 'P' | 'i')) {
        return None;
    }
    digits.parse().ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn files(names: &[&str]) -> Vec<(usize, String, u64)> {
        names.iter().enumerate().map(|(i, n)| (i, n.to_string(), 1000 + i as u64)).collect()
    }

    #[test]
    fn film_takes_the_largest_video() {
        let f = vec![(0, "a/sample.mkv".into(), 10), (1, "a/film.mkv".into(), 900), (2, "a/cover.jpg".into(), 5000)];
        assert_eq!(pick(&f, None), Some(1));
    }

    #[test]
    fn episode_by_sxxeyy() {
        let f = files(&["Show S01/Show.S01E01.mkv", "Show S01/Show.S01E02.mkv", "Show S01/Show.S01E03.mkv", "Show S01/poster.jpg"]);
        assert_eq!(pick(&f, Some((1, 2))), Some(1));
        assert_eq!(pick(&f, Some((2, 2))), None, "another season is not in this pack");
        assert_eq!(pick(&f, Some((1, 9))), None, "a missing episode is not a guess");
    }

    #[test]
    fn episode_by_leading_number_or_order() {
        let f = files(&["Season 1/01 - Planet of Peril.mkv", "Season 1/02 - The Tunnel of Terror.mkv"]);
        assert_eq!(pick(&f, Some((1, 2))), Some(1));
        let plain = files(&["Season 1/a.mkv", "Season 1/b.mkv", "Season 1/c.mkv"]);
        assert_eq!(pick(&plain, Some((1, 3))), Some(2));
        assert_eq!(pick(&plain, Some((1, 9))), None);
    }

    #[test]
    fn numbers_that_are_not_episodes() {
        assert_eq!(leading_number("1080p.mkv"), None);
        assert_eq!(leading_number("1936 Flash.mkv"), None);
        assert_eq!(leading_number("[07] Title.mkv"), Some(7));
        assert_eq!(leading_number("E12.mkv"), Some(12));
    }
}
