---
name: ui-design
description: Design and build UI for reel (torrent movie player on Samsung Tizen TV, Android/Android TV, iOS, macOS, built with NSH). Use before designing a screen, writing UI code in app/, choosing colors, type or spacing, or adding a component to the ui/ layer. Covers the two-pass design process, the list of generic defaults we refuse, 10-foot TV rules, D-pad focus, and NSH styling rules.
---

# reel UI

reel must not look generated. Every screen is a decision for *this* product: watching films
from torrents at home, on a couch, often in the evening, with a remote; and the same app on a
phone and a Mac.

Read `design/brief.md` (what and for whom) and `design/directions.md` (the chosen direction and
its tokens) first. The direction's tokens and principles win over anything below.

## Process: two passes

1. **Plan before code.** For a new screen or component write a short plan into the PR or
   `design/`: what the screen is for (one job), the elements by priority, an ASCII wireframe for
   the TV (1920×1080) and the phone, which tokens it uses, and where focus starts and goes.
2. **Review the plan against this file.** If any part is what you would produce for any
   streaming app, change it and say what you changed.
3. **Build, then look.** Render the screen (macOS app, `nsh test --target web` screenshots, or the
   TV) and critique the screenshot, not the code. Remove one thing before calling it done.

## Generic defaults we refuse

Unless `design/directions.md` explicitly asks for one of them:

- Netflix / Prime layout: hero banner with a gradient fade to black, then identical poster rows
  with a scale-up on focus.
- Frosted glass panels, blur everywhere (also: TV-Store already uses dark glass; reel is not it).
- Near-black with tint (#0B0B0B, #111, #121212) standing in for black; one acid-green or
  vermilion accent on near-black; warm cream (#F4F1EA) with terracotta (#D97757).
- Identical rounded cards with the same soft shadow; one border-radius on everything; gradient
  washes as decoration.
- ALL-CAPS tracked eyebrow labels over headings; one word accented in a headline;
  `A · B · C` meta strings; `→` appended to buttons; monospace for small data labels;
  `01 / 02 / 03` markers on things that are not a sequence.
- Inter, Roboto, SF/system UI as the brand face; purple gradients.
- Entrance animations on every section; hover transitions on everything.

## Spend boldness in one place

Each direction has one memorable element (see `design/directions.md`). Everything around it is
quiet: consistent spacing, few sizes, no decoration that carries no information. Structure must
encode information: a divider separates groups that really differ, numbers only for sequences.

## TV (10-foot) rules

- Canvas 1920×1080 logical. Keep content inside the 5% title-safe inset (96 px left/right,
  54 px top/bottom).
- Minimum text 28 px at 1080p for anything that must be read; body 32–36 px; titles 56 px+.
- Low density: at most ~6 posters visible in a row, at most 3 rows on a screen.
- Only four arrows, OK and Back. Everything reachable with them; no hidden pointer-only actions.
- Layout is a grid. No diagonal neighbours: pressing a direction must have one obvious target.
- **Focus** is the strongest visual signal on screen, identical in every screen, and different
  from **selected** (e.g. the active tab or the chosen audio track). Never show focus with color
  alone; it needs a shape change (outline, offset, lift, light).
- Focus memory: returning to a row focuses the item you left, not the first one.
- Back always goes one level up; on the root screen it asks before exiting. Back closes overlays
  first.
- Every press answers within 100 ms visually; anything slower shows progress in place.
- Night viewing: no large pure-white areas; avoid big flat bright backgrounds.

## Phone and Mac

Same tokens and components, different density (`compact` phone, `regular` Mac, `ten-foot` TV).
Phone: thumb-reachable primary actions, tab bar, sheets instead of side panels. Mac: pointer and
keyboard; arrows use the same spatial navigation as the TV.

## NSH rules (from nsh.dev Coding Guides)

- Build `app/ui/` (styled components over `nsh/base`) and the theme before pages.
- Colors only from theme tokens (`theme()`, `token(...)`, token classes). No hex, rgb or palette
  classes outside the theme file.
- State styles: `focus-visible:` for remote/keyboard focus, `selected:`, `active:`, `disabled:`;
  focus and selected must look different.
- Use `onPress`, `Button` for commands, one store function per command.
- Lists of posters use `List` / `virtual_list` with stable keys (torrent info-hash or TMDB id).
- Platform differences go through `web:`/`ios:`/`android:`/`macos:` classes or platform props,
  always with a default branch.
- Respect `fontScale()`; containers grow with text.

## Copy

Plain words from the viewer's side: "Watch", "Keep downloading", "Choose a file", not "Add
torrent to session". An action keeps its name through the flow. Errors say what happened and
what to do ("No one is sharing this file right now. Try another release."), without apology.
Empty screens invite an action. Sentence case everywhere.
