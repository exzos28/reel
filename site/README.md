# reel website

The public page about reel: what it is, how it works, platforms and how to install. It is a
static site with no build step when served: `index.html` (English) and one page per language in
`<lang>/index.html`, `style.css`, `icon.svg`, the Geist font in `fonts/` (SIL Open Font License,
`fonts/Geist-OFL.txt`) and two small local scripts (`install.js`: the device tabs; `runner.js`:
the footer's dinosaur). No trackers, no cookies, nothing loaded from other hosts, relative paths
only.

## Languages

The app's languages (`app/locales`): English at the root, and `ru/`, `uk/`, `pl/`, `de/`, `fr/`,
`es/`, `it/`, `pt-br/`, `tr/`, `ja/`, `zh-cn/`. Each is a whole static page in its language (text,
`<html lang>`, title and description), so search engines index each one; every page names the
others with `hreflang` links and itself as canonical.

There is no language switcher. Only the root page picks: a short script in its `<head>` takes the
first language in the browser's list that the site has (`pt-PT` gets `pt-br/`; Chinese in
traditional characters, `zh-TW`, `zh-HK`, `zh-Hant`, does not get the simplified page) and goes
there, keeping the `#section`. English, crawlers and visitors without scripts stay on the root. A
language page never redirects: whoever opens `/de/` stays there.

### Where the texts are

The pages are written by `build/site-pages.py` from `i18n/` (not published):

- `i18n/template.html`: the page, its texts as `{{key}}`. Layout and markup changes go here.
- `i18n/<lang>.json`: every key in that language. `en.json` is the English.

The written pages are committed. After changing the template or a string:

```sh
build/site-pages.py           # writes index.html and <lang>/index.html
build/site-pages.py --check   # fails if a committed page differs from what it writes
```

`build/site-deploy.sh` runs it before publishing, so a deploy never ships stale pages. Never edit
`index.html` or `<lang>/index.html` by hand: the next run overwrites them.

- **A new string:** put `{{area.name}}` in the template and the key in `en.json` and in every
  other `<lang>.json`; the script fails, naming the language, while one lacks it.
- **A link inside a sentence:** the string marks it as `<a>…</a>` with no attributes, and the
  template gives the address: `{{privacy.lead|https://…|https://…}}`, one per link, in order. A
  translation may move a link within its sentence but must keep as many as the English.
- **A new language:** add it to `LANGS` in `build/site-pages.py` (tag and folder), write
  `i18n/<tag>.json` with every key, run the script and commit the new folder.

Translations use the app's own words (`app/locales`) for the same things: the search source,
Save (never "Download" for keeping a film on the device), the drawings' Home, Continue watching
and so on. Brand names stay as they are.

## Preview

Serve the folder over HTTP (fonts do not load from `file://` in every browser):

```sh
cd site
python3 -m http.server 8000
# open http://localhost:8000 (or /de/, /ja/…)
```

## Publish

`build/site-deploy.sh` publishes the folder on Fly.io (`deploy/`); the canonical and `hreflang`
links name that address (`ORIGIN` in `build/site-pages.py`).

## Links that lead nowhere yet

- The iPhone and iPad steps add reel's AltStore and SideStore source,
  `https://github.com/exzos28/reel/releases/latest/download/altstore.json`, a release asset that
  comes with the first release that has the iPhone and iPad app; a comment in the template says
  so. Its address is `SOURCE` in `build/site-pages.py`.
- Update the platform statuses when builds change, from `build/build.sh`, `docs/ci.md` and
  `.github/workflows/`.

## Rules for the content

- reel ships no content sources: never name trackers, indexers or sites, and no "free movies"
  wording. The user connects their own search source.
- No screenshots or posters of commercial films. The app pictures are drawn in HTML and CSS with
  public-domain titles.
- Keep the TMDB notice and the AniList and Jikan credits in the footer.
- Raster images, if ever added: PNG at 1x, `@2x` and `@3x`. Prefer SVG or CSS.

## Updating

After changing `style.css`, `install.js` or `runner.js`, bump the `?v=` in their links in
`i18n/template.html` (a date is enough) and run `build/site-pages.py`, so browsers that cached
the old file load the new one.
