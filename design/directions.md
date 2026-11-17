# Direction: "Projector"

Concept-stage direction, kept deliberately simple. One idea: **the room is dark and the screen is
the only light.** The UI is dim and warm; whatever has focus is lit, as if the projector beam
landed on it. That is our one memorable element; everything else stays quiet.

## Tokens

| Token | Hex | Role |
|---|---|---|
| `hall` | `#221A20` | background: dark plum-brown, a dimmed cinema hall, not neutral near-black |
| `seat` | `#33262E` | raised surfaces: sheets, player panels |
| `line` | `#4A3A43` | dividers, inactive outlines |
| `screen` | `#EDE4D8` | primary text, warm like light reflected from a screen |
| `dim` | `#A8998F` | secondary text |
| `beam` | `#F3C766` | focus and the single accent: projector lamp |
| `alert` | `#E5684F` | errors, nobody sharing |

Radius: `control` 10, `poster` 6 (posters are prints, nearly square corners), `sheet` 20.

Densities: `compact` (phone), `regular` (Mac), `ten-foot` (TV, ×1.75 type and spacing).

## Type

- **Unbounded** (wide display, Cyrillic): film titles on the film screen and section titles only.
- **Golos Text** (Cyrillic, built for screens): everything else.

TV scale: 28 caption · 34 body · 44 subtitle · 72 title. Phone: 13 · 16 · 20 · 32.

## Focus (the memorable element)

Focused item: lifts 8 px, gets a 4 px `beam` outline offset 6 px, its image brightens; the rest of
its row dims to 70%. Selected (active tab, chosen track): `screen` underline, no light. Focus moves
with a 120 ms ease, nothing else animates on its own.

## Home on TV

```
┌──────────────────────────────────────────────────────────────┐
│  [still of the focused film, dimmed, right 60%]               │
│  Metropolis                                                   │
│  1927 · 2 h 33 min                     ← title block left     │
│  Resume from 1:12:40           [ Watch ]                      │
│                                                               │
│  Continue watching                                            │
│  [▣] [▢] [▢] [▢] [▢] [▢]      ← focused poster lit by beam    │
│  Loading                                                      │
│  [▢ 34%] [▢ 81%]                                              │
└──────────────────────────────────────────────────────────────┘
```

Left aligned throughout. Rows are shelves of posters; no hero carousel.

## Review against the refused defaults

- Background is plum-brown, not #111; the accent is lamp yellow, not acid green or terracotta.
- No glass, no gradient washes; the only "effect" is the focus light, and it carries information.
- The top block looks like a streaming hero; kept because it shows the focused film, but no
  gradient fade to black and no auto-rotating banner.

## Code structure

Follow the NSH gallery example (`examples/gallery`): a separate ui package with a `colors` object,
`radius`, `alpha()`, `focusRing()`, `hovered()` helpers, and components over `nsh/base`. Our values
are the tokens above.

---

# Direction 2: Cinematic (from user references)

Built from the references the user picked (flystream.net, bingebox.st). **Supersedes Projector
where they conflict** (hero, palette, poster shape, navigation); Projector's restraint rules still
apply elsewhere. The user's references also override the "refused defaults" list in
the design rules (the generic defaults reel refuses) for: hero with gradient fade, floating pill nav, rounded
posters with badges. Mockups: `design/concept/*.html`, renders in `design/concept/png/`
(`design/concept/scripts/render.sh`), images in `design/concept/img/` (public domain, see
`CREDITS.md`, fetched by `scripts/commons_fetch.py`).

## Tokens

| Token | Hex | Role |
|---|---|---|
| `night` | `#0A0F1C` | background, blue-black |
| `deck` | `#141B2D` | raised surfaces: panels, release rows |
| `rule` | `#26304A` | lines, empty progress tracks |
| `paper` | `#F2F4F8` | text, the Play pill, focus |
| `mist` | `#8B94A9` | secondary text |
| `lamp` | `#F5B83D` | the one accent: rating, "ready ahead" in the player, "selected" marks, glow |

Health of a release (people sharing): green `#4ADE80`, amber `#F59E0B`, red `#F87171`, as signal
bars, never as the only cue (always with the count).

