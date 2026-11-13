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
│  Продолжить с 1:12:40          [ Смотреть ]                   │
│                                                               │
│  Продолжить                                                   │
│  [▣] [▢] [▢] [▢] [▢] [▢]      ← focused poster lit by beam    │
│  Качается                                                     │
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
`.claude/skills/ui-design/SKILL.md` for: hero with gradient fade, floating pill nav, rounded
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
