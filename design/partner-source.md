# A ready source from a partner

**One job:** someone without their own Jackett gets a working search source in a minute, paying
a partner who rents one, without typing an address and a key with a remote.

reel still ships no source. The partner is optional and named at build time
(`REEL_PARTNER_BOT`, a Telegram bot's username); a build without it shows nothing of this.

## Flow

1. **The way in.**
   - TV: the setup's source step and the source drawer show the bot's QR code
     (`https://t.me/<bot>?start=<payload>`).
   - The settings page on a phone (opened from the TV's QR): "Get a ready source in Telegram".
   - The reel app on a phone or a desktop: a button that opens the bot.
2. **Payment.** The viewer presses Start in Telegram and pays the partner as usual.
3. **The way back.** The bot sends an "Open" button: the template from the payload, with the
   source filled in.
   - TV: the link opens the TV's settings page on the phone (`/s`, the same page), which offers
     the source to the TV. The TV asks "Use the source from your phone?" with the source's host.
     Use saves and checks it; the page says how it went.
   - App: the link opens reel (`reel://s`) with the source's fields filled in; Save and check
     saves it.

Nothing is saved without a yes on the device: anyone can make such a link.

## Contract with the bot

`payload` is the template, base64url without padding. Telegram's `start` takes at most 64
characters of `A-Z a-z 0-9 _ -`.

| Template | Opens |
|---|---|
| `http://<TV's LAN IPv4>:<port>/s?t={t}&u={u}` | the TV's settings page |
| `reel://s?t={t}&u={u}` | the reel app |

- `{t}`: the API key; `{u}`: the full Torznab address. Each through `encodeURIComponent`.
- The bot accepts only these two forms: `http`, a private IPv4 (10/8, 172.16/12, 192.168/16),
  an explicit port 1024–65535, path `/s`; or `reel` with host `s`. Query exactly `t={t}&u={u}`,
  no fragment, no user info. Anything else gets the old answer (address and key as text): a
  template pointing elsewhere would send the buyer's key to a stranger.
- The worst LAN address, `http://192.168.100.100:65535/s?t={t}&u={u}`, is 42 characters, 56
  base64url.

## reel's side

- Core (`app/src/interface/hosted/offer.rs`): the template and the bot's link, the offer a page
  makes (`POST /settings/api/offer`, no pairing: the screen's yes stands for it; one at a time,
  10 minutes, 2 s apart; `GET /settings/api/offer/<id>` for how it went), the screen's answer
  (`Hosted.answerOffer`), and the source in a `reel://s` link (`Hosted.linkSource`).
- TV host: `GET /s` serves the settings page as `GET /settings` does.
- Page: on `/s?t=&u=` it drops the query from the address bar at once (the key stays out of the
  history), fills the fields and offers the source.
- UI: `OfferDialog` over any screen, `PartnerSource` (QR on a TV, a button elsewhere) in the
  setup's source step and the source drawer, the `reel` scheme (`nsh.json`).