Radius: posters 20 (TV) / 16 (phone, Mac), panels 28, rows 18, buttons and nav fully round.

## Type

- **Big Shoulders Display** 900: the film's title as a logo, uppercase, large. A film may override
  it with its own period face when that is its identity (Nosferatu in UnifrakturMaguntia); the app
  never uses it for UI text.
- **Onest** 400–700: all UI text.

TV: title 128–150, section 38, body 28, caption 24. Mac: title 104, section 20, body 16.
Phone: title 68, section 19, body 15.

## Layout

- Full-bleed hero still of the featured film, subject on the right (mirror the still if needed),
  dark gradients left and bottom, a lamp-coloured radial glow behind the subject.
- Floating pill nav centered at the top: logo, Home, Movies, Series, My list,
  search, settings. Phone: the same pill as a bottom tab bar.
- Hero block left: title, meta (rating, year, genre, runtime), 2 lines about, the release that Play
  will use (quality, size, people sharing), white Play pill + round secondary buttons.
- Shelves of portrait posters with quality and rating badges; Continue watching has a watched
  track under each poster. No downloads screen: reel streams only.
- Film screen: release list sorted by how fast it starts (quality, source, size, tracks, people
  sharing, a plain-words note: "Plays now", "Needs 25 Mbit/s", "Few people sharing").
- Player: scrubber shows watched (paper), ready (lamp) and not loaded yet (grey) ranges, with a line
  "6 min ready ahead, streaming at 3.4 MB/s from 37 people"; Audio, Subtitles and Release in
  one panel.

## Focus and selected (TV remote)

- **Focus** is always `paper`: posters and rows get a 4–5 px `paper` ring with offset plus a lift
  (posters translate −10 px and scale 1.05; rows scale 1.01) and a deep shadow; list options in
  panels fill with `paper` and switch text to `night`. Everything else in the row stays at 78%.
- **Selected** is always `lamp` and never a ring: a check mark, a lamp bar on the left of a row, a
  lamp underline on a button, a lighter pill in the nav.
- Mac uses hover instead of focus for the pointer (lift + play disc on the poster); keyboard focus
  on Mac uses the TV focus ring.

---

# Direction 3: Minimal (movy)

Built from the user's reference movy.sx. **Supersedes Cinematic and Projector where they conflict**
(palette, type, nav, hero, cards, focus colours); their reel-specific content rules (release line,
releases sorted by start speed, buffer-aware scrubber, no downloads) still apply. Like Cinematic,
the user's reference overrides the "refused defaults" in the design rules (the generic defaults reel refuses) for:
near-neutral black, a hero fading to black, a neo-grotesque UI face. The mockups in
`design/concept/*.html` now show this direction; shared tokens live in `design/concept/minimal.css`.

One idea: **the film is the only colour on screen.** The UI is black, white and grey; stills and
posters carry all the colour. Red appears only in the logo, the rating star and "New season" tags.

## Tokens

| Token | Hex | Role |
|---|---|---|
| `ink` | `#0F0F0F` | background |
| `card` | `#1A1A1A` | raised surfaces: episode and release rows, filter chips, panels, icon buttons |
| `raise` | `#2A2A2A` | selected pill or row, secondary button, outlined badge border, empty tracks |
| `snow` | `#F5F5F5` | text, the Play button, the focus ring, watched range |
| `ash` | `#8C8C8C` | secondary text: votes, genres, meta, notes |
| `red` | `#E5383B` | logo, rating star, "New season" / "New episode" tag; nothing else |

No glow, no blur, no gradient except the backdrop fading into `ink`. People sharing is shown as
four monochrome signal bars plus the count, never as colour.

Radius: buttons, rows, cards and posters 10 (TV) / 8 (Mac, phone); badges 4; icon buttons round.

## Type

- **Geist** for everything (300–600). Modest sizes and lots of air.
- The film's title is a logotype: Geist 200, uppercase, tracking 0.22em. Smaller over-image titles
  on browse cards use the same treatment at 300.

TV: title 76–96, page title 60, section 30, body 26, meta 22–24 (nothing below 20). Mac: title
52–56, section 18, body 15, meta 13. Phone: title 34, section 16, body 13, meta 11.5–12.5.

