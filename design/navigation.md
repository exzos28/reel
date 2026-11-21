# Navigation: where you are and how you go back

Status: concept, for review. Direction 3 "Minimal" (`design/directions.md`) for the look.
Mockups: `design/concept/navigation/{tv,desktop,tablet,phone}.html` (one board per platform
family, every frame at real size). Render one PNG per frame, outside the repo:

```
design/concept/navigation/render.sh <out-dir> [tv|desktop|tablet|phone ...]
```

## The problem today

Back was patched in per screen: a round button floating over the hero (title), beside the page
title (Settings, About, Search), in the Mac title bar beside the traffic lights (every deep page
on macOS), another one in the player; the nav exists only on Home/Movies/Series/Anime and scrolls
away; Search and Settings are nav items but open as deep pages with a back button; on the TV a
"back" focus zone sits above the title's actions; no phone or tablet layout at all.

## Rules for every platform

1. **One place for Back per platform**, the same spot on every page of that platform. Never a
   back button beside a page title, never one floating in a corner of the content on the TV or
   the desktop.
2. **The nav answers "where am I".** The current destination is always shown in the selected
   fill (`nav` token, `#333`), on deep pages too where the nav is visible: a title opened from
   Movies keeps Movies selected (the page's *section*).
3. **Destinations are roots.** Home, Movies, Series, Anime, Search, Settings are nav
   destinations (Settings on touch is the exception, see below). A root has nothing to go back
   to on desktop and touch; Back is disabled (macOS) or absent (others).
4. **Back closes before it leaves**, in this order: keyboard/text input → open panel or sheet
   (release panel, audio and subtitles) → Up next card → player controls (TV only) → the page.
5. **Back restores focus.** Returning to a page puts the focus (TV, keyboard) on the item that
   opened the page above it and the scroll where it was.
6. **Re-selecting the current destination** (OK / click / tap on the selected item) pops to its
   root and scrolls to the top.

## Platform families

| | TV (Tizen, Android TV) | Desktop (macOS, Windows, Linux) | Tablet (iPadOS, Android) | Phone (iOS, Android) |
|---|---|---|---|---|
| Nav | Pill nav top-right, on root pages only | Window bar on every page (logo, Back, nav right) | Top row: floating tab bar centred, on every page | Bottom tab bar, on every page except the player and sheets |
| Nav on scroll | Scrolls away with the page | Stays; clear over a hero, solid ink 96% + 1 px hairline once content is under it | Stays; turns solid like desktop | Stays (bottom); the top head scrolls away, an inline nav bar appears |
| Visible Back | **None.** The remote's Back key | In the window bar: macOS after the traffic lights, Windows at the left edge, GNOME at the header bar's start | Top-left of the top row: "‹ Movies" (iPad), ← (Android) | Over a hero: 40 pt disc at top-left; scrolled: nav bar "‹ Movies" (iOS) / ← (Android) |
| Other ways back | — | ⌘[ / ⌘← (mac), Alt+← / Backspace (Win, Linux), mouse button 4, trackpad swipe (mac), Esc | Left-edge swipe (iPad), system back + predictive back (Android) | Edge swipe (iOS), system back + predictive back (Android) |
| Panels | Side panel 1080 px, no close button | Side panel 460 pt under the bar, ✕ | Floating side sheet 440 pt under the status bar, ✕; a short choice (a setting, a filter): a popover 320 pt by what opened it | Bottom sheet with grabber, ✕ |
| Player exit | Back (twice if the controls are up) | Back in the bar's Back slot, Esc | ✕ top-left, swipe down | ✕ top-left, swipe down |
| Settings | Nav destination (gear selected) | Nav destination (gear selected) | A section of its own, like Saved (gear disc in the top row, selected while open) | A tab of its own |
| Search | Nav destination | Nav destination | Icon tab in the tab bar | Fifth tab |

Why, in one line each:

- **TV, no on-screen Back:** Samsung and Google TV apps rely on the remote's Back; an on-screen
  Back is one more focus stop that does what a key already does, and it pushed the hero down.
- **TV, nav scrolls away:** the 10-foot screen is all content; Back brings you to the nav in one
  press (Google TV pattern), so pinning it buys nothing.
- **Desktop, one window bar:** this is how Music, TV, Finder (mac), Settings and Store (Windows)
  and libadwaita apps (GNOME) do it; it also fixes the Mac back floating over the hero.
- **Tablet, tabs at the top:** iPadOS 18 moved tab bars to the top, and reel's pill nav already is
  one; Back takes the logo's slot, so the row never grows.
- **Phone, bottom tabs:** thumbs; the iOS/Material standard; the hero gets the whole top.

## Add to list and the title hero

Add to list is rarely used, so it leaves the hero's action row and becomes the title page's one
**header action**, at the right of the page's top area, on every platform. The action row keeps
what the page is for:

```
[ ▶ Play / Resume S3:E4 ]  [ ▸ Trailer ]            ← action row (Trailer only when there is one)
[ 1080p WEB · season pack 9.8 GB · 174 people sharing ⌄ ]   ← release button, own line, opens the panel
```

| | Where Add to list is | Look | Added state |
|---|---|---|---|
| TV | top-right of the safe area (right 96, top 54), alone (no nav on a title) | pill 62 px, `#1A1A1AD1`, + icon 24 + "Add to list" 24/500 | ✓ + "In list", selected fill `#333` |
| Desktop | window bar, right part, before the nav pills (gap 10) | pill 34 pt, + 15 + "Add to list" 13/500 | ✓ + "In list", selected fill |
| Tablet | top row, a 40 pt disc left of Settings | + icon only (row is busy), label as accessibility name | ✓, selected fill |
| Phone | a 40 pt disc at the top-right over the hero, mirroring the back disc; scrolled: the nav bar's right button | + icon only | ✓, selected fill |

- Text: `title.add_to_list` / `title.in_list` (exist). The icon-only versions use them as the
  accessibility label and, on pointer devices, the tooltip.
- **TV remote:** Up from Play or Trailer → Add to list (the only thing above); Down from it →
  the button you left; Left/Right do nothing there; OK toggles. Down from the action row → the
  release button → Releases / season tabs. The focus still lands on Play.
- Desktop keyboard: it is a stop in the bar's Tab order; ⌘D / Ctrl+D toggles it on a title.
- Home's hero keeps its "Add to list" button for now (see open questions).

Mockups: `tv.html` `film`, `film-add-to-list`, `show` (in my list); `desktop.html` `mac-film`,
`win-film`, `linux-film`; `tablet.html` `ipad-film`, `android-tablet-film`; `phone.html`
`ios-film`, `ios-film-scrolled`, `android-film`.

## TV (1920×1080, ten-foot; safe area 96 / 54)

Nav: `NavBar` as today, logo at (96, 50), pills right, row 62 px; only on root pages
(Home, Movies, Series, Anime, Search, Settings). Deep pages (title, About) and the player have no
nav and no back button; their top-left corner is the page's own content. A title's top-right
holds Add to list (see above).

| Page | Focus lands on | Back does |
|---|---|---|
| Home | first card of the first shelf (focus memory after that) | focus not on the nav → page scrolls to top, focus on Home in the nav; on the nav → **Exit reel?** dialog |
| Movies, Series, Anime | first Trending poster | not on the nav → top + focus on the current item; on the nav → Home, focus on Home in the nav |
| Search | the search field | keyboard up → closes it; else as Movies |
| Settings | the chosen language | as Movies (the "OK chooses, Back closes." hint goes) |
| About | nothing focusable | Settings, focus on "About reel and its data sources" |
| Title (film, show) | Play / Resume | release panel open → close it, focus back on the release button; else back to where it was opened, focus on the card that opened it. One press from anywhere on the page (tabs, episodes, cast) |
| Release panel | the release Play uses | closes the panel |
| Player | play/pause | tracks panel → close; Up next card → dismiss; controls up → hide; else stop and back to the title (position saved) |
| Exit dialog | **Stay** | closes the dialog |

- Left/Right on the nav move the focus only; OK opens (no page swap while passing over items).
- Up from the title's actions goes to Add to list (the `back` zone goes away; the new `header`
  zone takes its place at the top-right).
- Exit dialog: card 760 px, radius 28, centred, over `ink` 72%: "Exit reel?", "Anything playing
  stops. What you watched is kept.", **Stay** (primary, focused) and **Exit**. Exit: Tizen
  `tizen.application.getCurrentApplication().exit()`, Android TV finishes the activity.

Mockups: `tv.html` frames `home`, `home-back-to-nav`, `home-exit`, `movies-scrolled`,
`movies-back-to-nav`, `film`, `film-add-to-list`, `film-releases`, `show`, `settings`, `about`, `search`, `player`,
`player-tracks`.

## Desktop (1440×900 window, regular density; content margin 64)

**Window bar**, 52 pt, `position: absolute` over the page, outside the scroller, `zIndex` above
content; the empty parts drag the window (double click zooms). Left to right:

| | macOS | Windows 11 | Linux (GNOME, CSD) |
|---|---|---|---|
| Window controls | traffic lights at (20, 20), hidden title bar 52 pt | system caption buttons right, 46 pt each (`titleBar().right`) | close button right (or where the system puts them: `titleBar().left/right`) |
| Back | 32×28 pt, radius 7, chevron 17, at x 90 (after the lights + 18) | 40×36, radius 6, Fluent ← 16, at x 6 | 34×34, radius 8, `#FFFFFF14` fill, chevron 16, at x 8 |
| On a root | shown **disabled** (32% opacity), keeps its slot | not shown; logo at x 16 | not shown; logo at x 16 |
| Then | logo "reel" 20 pt, 12 after Back | logo 14 after Back | logo 14 after Back |
| Right | pills (28 pt items in a 34 pt group), search 34, settings 34, margin 16 | same, then caption buttons | same, then the close button |

- Hover on Back shows a tooltip "Back to Movies ⌘[" (the page it goes to + the shortcut).
- Solid state: when the page's scroll offset > 0 *and* the page has no hero under the bar, or
  the hero has scrolled past 52 pt: `ink` 96% + `inset 0 -1px 0 #FFFFFF14`. No blur.
- Shortcuts: Back ⌘[ / ⌘← (mac), Alt+← and Backspace outside text fields (Win, Linux), mouse
  button 4 (`MouseButton "back"`), two-finger swipe right (mac), Esc. ⌘/Ctrl+1–4 Home, Movies,
  Series, Anime; ⌘/Ctrl+F Search; ⌘/Ctrl+, Settings. Esc never goes past a root.
- Release panel: right side panel 460 pt, top at 52 (the bar stays usable), radius 14 top-left,
  ✕ 30 pt; Esc, ✕, a click on the dimmed page, and Back all close it first.
- Player: no nav; Back keeps its slot (same x as on pages) with a `#2A2A2AD9` fill, the title
  and "1080p WEB · resumed from 12:40" beside it; fades with the controls after 3 s. Esc: tracks
  panel → full screen → leave. In full screen Back sits at (20, 12).
- Keyboard focus on desktop uses the TV ring and the same zones, but Esc on a root does
  nothing: the nav is always visible, so there is no "focus to the nav" step.

Mockups: `desktop.html` frames `mac-home`, `mac-movies-scrolled`, `mac-film`,
`mac-film-releases`, `mac-settings`, `mac-about`, `mac-player`, `win-film`,
`win-movies-scrolled`, `linux-film`, `linux-settings`.

## Tablet (iPad 1180×820 pt, Android tablet 1280×800 dp; margin 32)

Top row 60 pt under the status bar (iPad 24 pt, Android 32 dp; take `safeArea().top`):

- Left (x 24): on a root the logo; on a deeper page, and on Saved's and Settings' roots (Back
  goes where they were opened from, else Home), the back button in its place — iPad: a
  40 pt capsule "‹ Movies" (chevron 20 + previous page's title 16/500); Android: a 40 dp disc
  with ← (48 dp touch target), then the logo. The left edge's swipe goes back on those roots too.
- Centre: the floating tab bar (44 pt capsule, 36 pt tabs, label 15/500): Home, Movies, Series,
  Anime, Search (icon only).
- Right: on a title Add to list, then Saved (where the device saves; a ring of the overall saving
  progress around it while something saves), then Settings: 40 pt discs, 10 apart. Saved is a
  destination with its own stack ("‹ Saved" on a page over it), selected fill while it is open;
  Settings the same.
- The side slots share what the tabs leave (the tabs stay centred; the right keeps its buttons'
  width); the tabs show their labels when they fit beside the logo or a 150 pt Back and the
  buttons (measured), else icons only (an upright iPad's title page, a narrow window).
- Scroll: the row stays; solid ink 96% (with the status bar area) and a 1 pt `card` line under it
  once content is under it.
- A window narrower than 600 pt (iPadOS's windowed mode, Split View, Android's multi-window) is
  laid out as a phone's, live as it is resized: the same tabs (Home, Search, Saved, Settings),
  Home's categories, Settings and Saved as tabs, Back as on a phone (from Search, Saved or
  Settings to the category open last), sheets from the bottom, phone sizes. Only what the device
  decides differs (no Rotate in the player, the window controls' room). Settings opened on a tab
  there (a title's Open Settings) moves to its own section once the window is wide again. In a window that does not fill the screen the system's window
  controls (●●●) sit at the top left: the logo, Back and the first tab start after them (and
  the player's ✕). iPadOS reports a safe area at the window's left there (66 pt); the page's
  margins ignore an iPad's side insets, the controls' room is the only one. A hero's
  Play takes the whole width with Save and Trailer under it where they do not fit in a row; a
  hero's title shrinks rather than break a word.
- Without a network at start (the core decides), the app opens on Saved when something is saved.
- Saved and Settings are sections of their own beside the tabs, never pages of a tab: each has its
  own stack (Interface and About are pushed on Settings, "‹ Settings" over them), its disc is
  selected while it is open and no tab is, and chosen again it goes to its root. A tab's stack
  holds only its root, titles and people, so a tab never opens on a Settings page left there and
  the selected tab is always the one shown. Back from their root goes back to where they were
  opened from (that tab's page, where it was left), once; then to Home. A title's Open Settings
  opens Settings' root. A setting's choices (a popover) and the search source's drawer open over
  Settings, and Back closes them first.
- Release panel: floating side sheet 440 pt, inset 12, radius 22, over a dimmed page, ✕; swipe
  right or tap outside closes it.
- Player: full-screen cover, status bar hidden, ✕ 44 pt at (24, 24) with the title beside it;
  swipe down closes; Android system back hides the controls, then closes.

Mockups: `tablet.html` frames `ipad-home`, `ipad-film`, `ipad-film-scrolled`,
`ipad-releases`, `ipad-settings`, `ipad-player`, `android-tablet-film`.

## Phone (393×852; margin 20)

- Bottom tab bar: Home, Search, Saved (where the device saves), Settings. iOS 49 pt + 34 pt
  home-indicator area; Android 80 dp navigation bar with a 64×32 pill indicator, over the gesture
  area. Visible on every page except the player and while a sheet is up. Home opens the category
  open last; chosen again, its page goes to its top.
- Home's categories: under the head of a category's root page, a row of tabs with icons (All,
  Movies, Series, Cartoons, Anime), the chosen one in snow with a 2 pt red underline, the others
  ash; it scrolls sideways where it does not fit, over a dark veil where the hero's still is under
  it. A category picked there opens from its top (a filter of what to watch, not a place kept).
- Root pages: nothing of reel's over them (the room is the content's), but a category's: Home's
  tabs under the status bar (y = `safeArea().top`, 44 pt), the page's own bar, fixed as it
  scrolls. A title pushed on it slides in over the page and the tabs leave with the page; Back
  (or the edge swipe) brings them back with it. A category picked is a new page whose tabs start
  as the last ones were (the underline on the category left, the row where it was) and move on to
  its own, so the bar reads as one that stays.
- Back (Android's system back, Escape): from Search, Saved or Settings to the Home tab; from a
  category to All; from All the app leaves.
- Phones are upright everywhere but in the player (iOS: the root controller allows landscape
  only while a player is on screen).
- Title pages (over a hero): a 40 pt disc (44 pt touch area) at the left, centred in a bar row
  under the status bar (iOS 44 pt, Android 64 dp), with ‹ (iOS) / ← (Android), and the Watchlist
  disc at the right. Fixed: they stay as the page scrolls. Once the hero's still has scrolled
  past, the row becomes the standard bar (ink 96%, a hairline under it): the discs lose their
  fill (plain ‹ and ♥), the title fades in: centred 17/600 on iOS, after ← 22/400 on Android;
  one line, cut with "…". Back's accessibility name is "Back to Movies"; its label is not shown.
- Every scrolling phone page has a scrim under the status bar: a fade over a hero, solid ink 96%
  once content is under it, and on a page without a hero from the start.
- Settings: a tab of its own (its root page, no Back), large title 34/700. About and Interface
  are pushed on it with Back.
- Release panel: bottom sheet (top at ~40% of the height), grabber 36×5, ✕ 30 pt; swipe down,
  tap above or system back closes it; picking a release closes it.
- Player: a 16:9-or-wider film starts in landscape (the core decides from the picture's size once
  loaded; iOS turns the screen, Rotate turns it back); ✕ 40 pt at the landscape safe-area left
  (x 62 on a Dynamic Island phone), title beside it; −10 s, Play (larger) and +10 s in the middle
  of the picture; at the bottom the timeline and times, then Audio and subtitles, Episodes and
  Rotate, the row 16 pt above the safe area; swipe down closes. A wait mid-film is one line
  ("Waiting for the stream") under the middle row (over it held sideways), no loader. Android has
  no Rotate yet: it turns as the system does.
- Android: system back on a pushed page = ←; on a root other than Home → Home tab; on Home →
  leaves the app (no dialog: the system's convention on phones).

Mockups: `phone.html` frames `ios-home`, `ios-movies-scrolled`, `ios-film`,
`ios-film-scrolled`, `ios-releases`, `ios-settings`, `android-film`, `phone-player`.

## History model

- **TV and desktop:** one stack. A nav destination replaces it (`go`), a title or About is pushed
  on top. Back pops; on a root, see the TV table (desktop: nothing).
- **Phone and tablet:** one stack per tab (iOS and Material both keep a tab's place). Switching
  tabs keeps each tab's stack; tapping the selected tab pops it to its root. On a phone Settings
  is a tab with About and Interface pushed on it; on a tablet Saved and Settings are sections of
  their own beside the tabs (`nav.useOwnSections`), outside every tab's stack, and Back from their
  root returns to where they were opened from. Only the shown tab's native stack
  writes the history; a pop another tab's stack reports late goes to that tab's kept stack.
- The section of a page is the first route of its stack (`stack[0].name`); for About it is
  Settings.

## New text (`app/locales/en.yml`)

```yaml
nav:
  back_to: "Back to %{page}"     # desktop tooltip, accessibility label of Back
exit:
  title: Exit reel?
  about: Anything playing stops. What you watched is kept.
  stay: Stay
  exit: Exit
player:
  close: Close                    # touch player ✕
```

`settings.hint` ("OK chooses, Back closes.") is removed.

## What changes in the code (in order)

1. **Nav model** (`app/ui/nav.ts`): add `section()` (`stack()[0].name`, `about` → `settings`),
   `canGoBack()` (`stack().length > 1`), `reselect(dest)` (pop to root + scroll to top). Make
   `search` and `settings` roots: `TOP_LEVEL` in `screens/TopLevel.tsx` gets them and
   `isTopLevel` covers them. Add a **back handler stack**: `onBack(fn)` lets an open panel,
   keyboard, card or the player's controls register a closer; one `handleBack()` runs the
   topmost, else the page's own rule. Every screen's `escape:` binding goes through it.
2. **Platform chrome** (new `app/ui/layout/chrome.ts`): `chrome: "tv" | "mac" | "windows" |
   "linux" | "tablet" | "phone"` from `density`, `platform.os` and `platform.idiom`. It replaces
   `backInTitleBar` in `layout/TopBar.tsx`. Insets: `safe()` in `theme.ts` stays the TV's 5 %;
   desktop, tablet and phone use `safeArea()` plus their margin (64 / 32 / 20).
3. **TV**:
   - `screens/title/TitleScreen.tsx`, `screens/title/focus.ts`: remove `FloatingBack`; the
     `back` zone becomes `header` (Add to list, top-right), `actions.up` → `header`,
     `header.down` → the action you left.
   - `screens/search/SearchScreen.tsx`, `screens/settings/SettingsScreen.tsx`: render inside
     `Screen nav` like Browse; drop `BackButton` / `PageHeader`'s button; drop `settings.hint`.
   - `screens/about/AboutScreen.tsx`: title at the safe area's top-left, no button.
   - Root Back: one helper in `layout/Screen.tsx` (or `focus/zones.ts`) for every root — focus
     not on the nav → scroll to top (`ScrollCtl`) and `zone.set("nav")` on the current item; on
     the nav → `go("home")` with `navAt` on Home; on Home → `ExitDialog`.
   - New `layout/ExitDialog.tsx` (NSH `Dialog`, `closeOnEscape`), and an `exitApp()` in
     `ui/native.ts` (Tizen application exit; Android TV activity finish).
   - `Player.tsx`: remove both `BackButton`s on the TV (lines ~378–405); keep the title block at
     the safe area's top-left; the Escape order already matches (card → panel → hide → stop).
4. **Desktop**:
   - New `layout/WindowBar.tsx` (Back slot, logo, `NavPills` + buttons from `NavBar.tsx`,
     window buttons space from `titleBar().left/right`, `windowDrag`), rendered once in
     `App.tsx` outside the screens; it replaces `TitleBarBack` and the in-content `NavBar` on
     desktop. `TITLE_BAR_HEIGHT` 40 → 52. Hidden title bar on Windows and Linux too
     (`currentWindow().set({ titleBar: { style: "hidden", height: 52 } })`).
   - A `scrolled` signal from `layout/Scroller.tsx` / `scrollCtl.ts` drives the solid state.
   - Shortcuts in `App.tsx` via `keymap`: `mod+[`, `mod+left`, `alt+left`, `backspace`,
     `mod+1..4`, `mod+f`, `mod+,`; the mouse back button (`MouseButton "back"`) and the mac swipe
     through the same `handleBack()`.
   - Player: Back in the bar's slot instead of the safe-area corner.
5. **Tablet and phone**:
   - Adopt NSH `NavStack` (one `createNavStack` per tab) for pushes: it gives iOS swipe back,
     Android predictive back and the system back for free. Title pages: `NavPage`
     `headerTransparent`, the disc as `headerLeft`; Settings: `headerLargeTitle`,
     `headerBackTitle` from the previous page.
   - New `layout/TabBar.tsx` (phone, bottom) and `layout/TopTabs.tsx` (tablet, top row) over the
     same `NAV` items (`layout/navItems.ts`).
   - `screens/title/ReleasePanel.tsx` → NSH `Sheet`: `side="right"` on TV, desktop and tablet,
     `side="bottom"` with `closeOnSwipe` on the phone.
   - Player: ✕ (`player.close`) at the top-left inside `safeArea()`; swipe down to close.
6. **Title hero** (`layout/HeroActions.tsx`, `screens/title/TitleHero.tsx`): the row is Play,
   Trailer; the release button moves to its own line under it; Add to list leaves the row for a
   new `layout/ListToggle.tsx` (pill with label on TV and desktop, disc on touch) placed by the
   chrome: TV in the title's header zone, desktop in `WindowBar` (a `pageAction` slot the
   title fills), tablet in the top row, phone as the disc / `headerRight`. ⌘D / Ctrl+D binds
   to it on desktop.
7. **Clean-up**: delete `FloatingBack`, `PageHeader`'s back, `TitleBarBack`, `backInTitleBar`;
   `BackButton.tsx` remains only for the phone disc (or goes into `WindowBar`/`TabBar`).
8. **Tests**: `App.test.tsx`, `TitleDetails.test.tsx`, `Settings.test.tsx`, `Player.test.tsx`
   for the Back order per chrome (panel first, nav focus, Home, exit dialog), the section kept
   selected on a title, and Search/Settings as roots. Screenshot each mockup frame's real
   screen with `nsh test --target web` and compare.

## Open questions

1. **Exit on the TV:** a confirm dialog (this spec, as `ui-design` asks) or exit at once on the
   third Back (Android TV's own convention)? Same on Tizen and Android TV?
2. **Settings and Search as nav roots on TV/desktop:** fine that Back from Settings goes to the
   nav, then Home, not back to the film you came from?
3. **Desktop history:** hierarchical (this spec: a nav click starts over, Back disabled on roots)
   or browser-like (Back returns to any previous page, across sections)?
4. **Per-tab stacks on desktop too** (like touch), or keep "a nav click starts over"?
5. **Phone tabs:** Search as the fifth tab (this spec) or the "My list" tab from the direction?
   My list is not built yet.
6. **TV player:** Back first hides the controls (this spec, because restarting a torrent is slow)
   or leaves at once?
7. **Windows/Linux:** does NSH's hidden title bar keep the system caption buttons on both
   (`TitleBarArea.right` suggests so)? On KDE and other server-side decorations the bar becomes a
   row under the system title bar.
8. **iOS 26:** keep reel's own solid tab bar, or use the system's Liquid Glass tab bar (blur,
   which the direction refuses)?
9. **Home hero:** keep "Add to list" next to Resume on Home (it acts on the featured title, and
   Home has no title header), or drop it there too for one rule?
