//! A show's episodes numbered through its seasons, and whether a release holds an episode.
//!
//! Trackers often number a show's episodes from its first to its last, past the seasons:
//! a whole show labelled season 1 ("Supernatural / S1E1-327 of 327"), several seasons in one
//! pack ("Интерны / S7E121-180 of 280"), anime ("Naruto - 096"). TMDB numbers them per season.
//! The show's season sizes (TMDB's regular seasons) turn one into the other. See
//! docs/release-names.md.

use serde::{Deserialize, Serialize};

use crate::release::ReleaseInfo;

/// Where season s sits in the show's numbering: the number through the show of its first
/// episode, and how many it has. What `episode::pick` needs to read a pack numbered through.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Through {
    pub start: u16,
    pub size: u16,
}

impl Through {
    /// Episode `e`'s number in its season. TMDB numbers some shows' episodes through the show
    /// within each season (Naruto's season 2 runs 53–104): a number past the season's size that
    /// falls in its range is one of those.
    pub fn local(&self, e: u16) -> Option<u16> {
        if (1..=self.size).contains(&e) {
            Some(e)
        } else if (self.start..self.start + self.size).contains(&e) {
            Some(e - self.start + 1)
        } else {
            None
        }
    }

    /// Episode `e`'s number through the show.
    pub fn absolute(&self, e: u16) -> Option<u16> {
        self.local(e).map(|l| self.start + l - 1)
    }
}

/// Episodes per regular season, from season 1 (TMDB's); empty when not known.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Numbering(pub Vec<u16>);

impl Numbering {
    pub fn size(&self, season: u16) -> Option<u16> {
        self.0.get(season.checked_sub(1)? as usize).copied().filter(|n| *n > 0)
    }

    /// The number through the show of season `season`'s first episode.
    pub fn start(&self, season: u16) -> Option<u16> {
        let before = self.0.get(..season.checked_sub(1)? as usize)?;
        self.size(season)?;
        Some(before.iter().sum::<u16>() + 1)
    }

    /// The number through the show of (`season`, `episode`); `episode` may be the season's own
    /// number or, as TMDB numbers some shows, the show's (`Through::local`).
    pub fn absolute(&self, season: u16, episode: u16) -> Option<u16> {
        self.through_of(season)?.absolute(episode)
    }

    /// Season `season`'s place in the show's numbering.
    pub fn through_of(&self, season: u16) -> Option<Through> {
        Some(Through { start: self.start(season)?, size: self.size(season)? })
    }

    /// All the regular episodes.
    pub fn total(&self) -> Option<u16> {
        (!self.0.is_empty()).then(|| self.0.iter().sum())
    }

    /// The season and episode of the number through the show `n`.
    pub fn of_absolute(&self, n: u16) -> Option<(u16, u16)> {
        let mut first = 1u16;
        for (i, &size) in self.0.iter().enumerate() {
            if n >= first && n < first + size {
                return Some((i as u16 + 1, n - first + 1));
            }
            first += size;
        }
        None
    }

    /// The numbers through the show a release holds, when its name numbers them so: a whole
    /// show labelled season 1 ("S1E1-327 of 327": its total is the show's), or a pack whose
    /// first episode is where its season starts in the show's numbering ("S7E121-180": season
    /// 7 starts at 121). Only on such evidence: a season's own range, or a total that does not
    /// match the show, is not.
    pub fn through(&self, info: &ReleaseInfo) -> Option<std::ops::RangeInclusive<u16>> {
        let (first, last) = (*info.episodes.first()?, *info.episodes.last()?);
        let season = info.season?;
        let whole = season == 1 && first == 1 && info.total.is_some() && info.total == self.total() && last > self.size(1)?;
        let from_start = season > 1 && first > 1 && Some(first) == self.start(season);
        (whole || from_start).then_some(first..=last)
    }
}

/// Whether a release (what its name says) holds what is asked for: `Named` the exact episode or
/// the season's pack, `Pack` it may hold it (a pack without episode numbers), `No` not this.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Holds {
    /// It names the episode (or the season, for a season asked for).
    Named,
    /// A pack of the season that does not number its episodes: it may hold it.
    Pack,
    No,
}