## Layout

- **Nav**: logo top-left in `red`; top-right a compact pill group Home, Movies, Shows (icon + label,
  the selected item gets a lighter pill), then round search and profile buttons. Phone: the same
  four destinations as a bottom tab bar (Home, Movies, Shows, My list). Detail screens replace the
  logo with a round back button.
- **Home**: full-bleed still of the featured film in the top ~70%, fading to `ink`; bottom-left the
  logotype, meta line (★ rating, votes, year, runtime, outlined badges like `1080p`, `CC`), genres,
  2-line description, the **release line** (quality bold, size, people sharing, "starts in
  seconds"), white Play/Resume and grey "My list" buttons. Below: "Continue watching" as 16:9
  cards with a thin watched bar, title and "1 h 12 min left" or "S3:E4 · 7 min left".
- **Browse (Movies, Shows)**: page title + grey subtitle; a "Trending" ("Current & upcoming" for
  shows) row of 2:3 posters with title and "★ 8.3 · 1927 · Movie" (shows: "S3:E5 · Nov 20");
  then "All movies"/"All shows" with filter chips (Genres, Years, Countries) left and "Sort by:
  Most popular" right, and a grid of 16:9 backdrop cards with the title over the image, title and
  "★ rating · year · type/seasons" under it, an optional red "New season"/"New episode" tag.
- **Film**: hero as on home with a back button; the release line sits next to Play and Add to
  List. Below: "Releases, N found, fastest to start first", one row per release (quality badge,
  source, size, tracks, signal bars + count, a plain note: "Starts fastest", "Plays now", "Needs
  25 Mbit/s", "Few people sharing").
- **Series**: hero as for a film, meta says "1936–1940 · 3 Seasons", Play says "Resume S3:E4",
  the release line names the season pack. Below: season tabs ("Season 1 1936" …, selected = lighter
  pill) with "12 episodes · <season title>" under them; on the right round icon buttons for episode
  search, sort and list/grid view.
- **Episodes**: full-width `card` rows: big light-weight grey number, 16:9 thumbnail with "★ 7.2"
  in its bottom-left and a watched bar, then title (bold), "19 min · Apr 24, 1940", one line of
  description. The right edge holds torrent info in `ash` ("1080p · plays now") or "✓ Watched".
  No download button anywhere: reel streams only.
- **Player**: top-left back + title + "1080p BluRay · resumed from 41:12"; Audio, Subtitles and
  Release in one dark panel (no blur). Bottom: "**6 min ready ahead** · streaming at 3.4 MB/s from
  37 people", the scrubber with watched (`snow`), ready (`snow` 45%) and not loaded yet (`snow` 16%)
  ranges, times, then one control row of round icon buttons: −10 s, play/pause, +10 s and,
  after a gap, Audio and subtitles. Icon buttons have no visible labels; the focused one shows a
  small tooltip-style label above it ("Audio and subtitles"). While its panel is open the button
  stays in the lighter selected fill and focus moves into the panel. No legend under the scrubber,
  no permanent "Up next" button.
- **Up next** (`tv-player-end`): for an episode, a card appears bottom-right about 40 s before the
  end or when the credits start; the rest of the controls stay hidden. It shows the next episode's
  thumbnail, "Next episode · S3:E5", its title, "20 min · first 3 min ready, plays instantly"
  (the engine starts fetching it while the card is up), a focused white "Play now · in 6 s" whose
  countdown runs as a thin bar along its bottom, and "Watch credits", which dismisses the card. Back
  also dismisses it. For a single film reel recommends nothing: at the credits the player just
  ends and returns to the film screen.

## Focus and selected

- **Focus** (TV remote, Mac keyboard) is a 3 px `snow` ring with 4–5 px offset plus a lift (cards
  translate −8 px; rows and options scale 1.01–1.03) and a deep shadow. It is the only ring on
  screen and looks the same everywhere.
- **Selected** (active nav item, season tab, view toggle, the release Play will use, a chosen track)
  is a lighter fill (`raise`, `#333` on the nav) plus a check where it is a choice. Never a ring.
- Mac pointer hover: the row or card gets slightly lighter and a white play disc appears on the
  thumbnail; no ring.
