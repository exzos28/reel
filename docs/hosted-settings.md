# Settings from a phone (hosted settings page)

Typing a Torznab address and an API key with a TV remote is painful. The TV therefore serves a
small settings page on the local network: the user opens `http://<TV IP>:47392/settings` on a
phone or computer on the same network, pairs with a code the TV shows, and sets the search
source, the content language and the playback buffer there.

## 1. Where it is served

- **The LAN listener on 0.0.0.0:47392**, the one that already serves `GET /logs`
  (`hosts/tizen/core/src/logs.rs`). One port for everything the LAN may reach, no new
  listener. It is up before the core, and the settings API answers `503 not_ready` until the UI
  has called `Settings.load` (before that a write would land in memory and be lost on load).
- **The RPC stays on 127.0.0.1:47391** with its token. Nothing from it is on the LAN: the
  settings API is a separate, narrow surface (read the settings, write four of them, check the
  source), not a door to `/rpc`.
- **The logic is in the shared crate** (`app/src/hosted/`): pairing, sessions, rate limits,
  what the page may read, validation and applying writes. It is a plain function
  `hosted::handle(request) -> response` (method, path, Host header, session header, body in;
  status and JSON out), with no HTTP framework. The page is `app/src/hosted/page.html`, compiled
  in (`hosted::PAGE`). The Tizen core only adapts axum to it (two routes) and tells the crate
  the port it serves on (`hosted::serving_on(port)`), which is what turns the feature on. Android
  TV can do the same with whatever server it runs.

## 2. Security

Anyone on the home network must not be able to change settings or read the key.

**Pairing.**
1. The page asks `POST /settings/api/pair`. The core makes a 6-digit code (OS random) and a
   pairing id, and answers with the id only. The TV shows the code.
2. The user types the code on the page: `POST /settings/api/pair/confirm {"pairing","code"}`.
   The right code for that pairing id gives a session token (32 random bytes, hex). The code
   is then gone from the TV.
3. Every other API call needs `X-Reel-Session: <token>`.

**Limits.**
- A code lives 2 minutes, and only one is pending at a time (a new request replaces it, so the
  TV never shows two). It only works with the pairing id that asked for it.
- A code takes 5 wrong tries, then it is dropped and the TV hides it.
- Globally, 10 wrong tries in 10 minutes lock pairing for 10 minutes (`429` with
  `retryAfter`). Every try needs a fresh code on the TV screen, which the people in the room see.
  At that rate a guesser needs on the order of years for an even chance on a 6-digit code.
- Sessions are in memory only (a restart of the core asks for a new code), at most 4 (the
  oldest goes), each expires 12 hours after its last use.

**What is never sent back.** The key: the page only learns `hasKey`. The source address is
sent with key-like query parameters cut out (`apikey=…`, as the logs redact them); saving that
same redacted address back keeps the stored one. Check failures are redacted by the core
already.

**Browser-side.** The session travels in a custom header, not a cookie, and the API sends no
CORS headers, so another site's page in the user's browser cannot call it. Requests whose
`Host` is not an IP address (`192.168.1.20:47392`, not a name) are refused, which closes DNS
rebinding.

**Plain HTTP.** The TV has no certificate a browser would trust, so the page is plain HTTP.
Someone who can sniff the home network (same Wi-Fi with a compromised device, an open
network) can read the key the user types and the session token, and replay the session for up
to 12 hours. The pairing still stops the casual case: a device on the network that never saw
the TV screen can neither read nor change anything. The address of the user's Torznab source is
usually plain HTTP on the same network, with the same exposure, so the page does not make the
key weaker than it already is. Not for guest or public networks; the doc and the page do not
pretend otherwise.

## 3. The page

One self-contained HTML file (inline CSS and JS, no fonts, images or scripts from elsewhere),
phone first, reel's dark palette (ink `#0F0F0F`, card `#1A1A1A`, snow `#F5F5F5`, ash `#8C8C8C`,
red `#E5383B`). Steps:

1. **Pair.** "Show a code on the TV" → code field (6 digits, numeric keyboard) → Pair. The
   session is kept in `localStorage`; a `401` brings this step back.
