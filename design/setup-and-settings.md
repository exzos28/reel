# First run setup, and Settings made short

## Setup (first run)

**One job:** make reel ready to play in under a minute, on the TV with a remote or from a phone.

Three steps, in this order (each one has an answer that works if the viewer just presses OK):

1. **Language** of titles and descriptions (the app's own words stay English). Default: the
   device's language when reel has it, else English.
2. **Playback buffer**: how much of the disk reel may use while a film plays. Default: the
   recommended size for the free space.
3. **Search source**: the Torznab address and key. The only step that can be left for later
   ("Skip, add it later"): without it reel browses but cannot play.

Beside every step (TV, Mac, tablet): **set it up on your phone**: the QR code of the settings
page the device serves, and its address. Typing an address with a remote is the slowest thing in
reel; the phone does it in seconds, and the TV's screen follows (the step completes by itself
when the phone saves the source). A phone shows no QR: it is the phone.

### TV (1920×1080)

```
 reel                                                                   
                                                                        
  Step 1 of 3                                   ┌──────────────────────┐
  Which language should titles be in?           │ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ │
  reel also searches releases by this title.    │ ▓▓     QR      ▓▓▓▓▓ │
                                                │ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ │
  [ English                              ✓ ]    │                      │
  [ Русский                                ]    │ Or on your phone     │
  [ Українська                             ]    │ Scan the code, or    │
  [ Deutsch                                ]    │ open 192.168.50.132  │
  [ Español                                ]    │ :47392/settings      │
  [ More languages                       › ]    └──────────────────────┘
                                                                        
  [ Next ]                                                              
```

Focus starts on the language in use. Down/Up walk the list, Down from the last goes to Next;
Right from the list goes nowhere (the QR is not a control). Back goes to the previous step; on
the first it does nothing (setup is not skippable as a whole, but every step has an answer).

Step 3 swaps the list for two fields (Address, API key), "Check and finish" and "Skip, add it
later", and a status line under them ("Checking…", "Connected. Searches by IMDb id.", or what
went wrong).

### Phone (393×852)

Full screen, one step at a time: "Step 2 of 3", the question, one line of help, the choices as
rows, the primary button at the bottom within thumb reach. No QR.

## Settings, shorter

Today every section is a heading, a paragraph of explanation and a control. The paragraphs said
what setup now says once. Settings becomes one list of rows, each a label, its value and a
chevron, the way people expect settings to look; the explanation moves into the choice panel
that opens (one line on top of the choices).

```
  Settings                                      ┌──────────────────────┐
                                                │        QR            │
  [ Language                 Русский      › ]   │ Change these on your │
  [ Playback buffer   512 MB · 41 GB free  › ]  │ phone: scan the code │
  [ Search source     Connected            › ]  └──────────────────────┘
  [ Stream details                      ( o) ]
  [ About reel                            › ]
```

- Search source opens the source drawer (the same one Play opens when there is none), not a form
  inline in the page.
- "Stream details" is a switch row: on/off is the value.
- The QR card as in setup, on TV, Mac and tablet.

## Review against the design rules (the generic defaults reel refuses)

- Not a generic onboarding carousel: no illustrations, no "Welcome to reel!" splash, no dots
  pager; the question is the title, and "Step 1 of 3" is a real sequence (numbers only there).
- No ALL-CAPS eyebrows, no `→` on buttons (Next, Check and finish), sentence case.
- Focus stays the white ring + lift; the chosen language is `raise` fill + check (selected, not
  focus).
- The QR card is `card` with no border or glow; the address under it in `ash`.
- Removed while planning: a progress bar over the steps (the step line says it), an icon per
  settings row (the labels are enough on a list of five).