/// Whether `info` holds season `season` (its episode `episode`, when asked), with the show's
/// numbering. The one decision both the search's ranking and Play's check make.
pub fn holds(info: &ReleaseInfo, season: u16, episode: Option<u16>, n: &Numbering) -> Holds {
    if let Some(range) = n.through(info) {
        return match episode {
            Some(e) => match n.absolute(season, e) {
                Some(a) if range.contains(&a) => Holds::Named,
                _ => Holds::No,
            },
            None => match (n.start(season), n.size(season)) {
                (Some(s), Some(size)) if *range.start() <= s + size - 1 && s <= *range.end() => Holds::Pack,
                _ => Holds::No,
            },
        };
    }
    // The season's own number of the episode (TMDB numbers some shows through the show).
    let episode = match (episode, n.through_of(season)) {
        (Some(e), Some(t)) => match t.local(e) {
            Some(l) => Some(l),
            None => return Holds::No,
        },
        (e, _) => e,
    };
    match episode {
        Some(e) => match info.season {
            Some(s) if s != season => Holds::No,
            _ if info.episodes.contains(&e) => Holds::Named,
            Some(_) if info.episodes.is_empty() => Holds::Pack,
            _ => Holds::No,
        },
        // A season: its packs (no episodes named, or several) name it; a single episode of it,
        // or a name without a season (a show's only one), may hold it.
        None => match info.season {
            Some(s) if s != season => Holds::No,
            Some(_) if info.episodes.len() != 1 => Holds::Named,
            Some(_) => Holds::Pack,
            None if info.episodes.is_empty() => Holds::Pack,
            None => Holds::No,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::release::parse;

    fn supernatural() -> Numbering {
        // 15 seasons, 327 episodes.
        Numbering(vec![22, 22, 16, 22, 22, 22, 23, 23, 23, 23, 23, 23, 23, 20, 20])
    }

    #[test]
    fn numbers_through_the_show() {
        let n = supernatural();
        assert_eq!(n.total(), Some(327));
        assert_eq!(n.absolute(1, 1), Some(1));
        assert_eq!(n.absolute(2, 1), Some(23));
        assert_eq!(n.absolute(15, 20), Some(327));
        assert_eq!(n.absolute(1, 23), None, "past the season");
        // TMDB numbers some shows through within each season: S2E23 is S2E1.
        assert_eq!(n.absolute(2, 23), Some(23));
        assert_eq!(n.absolute(2, 45), None);
        assert_eq!(n.of_absolute(23), Some((2, 1)));
        assert_eq!(Numbering::default().absolute(1, 1), None);
    }

    #[test]
    fn a_whole_show_labelled_season_one_holds_every_season() {
        let n = supernatural();
        let pack = parse("Сверхъестественное / Supernatural / S1E1-327 of 327 (…) [2005-2020]");
        assert_eq!(holds(&pack, 5, Some(3), &n), Holds::Named);
        assert_eq!(holds(&pack, 2, None, &n), Holds::Pack);
        // Without the show's numbering it is what it says: season 1.
        assert_eq!(holds(&pack, 5, Some(3), &Numbering::default()), Holds::No);
        // A season's own pack stays that season's.
        let s1 = parse("Сверхъестественное / Supernatural / S1E1-22 of 22 (…) [2005]");
        assert_eq!(holds(&s1, 1, Some(22), &n), Holds::Named);
        assert_eq!(holds(&s1, 2, Some(1), &n), Holds::No);
        // An episode TMDB numbers through the show (S2E23) is its season's first.
        let s2 = parse("Сверхъестественное / Supernatural / S2E1-22 of 22 (…) [2006]");
        assert_eq!(holds(&s2, 2, Some(23), &n), Holds::Named);
        // A total not the show's: not this show numbered through.
        let other = parse("Show / S1E1-500 of 500");
        assert_eq!(holds(&other, 2, Some(1), &n), Holds::No);
    }

    #[test]
    fn a_pack_of_several_seasons_numbered_through() {
        // Интерны: 14 seasons of 20.
        let n = Numbering(vec![20; 14]);
        let pack = parse("Интерны / S7E121-180 of 280 (Радда Новикова) [2012-2013, комедия, SATRip]");
        assert_eq!(holds(&pack, 8, Some(3), &n), Holds::Named);
        assert_eq!(holds(&pack, 9, None, &n), Holds::Pack);
        assert_eq!(holds(&pack, 10, Some(1), &n), Holds::No);
        assert_eq!(holds(&pack, 7, Some(1), &n), Holds::Named);
    }

    #[test]
    fn a_season_spanning_two_years_stays_one_season() {
        let n = Numbering(vec![6, 22, 25]);
        let s2 = parse("Офис / The Office / S2E1-22 of 22 (…) [2005-2006, США]");
        assert_eq!(holds(&s2, 2, Some(20), &n), Holds::Named);
        assert_eq!(holds(&s2, 1, Some(1), &n), Holds::No);
    }
}