2. **Settings**, from `GET /settings/api/state` (the core's own JSON, the same fields as
   `Settings.load`):
   - Search source: address, API key (empty field keeps the saved key; "Remove the key" clears
     it), **Save and check**. The answer carries a check job; the page polls
     `GET /settings/api/check/<id>`, which is `Sources.result`, and says "Connected. It searches
     by IMDb id / by title" or the core's message, as the TV's Settings does.
   - Language (of titles and descriptions): the core's `contentLanguages`.
   - Playback buffer: only the core's `bufferChoices` (the sizes this TV has room for); the core
     refuses any other size.

   The app's own UI language is English only for now, so the page has no UI-language field.
   The page words its text itself in English (no locale files on the TV's LAN page yet).

## 4. The TV app follows changes

The crate gets a settings revision, as the catalog has one (`Catalog.changed`):

- `Settings.revision()` and `Settings.changed(after)` (async, answers once the revision is past
  `after`, or after 25 s). The revision goes up on every settings write, from the TV or the
  page, and whenever the pairing code appears or goes.
- `Settings.current()`: the same JSON as `Settings.load`, from memory (no reload).
- A new search source (from either side) drops the catalog's finished searches and bumps the
  catalog, so the screens search the new source at once, no restart.

The UI (`ui/hosted.ts`) waits on `Settings.changed` in a loop and on each change rereads
`Settings.current()` into the preference signals (the Settings screen, the source form's
address) and `Hosted.pairing()` / `Hosted.address()`.

**The code on the TV.** `Hosted.pairing()` is `{"code":"482913","expiresIn":115}` while a code
waits, `{"code":null}` otherwise. While there is one the app shows a panel over whatever screen
is open (`ui/layout/PairingDialog.tsx`): the code in large digits and "Type this code on
reel's settings page on your phone or computer", with Cancel. It goes when the code is used,
expires (the core bumps the revision when it does), is dropped after 5 wrong tries, or the
viewer presses Back or OK on Cancel (`Hosted.cancelPairing()`; the page then hears `expired`
and says the code is gone). The panel does not pass keys to the screen under it.

## 5. The address

`Hosted.address()` is `{"url":"http://192.168.1.20:47392/settings"}`, or `{"url":null}` where
nothing serves the page (desktop, phone) or the device has no LAN address. The core finds its
address the way the OS would route a packet out (a UDP socket "connected" to a documentation
address, nothing sent), each time it is asked, so a new DHCP lease shows.

The TV shows it:
- in Settings, under Search source: "On your phone or computer, open http://…/settings";
- in a title's releases when there is no search source: "Add a search source in Settings, or
  open http://…/settings on your phone."

## 6. Other platforms

All of it but the listener is in `app/src` (`hosted` module, `Hosted` and `Settings` methods,
the page). An Android TV host that serves the LAN calls `hosted::serving_on(port)` and routes
`GET /settings` and `/settings/api/*` to `hosted::PAGE` and `hosted::handle`; the UI then shows
the address and the code with no change.

## API

All JSON. `S` marks routes that need `X-Reel-Session`.

```
GET  /settings                          the page (text/html)
POST /settings/api/pair                 → {"pairing":"<id>","expiresIn":120}
                                          429 {"error":"locked","retryAfter":s}
POST /settings/api/pair/confirm         {"pairing","code"} → {"session":"<token>"}
                                          403 {"error":"wrong_code","attemptsLeft":n}
                                          410 {"error":"expired"}   (expired, replaced, cancelled, used up)
                                          429 {"error":"locked","retryAfter":s}
GET  /settings/api/state             S  → {"source":{"url","hasKey"},"contentLanguage",
                                           "contentLanguages":[{"tag","name"}],
                                           "bufferMB","bufferChoices":[{"mb","default"}]}
POST /settings/api/source            S  {"url","key"?,"removeKey"?} → {"ok":true,"source":{"url","hasKey"},"check":<id>|0}
                                          400 {"ok":false,"message"}       (not an address)
GET  /settings/api/check/<id>        S  → Sources.result: {"state":"pending"|"done"|"failed",…}
POST /settings/api/language          S  {"tag"} → {"contentLanguage"}     400 unknown tag
POST /settings/api/buffer            S  {"mb"}  → {"bufferMB"}            400 not offered
any                                     401 {"error":"session"}  403 {"error":"host"}
                                        503 {"error":"not_ready"}  404 / 405
```

`key` absent or `""` keeps the saved key; `removeKey: true` clears it.
