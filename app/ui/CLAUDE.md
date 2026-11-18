# reel UI (`app/ui`)

Paths are from the repo root.

- Design rules: `.claude/skills/ui-design/SKILL.md` and `design/directions.md` (the newest
  direction wins). Mockups in `design/concept/`.
- TV first: everything works with arrows, OK and Back; focus (white ring + lift) differs from
  selected (lighter fill + check); leave `ringRoom()` around items in scroll views.
- Small components and named style helpers; no long inline style objects in markup.
- Screens render content only, inside `PageFrame` (`app/ui/layout/PageFrame.tsx`): it places
  what is over and under a page (nav, heads, Back, the status bar's scrim), the page's title and
  the room under it, from `layout/metrics.ts`. Sideways rows are `Rail`; touch targets reach
  44 / 48 pt through `theme.targetSlop`. A screen never reads `safeArea`, `ringRoom`, the family
  or positions overlays: `dev/ui-rules.sh` checks it (a hook in `.claude/settings.json` runs it
  after each edit here).
