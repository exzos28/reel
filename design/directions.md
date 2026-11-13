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
