# How releases and their files are named

What a search source returns and what is inside its torrents, and how the core reads them
(`reel_domain::release::parse` for titles and paths, `reel_domain::episode::pick` for the file of an
episode, `sources::fit` for whether a release holds the episode asked for).

Surveyed 2026-11-20: 60 releases, the 3 most seeded of each of 20 titles: Supernatural, Friends,
The Office, Breaking Bad, Game of Thrones, The Simpsons, Doctor Who, House, Lost, Dexter, Rick and
Morty, Stranger Things, The Witcher, Интерны, One Piece, Naruto, Attack on Titan, Frieren, Bleach and
Jujutsu Kaisen. The source was a Torznab bot over rutracker. Only the file lists were read, through
librqbit's `list_only`.

## Release titles

The source passes rutracker's titles through Jackett. Jackett rewrites the ones in TV categories
into `S…E…`, but not the ones in anime categories.

| Kind | Example | Read as now |
|---|---|---|
| One season | `Офис / The Office / S2E1-22 of 22 (…) [2005-2006, …]` | season 2, episodes 1–22 ✓ |
| One season, other count | `Во все тяжкие / Breaking Bad / S1E1-7 (7) (…)` | ✓ |
| Season not finished | `Декстер: Воскрешение / … / S2E1-3 of 10` | episodes 1–3 ✓ |
| Specials as episode 0 | `Доктор кто / Doctor Who / S2E0-13 of 13` | episodes 0–13 ✓ |
| **The whole show, labelled season 1** | `Supernatural / S1E1-327 of 327 [2005-2020]`, `Game of Thrones / S1E1-73 of 73 [2011-2019]` | season 1, episodes 1–327 ✗: never offered for seasons 2+ |
| **The whole show, seasons named** | `Игра Престолов / … / Сезоны: 1-8 / E1-73 of 73` | no season, no episodes ✗ |
| **Several seasons, numbered through** | `Интерны / S7E121-180 of 280 [2012-2013]` (seasons 7–9) | season 7, episodes 121–180 ✗ |
| Anime, one season | `Атака титанов (S1) / … [TV] [E25 of 25]` | season 1, a pack ✓ (episodes not read) |
| Anime, part of a season | `Атака титанов (S3, часть 1) / … [TV] [E12 of 12]` | season 3, a pack (part 1 of 2) |
| **Anime, numbered through** | `Naruto Shippuuden (S2) [TV] [362-500 из 500]`, `[001-053 из 500]` | season 2, a pack ✗: the range is not read |
| Anime with specials | `Фрирен (S1) [TV+Special] [E28+11 of 28+11]` | season 1, a pack |
| **Anime, the tracker's season ≠ TMDB's** | `Блич: Тысячелетняя кровавая война - Бедствие (S2, часть 4)`, whose files are `S04E01…` | season 2 ✗: no file matches |

## File names

| Kind | Example | Picked now |
|---|---|---|
| `Name.SxxEyy…` (most western releases) | `The.Office.US.S02E01.The.Dundies.1080p…mkv` | ✓ |
| Dotted `S01.E01` | `Breaking.Bad.S01.E01.BDRip.1080p-SOFCJ.mkv` | ✓ |
| In brackets | `Season 01/GOT.[S01E01].2xRu.En.[qqss44].mkv` | ✓ |
| A folder per season | `GOT.S01/GOT.S01E01…`, `Season 01/…`, `01 сезон/…` | ✓ |
| Underscore after the number | `Season_01/s01e01_Pilot.avi` | ✓ since #29 (`_` read as a space) |
| `Title SS - EE - Name` | `Доктор кто 02 - 01 - Новая Земля.mkv` | ✓ |
| Anime: `[Group] Title - 01 [tags]`, `Title 01.mkv`, `Title S3 - 01` | `[SOFCJ-Raws] Bleach - Sennen Kessen-hen - 01 [WEB-DL KP 1080p].mkv` | ✓ only through the last resort (the n-th file in name order) |
| **Anime numbered through** | `NARUTO Shippuuden 362 RAW.mp4`, `[SOFCJ-Raws] Naruto - 096 (…).mkv` | ✗ when the pack does not start at 1 |
| **Numbered through, in season folders** | `07 сезон/Интерны_121.avi` | ✗ for anything past the first season of the pack |
| **Extras beside the episodes** | `OP-ED [Creditless]/Endings/… Naruto ED - 01 …`, `Special/… Sousou no Frieren - 01 …`, `Extras/…Promo…` | ✗: Naruto's E1 picks the first ending, Frieren's E1 a special |

## What the core picks now (with #29)

- **Right:** all 33 releases of one western season, the whole-show packs for their first season,
  the anime packs of one season named `S1 - E01` or `Title - 01`, and Frieren 1080p WEB.
- **Never offered:** a whole-show pack (Supernatural 327, Game of Thrones 73) for seasons 2 and on.
  `fit` sees "season 1 ≠ 2".
- **The wrong file:**
  - Naruto: E1 → `ED - 01`, E23 → `OP - 07`, E121 → episode 96.
  - Naruto Shippuuden 001–053: E1 → `ED 01`.
  - Frieren with specials: E1 → `Special/… - 01`.
  - Интерны S7–9: S7E23 → episode 143, which is S8E3.
- **No file:** Bleach TYBW "S2 part 4", whose files are `S04E01…`.

## What it takes

1. **Leave extras out of the episodes.** Skip folders or names with OP, ED, NCOP, NCED, Creditless,
   Opening, Ending, Special(s), SP, OVA (unless asked), Extras, Bonus, Trailer, Promo and Sample.
   Fixes Naruto and Frieren.
2. **Read the numbers anime titles and files use.**
   - Titles: `[E25 of 25]`, `[001-053 из 500]`, `[362-500 из 500]`, `[01-28 из 28]` → episode ranges.
   - Files: the number after ` - ` or after the title (`Title - 01 [..]`, `Title 01.mkv`,
     `Shippuuden 362`). Read as a number, not only the n-th file in order.
3. **Numbering through a show (absolute).**
   - The core knows each season's size from TMDB (Supernatural: 22, 22, 16, …).
   - S2E1 is the show's episode 23.
   - A release whose range is past its season's size, or that names several seasons ("Сезоны: 1-8",
     a year range), is a pack of the whole show, or of several seasons, numbered through.
   - `fit` maps the episode asked for to its absolute number. `pick` looks for `SxxEyy` first (the
     files often have it: Supernatural, Game of Thrones), then the absolute number (Интерны, Naruto).
   - The same mapping is the long-anime item in `docs/todo.md`: One Piece's episode 1050 vs TMDB's S21E58.
4. **The file's season wins over the title's.**
   - When the files carry `SxxEyy`, they decide which season a pack is.
   - Bleach TYBW: the tracker's "S2, part 4" is TMDB's season 4 in the files.
   - Anime parts (`(S3, часть 1)`) are one TMDB season split into parts: map them through the
     anime entries (`AnimeEntry.episode_offset`, AniList ↔ TMDB).
